import { parse, type HTMLElement, type Node } from 'node-html-parser';
import type { FeedEntry } from '../feeds.ts';
import { addDays, jstDate, parseJaDate, toHalfWidth } from '../text.ts';
import { entriesToItems, type RssDef } from './rss.ts';
import type { Source } from './types.ts';

/**
 * フィードのない府省のための、新着ページの巡回。
 *
 * 新着の並びは、サイトごとに作りがちがう（表、リスト、日付の見出しの下にまとめたもの…）。
 * そこで「リンクと、その項目の日付の欄」を組にして読む。日付は、確かなものから順に探す。
 *   1. リンクの中の <time datetime>
 *   2. リンクの中の、日付だけが書かれた部分（<span class="date">11月24日（火）</span> や、題の頭の「2026.11.20 」）
 *   3. リンクを囲む要素を外へたどって見つかる、いちばん内側の日付。リンクより前にあるもののうち、いちばん近いものを使う
 *      ただし、その日付がほかの項目のまとまりの中にあるときは、組にしない
 *      （一覧のあとに置かれた「関連リンク」などに、最後の項目の日付が付いてしまうのを防ぐ）
 * 題の文中に出てくるだけの日付（「…（令和8年12月11日開催）」）は、項目の日付としては使わない。
 * それでも拾いすぎるページでは、scope や link で新着の並びだけを指定する。
 */

export interface ListDef extends RssDef {
  /** 読む範囲（CSSセレクター）。省くとページ全体 */
  scope?: string;
  /** 対象にするリンク（CSSセレクター）。省くと、範囲の中のすべてのリンク */
  link?: string;
  /** リンクの中で、題が書かれている部分（CSSセレクター）。省くと、見出し（h1〜h6）があればそれ、なければリンクの文字ぜんぶ */
  title?: string;
  /** 日付がリンクのあとに書かれているページ（例：「題（2026年11月20日）」） */
  dateAfter?: boolean;
  /** 続きのページ（2ページ目など）。1ページ目が変わっていたときだけ、あわせて読む */
  more?: string[];
}

type ReadOptions = Pick<ListDef, 'scope' | 'link' | 'title' | 'dateAfter'>;

export interface ListEntry {
  title: string;
  link: string;
  /** YYYY-MM-DD（日本時間） */
  date: string;
}

const ELEMENT = 1;
const TEXT = 3;
/** リンクから外へたどる段数の上限。日付の見出しの下に並ぶ形（details > div > ul > li > div > a）まで届く深さ。 */
const MAX_CLIMB = 6;
const MIN_TITLE = 6;

const DATE_SRC = String.raw`(?:令和|平成)\s*(?:\d{1,2}|元)\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日|(?<!\d)20\d\d\s*[年./-]\s*\d{1,2}\s*[月./-]\s*\d{1,2}(?!\d)\s*日?|(?<![\d年])\d{1,2}\s*月\s*\d{1,2}\s*日`;
const WEEKDAY_SRC = String.raw`(?:\s*[（(\[][月火水木金土日](?:曜日?)?[）)\]])?`;
const DATE = new RegExp(DATE_SRC, 'g');
/** 日付（と曜日）だけが書かれた部分。 */
const DATE_ONLY = new RegExp(`^(?:${DATE_SRC})${WEEKDAY_SRC}(?:\\s*(?:発表|掲載|更新|公表|付))?$`);
/** 題の頭に、空白や「：」で区切って書かれた日付。 */
const DATE_PREFIX = new RegExp(`^(?:${DATE_SRC})${WEEKDAY_SRC}(?:\\s+|\\s*[:：]\\s*)(?=\\S)`);
/** 題の終わりに付いたファイルの種類や大きさ（「（PDF/111KB）」）。 */
const FILE_NOTE = /\s*[（(［[][^（）()［］[\]]*(?:PDF|KB|MB|Excel|Word|エクセル|ワード)[^（）()［］[\]]*[）)］\]]\s*$/i;
/** かな・漢字・全角の記号（\u3000〜\u30ff、\u4e00〜\u9fff、\uff01〜\uff60）。 */
const JA = '[\\u3000-\\u30ff\\u4e00-\\u9fff\\uff01-\\uff60]';
/** HTMLのソースで、日本語の文の途中に入っている改行。画面では空白に見えてしまうので、つめる（ふつうの空白は残す）。 */
const JA_LINE_BREAK = new RegExp(`(?<=${JA})[ \\t]*[\\r\\n]\\s*(?=${JA})`, 'g');

