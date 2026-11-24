import { fileURLToPath } from 'node:url';

/** 環境変数を読む。空の文字列（CIで未設定の変数を渡したときなど）は、未設定として扱う。 */
export function env(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v ? v : undefined;
}

function num(name: string, fallback: number, min: number): number {
  const raw = env(name);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min) throw new Error(`${name} は ${min} 以上の数で指定してください（いまの値：${raw}）`);
  return n;
}

/** 書き出し先（yukue/data）。テストや試し実行では YUKUE_DATA_DIR で差し替える。 */
export const DATA_DIR = env('YUKUE_DATA_DIR') ?? fileURLToPath(new URL('../../data/', import.meta.url));

/**
 * 相手のサーバーに名乗る名前。本番で動かすときは、連絡先のURLを入れたものを
 * YUKUE_USER_AGENT に設定する（例：yukue-collector/0.1 (+https://example.org/about)）。
 */
export const USER_AGENT = env('YUKUE_USER_AGENT') ?? 'yukue-collector/0.1 (public-data aggregator)';

/**
 * 同じホストへの取得の間隔（ミリ秒）。robots.txt の Crawl-delay のほうが長ければ、そちらに従う。
 * 設定のまちがいで相手に負担をかけないよう、0.5秒より短くはできない。
 */
export const MIN_INTERVAL_MS = num('YUKUE_MIN_INTERVAL_MS', 1500, 500);
export const TIMEOUT_MS = num('YUKUE_TIMEOUT_MS', 30_000, 1000);
export const MAX_BODY_BYTES = 8 * 1024 * 1024;

/** updates/latest.json に残す件数と日数。古いものは月ごとの archive に残る。 */
export const LATEST_LIMIT = 500;
export const KEEP_DAYS = 60;

/** フィード1本から1回に取り込む件数の上限。 */
export const FEED_ENTRY_LIMIT = 80;

/** AIによる整形（任意）。1回の実行で整える件数の上限と、使うモデル。 */
export const ENRICH_LIMIT = num('YUKUE_ENRICH_LIMIT', 25, 0);
export const ENRICH_MODEL = env('YUKUE_MODEL') ?? 'claude-opus-5-5';
