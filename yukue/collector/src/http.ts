import { MAX_BODY_BYTES } from './config.ts';
import { isAllowed, parseRobots, type RobotsRules } from './robots.ts';
import { sha1 } from './text.ts';

/** URL ごとの前回の状態。条件付き取得（304）と、中身が変わったかの判定に使う。 */
export interface HttpState {
  [url: string]: { etag?: string; lastModified?: string; hash?: string; fetchedAt?: string };
}

export interface Page {
  url: string;
  status: number;
  text: string;
  /** サーバーが「変更なし」（304）と答えた */
  notModified: boolean;
  /** 前回と中身がちがう（初回は true） */
  changed: boolean;
}

export class HttpError extends Error {
  status: number;
  constructor(status: number, url: string) {
    super(`HTTP ${status} ${url}`);
    this.name = 'HttpError';
    this.status = status;
  }
}

export class RobotsDisallowed extends Error {
  constructor(url: string, why: string) {
    super(`robots.txt により取得しません（${why}）: ${url}`);
    this.name = 'RobotsDisallowed';
  }
}

export interface ClientOptions {
  userAgent: string;
  minIntervalMs: number;
  timeoutMs: number;
  state: HttpState;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  respectRobots?: boolean;
  retries?: number;
}

/** 文字コードは、HTTPヘッダー → XML宣言 → meta の順に見る。日本の官公庁サイトには Shift_JIS が残っている。 */
export function decodeBody(buf: Uint8Array, contentType: string | null): string {
  let charset = /charset\s*=\s*"?([\w-]+)/i.exec(contentType ?? '')?.[1];
  if (!charset) {
    const head = new TextDecoder('latin1').decode(buf.subarray(0, 2048));
    charset = /<\?xml[^>]*encoding\s*=\s*["']([\w-]+)["']/i.exec(head)?.[1] ?? /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(head)?.[1];
  }
  try {
    return new TextDecoder((charset ?? 'utf-8').toLowerCase()).decode(buf);
  } catch {
    return new TextDecoder('utf-8').decode(buf);
  }
}

/**
 * 相手に負担をかけない取得。
 * - robots.txt を確かめる
 * - 同じホストには間隔をあけて、1本ずつ取りに行く
 * - 前回から変わっていなければ本文を受け取らない（ETag / Last-Modified）
 * - 一時的な失敗（429・5xx・通信エラー）だけ、待ってからやり直す
 */
export class PoliteClient {
  requests = 0;
  private readonly o: ClientOptions;
  private readonly lastAt = new Map<string, number>();
  private readonly robots = new Map<string, Promise<RobotsRules | 'blocked' | null>>();
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;

  constructor(options: ClientOptions) {
    this.o = options;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? (ms => new Promise(r => setTimeout(r, ms)));
    this.now = options.now ?? Date.now;
  }

  private agentToken(): string {
    return this.o.userAgent.split(/[/\s]/)[0];
  }

  private async waitTurn(host: string, extraMs: number): Promise<void> {
    const due = (this.lastAt.get(host) ?? -Infinity) + Math.max(this.o.minIntervalMs, extraMs);
    const t = this.now();
    if (due > t) await this.sleep(due - t);
    this.lastAt.set(host, this.now());
  }

  private rulesFor(u: URL): Promise<RobotsRules | 'blocked' | null> {
    let p = this.robots.get(u.origin);
    if (!p) {
      p = (async () => {
        await this.waitTurn(u.host, 0);
        try {
          const res = await this.fetchImpl(u.origin + '/robots.txt', { headers: { 'user-agent': this.o.userAgent }, signal: AbortSignal.timeout(this.o.timeoutMs) });
          this.requests++;
          if (res.status >= 500) return 'blocked';
          if (!res.ok) return null;
          return parseRobots(await res.text(), this.agentToken());
        } catch {
          return 'blocked';
        }
      })();
      this.robots.set(u.origin, p);
    }
    return p;
  }

  async get(url: string, opts: { conditional?: boolean; accept?: string } = {}): Promise<Page> {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error(`対応していないURLです: ${url}`);
    let crawlDelayMs = 0;
    if (this.o.respectRobots !== false) {
      const rules = await this.rulesFor(u);
      if (rules === 'blocked') throw new RobotsDisallowed(url, 'robots.txt を確認できない');
      if (rules) {
        if (!isAllowed(rules, u.pathname + u.search)) throw new RobotsDisallowed(url, 'Disallow');
        crawlDelayMs = Math.min((rules.crawlDelay ?? 0) * 1000, 20_000);
      }
    }
    const prev = this.o.state[url];
    const headers: Record<string, string> = { 'user-agent': this.o.userAgent, accept: opts.accept ?? '*/*', 'accept-language': 'ja' };
    if (opts.conditional !== false && prev) {
      if (prev.etag) headers['if-none-match'] = prev.etag;
      if (prev.lastModified) headers['if-modified-since'] = prev.lastModified;
    }
    const retries = this.o.retries ?? 2;
    for (let attempt = 0; ; attempt++) {
      await this.waitTurn(u.host, crawlDelayMs);
      let res: Response;
      try {
        res = await this.fetchImpl(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(this.o.timeoutMs) });
        this.requests++;
      } catch (e) {
        if (attempt < retries) { await this.sleep(1000 * 3 ** attempt); continue; }
        throw new Error(`取得できませんでした: ${url}（${e instanceof Error ? e.message : String(e)}）`);
      }
      if (res.status === 304) return { url, status: 304, text: '', notModified: true, changed: false };
      if (res.status === 429 || res.status >= 500) {
        if (attempt < retries) {
          const after = Number(res.headers.get('retry-after'));
          await this.sleep(Number.isFinite(after) && after > 0 ? Math.min(after * 1000, 30_000) : 1000 * 3 ** attempt);
          continue;
        }
        throw new HttpError(res.status, url);
      }
      if (!res.ok) throw new HttpError(res.status, url);
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.byteLength > MAX_BODY_BYTES) throw new Error(`大きすぎるため読み込みません（${buf.byteLength}バイト）: ${url}`);
      const hash = sha1(buf);
      const changed = !prev || prev.hash !== hash;
      this.o.state[url] = {
        etag: res.headers.get('etag') ?? undefined,
        lastModified: res.headers.get('last-modified') ?? undefined,
        hash,
        fetchedAt: new Date(this.now()).toISOString()
      };
      return { url: res.url || url, status: res.status, text: decodeBody(buf, res.headers.get('content-type')), notModified: false, changed };
    }
  }
}
