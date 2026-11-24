import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Briefing, RunReport, SourceStatus, UpdateItem, UpdatesFile } from '../../shared/types.ts';
import { KEEP_DAYS, LATEST_LIMIT } from './config.ts';
import type { CollectorState } from './sources/types.ts';
import { addDays, jstDate } from './text.ts';

export function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

/** 途中で止まっても壊れたファイルを残さないよう、別名で書いてから置き換える。 */
export function writeJson(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n');
  renameSync(tmp, file);
}

export function loadState(dataDir: string): CollectorState {
  return {
    http: readJson(join(dataDir, 'state/http.json'), {}),
    seen: readJson(join(dataDir, 'state/seen.json'), {}),
    gian: readJson(join(dataDir, 'state/gian.json'), {})
  };
}

export function saveState(dataDir: string, state: CollectorState, now: Date): void {
  // 目印は400日で忘れる（ファイルが増え続けないように）
  const limit = new Date(now.getTime() - 400 * 86_400_000).toISOString();
  const seen = Object.fromEntries(Object.entries(state.seen).filter(([, at]) => at >= limit).sort(([a], [b]) => a.localeCompare(b)));
  const sortKeys = <T>(o: Record<string, T>) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
  writeJson(join(dataDir, 'state/http.json'), sortKeys(state.http));
  writeJson(join(dataDir, 'state/seen.json'), seen);
  writeJson(join(dataDir, 'state/gian.json'), sortKeys(state.gian));
}

const byNewest = (a: UpdateItem, b: UpdateItem) => b.date.localeCompare(a.date) || b.importance - a.importance || a.id.localeCompare(b.id);

/** 段階や題が変わったか。変わっていれば、AIが整えた文も作り直しの対象にする。 */
function changed(a: UpdateItem, b: UpdateItem): boolean {
  return (a.originalTitle ?? a.title) !== (b.originalTitle ?? b.title) || a.stage?.label !== b.stage?.label || a.stage?.index !== b.stage?.index;
}

export interface MergeResult {
  items: UpdateItem[];
  /** 今回はじめて加わったもの、または段階が進んで出し直したもの */
  touched: UpdateItem[];
  addedIds: string[];
}

/**
 * 前回までの一覧に、今回集めたものを重ねる。
 * - 人が整えた項目（curated）は常に残し、同じ一次情報を指す収集分は捨てる
 * - 同じIDは上書きするが、最初に見つけた日時は保つ
 * - 同じリンクを指す項目は、重要度の高いほうだけ残す
 */
export function mergeUpdates(prev: UpdateItem[], curated: UpdateItem[], incoming: UpdateItem[], now: Date): MergeResult {
  const byId = new Map<string, UpdateItem>();
  for (const it of prev) if (it.sourceId !== 'curated') byId.set(it.id, it);
  const addedIds: string[] = [];
  const touched: UpdateItem[] = [];
  for (const it of incoming) {
    const old = byId.get(it.id);
    if (!old) {
      byId.set(it.id, it);
      addedIds.push(it.id);
      touched.push(it);
    } else if (changed(old, it)) {
      const next = { ...it, firstSeen: old.firstSeen };
      byId.set(it.id, next);
      touched.push(next);
    } else if (old.enriched !== 'ai') {
      // 日付のないフィードの項目が、取りに行くたびに「きょう」へ動かないよう、日付は前のものを保つ
      byId.set(it.id, { ...it, firstSeen: old.firstSeen, date: old.date });
    }
  }
  // 同じ法律が「閣議での公布決定」と「国会の議案」の両方から来るので、経過の詳しい議案のほうにまとめる
  const lawKey = (i: UpdateItem) => (i.type === 'law' || i.type === 'tax' ? (i.originalTitle ?? i.title).replace(/法律案$/, '法律').replace(/\s/g, '') : '');
  const bills = new Map<string, UpdateItem>();
  for (const it of byId.values()) if (it.sourceId === 'shugiin') bills.set(lawKey(it), it);
  for (const it of [...byId.values()]) {
    if (it.sourceId !== 'kakugi') continue;
    const bill = bills.get(lawKey(it));
    if (!bill) continue;
    if (!bill.links.some(l => l.url === it.links[0]?.url) && it.links[0]) {
      byId.set(bill.id, { ...bill, links: [...bill.links, it.links[0]] });
      bills.set(lawKey(it), byId.get(bill.id)!);
    }
    byId.delete(it.id);
  }
  const curatedUrls = new Set(curated.flatMap(c => c.links.map(l => l.url)));
  const oldest = addDays(jstDate(now), -KEEP_DAYS);
  const noiseOldest = addDays(jstDate(now), -14);
  // 別々の情報源が同じページを指しているときは、重要度の高いほうだけ残す
  const seenUrl = new Map<string, string>();
  const rest: UpdateItem[] = [];
  for (const it of [...byId.values()].sort((a, b) => b.importance - a.importance || byNewest(a, b))) {
    const url = it.links[0]?.url ?? it.id;
    const owner = seenUrl.get(url);
    if (it.date < oldest || curatedUrls.has(url) || (owner !== undefined && owner !== it.sourceId)) continue;
    // 定型の発表は、2週間で一覧から外す（月ごとの保管用ファイルには残る）
    if (it.noise && it.date < noiseOldest) continue;
    seenUrl.set(url, it.sourceId);
    rest.push(it);
  }
  rest.sort(byNewest);
  const items = [...curated, ...rest.slice(0, LATEST_LIMIT)].sort(byNewest);
  const kept = new Set(items.map(i => i.id));
  return { items, touched: touched.filter(t => kept.has(t.id)), addedIds: addedIds.filter(id => kept.has(id)) };
}