interface Mark {
  pos: number;
  date: string;
  /** time：<time datetime>、cell：日付だけが書かれた部分、text：文中に出てくる日付 */
  kind: 'time' | 'cell' | 'text';
  /** この日付を含んでいるリンク */
  anchor: HTMLElement | null;
}

const pad = (n: string | number) => String(n).padStart(2, '0');

/** 文字から日付を読む。年のない「11月24日」は、きょうから見ていちばん近い過去の日付として読む。 */
export function readDate(raw: string, today: string): string | null {
  let iso = parseJaDate(raw);
  if (!iso) {
    const m = /(\d{1,2})\s*月\s*(\d{1,2})\s*日/.exec(toHalfWidth(raw));
    if (!m) return null;
    const year = Number(today.slice(0, 4));
    iso = `${year}-${pad(m[1])}-${pad(m[2])}`;
    if (iso > addDays(today, 1)) iso = `${year - 1}-${pad(m[1])}-${pad(m[2])}`;
  }
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso ? iso : null;
}

function readScope(scope: HTMLElement, pageUrl: string, today: string, opts: ReadOptions, out: Map<string, ListEntry>): void {
  const range = new Map<Node, [number, number]>();
  const marks: Mark[] = [];
  const anchors: HTMLElement[] = [];
  /** リンクごとの、題になる文字（日付の欄を除いたもの）。headed は、そのうち見出しや title で指定した部分にあるもの */
  const titleParts = new Map<HTMLElement, string[]>();
  const headed = new Map<HTMLElement, string[]>();
  const titleEls = opts.title ? new Set(scope.querySelectorAll(opts.title)) : null;
  let pos = 0;

  const walk = (node: Node, anchor: HTMLElement | null, inTitle: boolean): void => {
    if (node.nodeType === TEXT) {
      const text = toHalfWidth(node.text);
      const trimmed = text.trim();
      const parts = anchor ? titleParts.get(anchor)! : null;
      let title = trimmed.replace(JA_LINE_BREAK, '');
      let cellEnd = 0;
      if (DATE_ONLY.test(trimmed)) {
        cellEnd = text.length;
        title = '';
      } else if (parts && !parts.length) {
        // リンクの最初の文字が「2026.11.20 題…」の形なら、頭の日付は日付の欄として扱う
        const prefix = DATE_PREFIX.exec(trimmed);
        if (prefix) {
          cellEnd = text.indexOf(trimmed) + prefix[0].length;
          title = trimmed.slice(prefix[0].length).replace(JA_LINE_BREAK, '');
        }
      }
      for (const m of text.matchAll(DATE)) {
        const date = readDate(m[0], today);
        if (date) marks.push({ pos: pos + m.index, date, kind: m.index < cellEnd ? 'cell' : 'text', anchor });
      }
      if (anchor && parts && title) {
        parts.push(title);
        if (inTitle) headed.get(anchor)!.push(title);
      }
      pos += text.length + 1;
      return;
    }
    if (node.nodeType !== ELEMENT) return;
    const el = node as HTMLElement;
    const start = pos;
    if (el.tagName === 'TIME') {
      const date = readDate(el.getAttribute('datetime') ?? '', today) ?? readDate(el.text, today);
      if (date) marks.push({ pos, date, kind: 'time', anchor });
      pos += el.text.length + 1;
    } else {
      // リンクの中にリンクが入ることはないので、外側のリンクを引き継ぐ
      const link = !anchor && el.tagName === 'A' && !!el.getAttribute('href') ? el : null;
      if (link) {
        anchors.push(link);
        titleParts.set(link, []);
        headed.set(link, []);
      }
      const marksTitle = titleEls ? titleEls.has(el) : /^H[1-6]$/.test(el.tagName);
      for (const c of el.childNodes) walk(c, link ?? anchor, inTitle || marksTitle);
    }
    range.set(el, [start, pos]);
  };
  walk(scope, null, false);

  const titleOf = (a: HTMLElement) => {
    const parts = headed.get(a)?.length ? headed.get(a)! : titleParts.get(a) ?? [];
    return parts.join(' ').replace(/\s+/g, ' ').replace(FILE_NOTE, '').trim();
  };
  const allowed = opts.link ? new Set(scope.querySelectorAll(opts.link)) : null;
  const candidates = anchors.filter(a => (!allowed || allowed.has(a)) && titleOf(a).length >= MIN_TITLE);
  const within = (r: [number, number], m: Mark) => m.pos >= r[0] && m.pos < r[1];
  const self = pageUrl.split('#')[0];

  for (const a of candidates) {
    let link: string;
    try {
      const u = new URL(a.getAttribute('href') ?? '', pageUrl);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') continue;
      link = u.toString();
    } catch {
      continue;
    }
    if (link.split('#')[0] === self || out.has(link)) continue;

    const own = range.get(a)!;
    const inside = marks.filter(m => m.anchor === a);
    let pick = inside.find(m => m.kind === 'time') ?? inside.find(m => m.kind === 'cell');
    if (!pick) {
      // リンクの外に書かれた日付を、内側の囲みから順に探す
      let box: Node = a;
      let found: Mark[] = [];
      for (let up = 0; up < MAX_CLIMB && !found.length && box !== scope; up++) {
        const parent: Node | null = box.parentNode;
        const r = parent ? range.get(parent) : undefined;
        if (!parent || !r) break;
        box = parent;
        found = marks.filter(m => !m.anchor && within(r, m));
      }
      const times = found.filter(m => m.kind === 'time');
      const outer = times.length === 1 ? times[0] : found.filter(m => m.pos < own[0]).at(-1) ?? (opts.dateAfter ? found.find(m => m.pos >= own[1]) : undefined);
      if (!outer) continue;
      // 日付のある側の枝に、ほかの項目のリンクが入っているなら、その日付はそちらのもの
      const branch = box.childNodes.map(c => range.get(c)).find(r => !!r && within(r, outer));
      if (branch && !(own[0] >= branch[0] && own[0] < branch[1]) && candidates.some(o => o !== a && range.get(o)![0] >= branch[0] && range.get(o)![0] < branch[1])) continue;
      pick = outer;
    }
    out.set(link, { title: titleOf(a), link, date: pick.date });
  }
}

