/** 「政策の動き」の並べ方・絞り込み・ホームに出す分の取り出し。どれも純粋な関数。 */
import type { Briefing, CalendarEntry, ThemeId, UpdateItem, UpdateType } from '../types.ts';
import { calendarWhen, daysBetween, parseYmd } from './dates.ts';

/** 新しい日付が先。同じ日のなかでは、重要度の高い順（同じなら元の順） */
export function sortUpdates(items: readonly UpdateItem[]): UpdateItem[] {
  return items
    .map((u, i) => ({ u, i }))
    .sort((a, b) => (a.u.date < b.u.date ? 1 : a.u.date > b.u.date ? -1 : b.u.importance - a.u.importance || a.i - b.i))
    .map(x => x.u);
}

/** 既定の一覧に出す分（人事・入札・会見などを外したもの） */
export const withoutNoise = (items: readonly UpdateItem[]): UpdateItem[] => items.filter(u => !u.noise);

/** 全角・半角、大文字・小文字のちがいをそろえる */
export const normalizeText = (s: string): string => s.normalize('NFKC').toLowerCase();

/** キーワード（空白で区切ると、すべてを含むもの）。題・要約・発表元を見る */
export function matchesQuery(u: UpdateItem, query: string): boolean {
  const terms = normalizeText(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const hay = normalizeText(`${u.title}\n${u.summary}\n${u.ministry}`);
  return terms.every(t => hay.includes(t));
}

export interface UpdateFilter {
  type: UpdateType | 'all';
  theme: ThemeId | 'all';
  query: string;
  /** 人事・入札・会見なども出す */
  showAll: boolean;
}

export function filterUpdates(items: readonly UpdateItem[], f: UpdateFilter): UpdateItem[] {
  return items.filter(
    u =>
      (f.showAll || !u.noise) &&
      (f.type === 'all' || u.type === f.type) &&
      (f.theme === 'all' || u.theme === f.theme) &&
      matchesQuery(u, f.query)
  );
}

export interface DayGroup {
  date: string;
  items: UpdateItem[];
}

/** 日付ごとにまとめる（渡された順を保つ） */
export function groupByDay(items: readonly UpdateItem[]): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const u of items) {
    const last = groups[groups.length - 1];
    if (last && last.date === u.date) last.items.push(u);
    else groups.push({ date: u.date, items: [u] });
  }
  return groups;
}

/** いまの段階の呼び名。段階のない発表は null */
export function stageName(u: UpdateItem): string | null {
  if (!u.stage) return null;
  return u.stage.label || u.stage.steps[u.stage.index] || null;
}

/** 成立・公布・施行まで進んだ法律か */
export function isPassedLaw(u: UpdateItem): boolean {
  if (u.type !== 'law' || !u.stage) return false;
  const passed = u.stage.steps.indexOf('成立');
  return u.stage.index >= (passed >= 0 ? passed : 3);
}

/** https:// で始まるリンクだけを通す */
export const isHttps = (url: string | null | undefined): url is string => typeof url === 'string' && /^https:\/\//.test(url);
export const safeLinks = <T extends { url: string }>(links: readonly T[] | null | undefined): T[] =>
  (links ?? []).filter(l => isHttps(l.url));

export interface BriefItem {
  update: UpdateItem;
  text: string;
}

/**
 * 「きょうの国の動き」。briefing.json の id を動きの一覧と突き合わせ、見つからない id は飛ばす。
 * 1件も残らないときは、直近1週間で重要度の高い動きを3件、題のまま出す。
 */
export function resolveBriefing(briefing: Briefing | null, updates: readonly UpdateItem[], max = 5): BriefItem[] {
  const byId = new Map(updates.map(u => [u.id, u]));
  const out: BriefItem[] = [];
  for (const it of briefing?.items ?? []) {
    const update = byId.get(it.id);
    if (update && !out.some(x => x.update.id === update.id)) out.push({ update, text: it.text || update.title });
  }
  if (out.length) return out.slice(0, max);
  const visible = sortUpdates(withoutNoise(updates));
  const latest = visible[0]?.date;
  if (!latest) return [];
  return visible
    .filter(u => {
      const age = daysBetween(u.date, latest);
      return age != null && age <= 7;
    })
    .sort((a, b) => b.importance - a.importance)
    .slice(0, 3)
    .map(update => ({ update, text: update.title }));
}

export interface AgendaRow {
  /** 並べ替え用（YYYY-MM-DD） */
  date: string;
  /** 表示用（「12.14 月」「12月下旬」） */
  when: string;
  title: string;
  note: string;
  /** 関連する動き（一覧にあるものだけ） */
  updateId?: string;
}

/**
 * 「これからの予定」。calendar.json と、動きに書かれた締切を合わせて、近い順に並べる。
 * きょうより前のものは外す。同じ動きが両方にあるときは、calendar.json の書き方を使う。
 */
export function upcoming(
  calendar: readonly CalendarEntry[],
  updates: readonly UpdateItem[],
  today: string,
  max = 6
): AgendaRow[] {
  const ids = new Set(updates.map(u => u.id));
  const rows: AgendaRow[] = [];
  const linked = new Set<string>();
  for (const c of calendar) {
    if (!parseYmd(c.date) || c.date < today) continue;
    const updateId = c.updateId && ids.has(c.updateId) ? c.updateId : undefined;
    if (c.updateId) linked.add(c.updateId);
    rows.push({ date: c.date, when: c.when || calendarWhen(c.date), title: c.title, note: c.note, updateId });
  }
  for (const u of updates) {
    if (u.noise || !u.deadline || !parseYmd(u.deadline) || u.deadline < today || linked.has(u.id)) continue;
    rows.push({ date: u.deadline, when: calendarWhen(u.deadline), title: u.title, note: `締切 ・ ${u.ministry}`, updateId: u.id });
  }
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (a.r.date < b.r.date ? -1 : a.r.date > b.r.date ? 1 : a.i - b.i))
    .slice(0, max)
    .map(x => x.r);
}

/** フォロー中の分野ごとに、いちばん新しい動きを1件ずつ（並べ替え済みの一覧を渡す） */
export function latestByTheme(themes: readonly ThemeId[], sorted: readonly UpdateItem[]): UpdateItem[] {
  const out: UpdateItem[] = [];
  for (const t of themes) {
    const u = sorted.find(x => x.theme === t);
    if (u) out.push(u);
  }
  return out;
}