/** 月ごとの保管用ファイルに、今回触った項目を重ねる。latest.json から落ちた古い項目も、ここには残る。 */
export function writeArchive(dataDir: string, touched: UpdateItem[], now: Date): void {
  const months = new Map<string, UpdateItem[]>();
  for (const it of touched) {
    const m = it.date.slice(0, 7);
    months.set(m, [...(months.get(m) ?? []), it]);
  }
  for (const [month, list] of months) {
    const file = join(dataDir, `updates/archive/${month}.json`);
    const old = readJson<UpdatesFile>(file, { generatedAt: '', items: [] });
    const byId = new Map(old.items.map(i => [i.id, i] as const));
    for (const it of list) byId.set(it.id, it);
    writeJson(file, { generatedAt: now.toISOString(), items: [...byId.values()].sort(byNewest) } satisfies UpdatesFile);
  }
}

/**
 * 「きょうの国の動き」の3件。直近3日のうち、重要度の高いものから選ぶ。
 * 人が書いた当日分のまとめがあるときは、上書きしない。
 */
export function buildBriefing(items: UpdateItem[], prev: Briefing | null, now: Date): Briefing {
  const today = jstDate(now);
  if (prev && prev.method === 'curated' && prev.date >= today) return prev;
  const from = addDays(today, -2);
  const top = items
    .filter(i => !i.noise && i.importance >= 45 && i.date <= today && i.date >= from)
    .sort((a, b) => b.importance - a.importance || b.date.localeCompare(a.date))
    .slice(0, 3);
  return {
    date: today,
    generatedAt: now.toISOString(),
    method: top.some(t => t.enriched === 'ai') ? 'ai' : 'rules',
    items: top.map(i => ({ id: i.id, text: i.enriched === 'rules' || !i.summary ? i.title : i.summary }))
  };
}

/** 情報源ごとの調子（yukue/data/state/health.json）。フィードの引っ越しなど、続く失敗に気づくために持つ。 */
export type HealthState = Record<string, { failures: number; lastOk?: string }>;

/** 今回の結果を重ねて、その情報源の「続けて失敗した回数」と「最後に成功した日時」を返す。 */
export function trackHealth(health: HealthState, id: string, ok: boolean, now: Date): { failures: number; lastOk?: string } {
  const prev = health[id];
  const next = ok ? { failures: 0, lastOk: now.toISOString() } : { failures: (prev?.failures ?? 0) + 1, ...(prev?.lastOk ? { lastOk: prev.lastOk } : {}) };
  health[id] = next;
  return next;
}

/**
 * 実行の記録をまとめる。一部の情報源だけを実行した回でも、ほかの情報源の前回の記録が消えないようにする。
 * order は登録順のID。登録から外した情報源の記録は捨てる。
 */
export function mergeReportSources(prev: RunReport | null, order: string[], current: SourceStatus[]): SourceStatus[] {
  const now = new Map(current.map(s => [s.id, s] as const));
  const before = new Map((prev?.sources ?? []).map(s => [s.id, s] as const));
  return order.map(id => now.get(id) ?? before.get(id)).filter((s): s is SourceStatus => !!s);
}