/** 新着ページから、日付つきのリンクを取り出す（ページに書かれている順）。 */
export function extractList(html: string, pageUrl: string, now: Date, opts: ReadOptions = {}): ListEntry[] {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, template')) el.remove();
  const scopes = opts.scope ? root.querySelectorAll(opts.scope) : [root.querySelector('body') ?? root];
  const out = new Map<string, ListEntry>();
  for (const scope of scopes) readScope(scope, pageUrl, jstDate(now), opts, out);
  return [...out.values()];
}

export function listSource(def: ListDef): Source {
  return {
    id: def.id,
    name: def.name,
    kind: 'html',
    url: def.url,
    async run(ctx) {
      const page = await ctx.http.get(def.url, { accept: 'text/html' });
      if (page.notModified || !page.changed) return { items: [], fetched: 0, unchanged: true };
      const entries = extractList(page.text, page.url, ctx.now, def);
      if (!entries.length) {
        // 次の実行でも「変わっていない」として飛ばさず、失敗として数えつづける
        delete ctx.state.http[def.url];
        throw new Error('新着の並びを読み取れませんでした（ページの作りが変わった可能性があります）');
      }
      const known = new Set(entries.map(e => e.link));
      for (const url of def.more ?? []) {
        try {
          const next = await ctx.http.get(url, { accept: 'text/html', conditional: false });
          for (const e of extractList(next.text, next.url, ctx.now, def)) if (!known.has(e.link)) { known.add(e.link); entries.push(e); }
        } catch (e) {
          // 続きのページが取れなくても、1ページ目の分は生かす
          ctx.log(`${def.name}: 続きのページを取得できませんでした: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      // 新しい順にしてから、1回に取り込む件数の上限をかける（タブごとに並ぶページでも、古いものから落ちるように）
      const feed: FeedEntry[] = [...entries]
        .sort((a, b) => b.date.localeCompare(a.date))
        .map(e => ({ title: e.title, link: e.link, date: new Date(`${e.date}T00:00:00+09:00`), summary: '', categories: [], author: def.ministry }));
      return { items: entriesToItems(feed, def, ctx.now), fetched: entries.length };
    }
  };
}
