/** 日付の扱い。画面に出す日付は、どれも日本時間（UTC+9、夏時間なし）。 */

const DOW = '日月火水木金土';
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

interface Ymd {
  y: number;
  m: number;
  d: number;
}

/** 'YYYY-MM-DD' を読む。形式がちがうときは null */
export function parseYmd(s: string | null | undefined): Ymd | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return { y, m: mo, d };
}

const utcOf = (p: Ymd): number => Date.UTC(p.y, p.m - 1, p.d);
const dowOf = (p: Ymd): string => DOW[new Date(utcOf(p)).getUTCDay()] ?? '';
const pad2 = (n: number): string => String(n).padStart(2, '0');

/** きょうの日付（日本時間）を 'YYYY-MM-DD' で */
export function todayJst(now: Date = new Date()): string {
  return new Date(now.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
}

/** from から to までの日数（to が先なら正）。読めない日付があれば null */
export function daysBetween(from: string, to: string): number | null {
  const a = parseYmd(from);
  const b = parseYmd(to);
  if (!a || !b) return null;
  return Math.round((utcOf(b) - utcOf(a)) / DAY_MS);
}

/** 「11月24日（火）」 */
export function dateLabel(ymd: string): string {
  const p = parseYmd(ymd);
  return p ? `${p.m}月${p.d}日（${dowOf(p)}）` : ymd;
}

/** 「12月14日」 */
export function monthDay(ymd: string): string {
  const p = parseYmd(ymd);
  return p ? `${p.m}月${p.d}日` : ymd;
}

/** 「11.20」（一覧の左に出す短い日付） */
export function shortDate(ymd: string): string {
  const p = parseYmd(ymd);
  return p ? `${pad2(p.m)}.${pad2(p.d)}` : ymd;
}

/** 「11/20」 */
export function slashDate(ymd: string): string {
  const p = parseYmd(ymd);
  return p ? `${pad2(p.m)}/${pad2(p.d)}` : ymd;
}

/** 「12.14 月」（予定の一覧） */
export function calendarWhen(ymd: string): string {
  const p = parseYmd(ymd);
  return p ? `${pad2(p.m)}.${pad2(p.d)} ${dowOf(p)}` : ymd;
}

export interface Stamp {
  /** 2026.11.24 */
  date: string;
  /** 火 */
  dow: string;
  /** 18:00 */
  time: string;
  /** 2026-11-24 */
  ymd: string;
}

/** ISO 8601 の日時を、日本時間の日付と時刻にする。読めないときは null */
export function stampJst(iso: string | null | undefined): Stamp | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const d = new Date(t + JST_OFFSET_MS);
  const ymd = d.toISOString().slice(0, 10);
  return {
    ymd,
    date: ymd.replace(/-/g, '.'),
    dow: DOW[d.getUTCDay()] ?? '',
    time: `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`
  };
}

/** 「2026年11月24日 18:00」 */
export function dateTimeLabel(iso: string | null | undefined): string | null {
  const s = stampJst(iso);
  const p = s && parseYmd(s.ymd);
  return s && p ? `${p.y}年${p.m}月${p.d}日 ${s.time}` : null;
}

/** あと何日か。きょうなら 0。過ぎていれば null */
export function daysLeft(deadline: string | null | undefined, today: string): number | null {
  if (!deadline) return null;
  const n = daysBetween(today, deadline);
  return n == null || n < 0 ? null : n;
}

/** 「12月14日」。きょうと年がちがう日付は、年も書く（「2027年1月29日」） */
export function dayLabel(ymd: string, today: string): string {
  const p = parseYmd(ymd);
  if (!p) return ymd;
  const t = parseYmd(today);
  return t && t.y !== p.y ? `${p.y}年${p.m}月${p.d}日` : `${p.m}月${p.d}日`;
}

/** 「12月14日（あと20日）」。きょうが締切なら「（きょうまで）」。過ぎていれば null */
export function untilLabel(deadline: string | null | undefined, today: string): string | null {
  const n = daysLeft(deadline, today);
  if (n == null || !deadline) return null;
  return `${dayLabel(deadline, today)}（${n === 0 ? 'きょうまで' : `あと${n}日`}）`;
}

/** 「締切 12月14日（あと20日）」。過ぎていれば null */
export function deadlineLabel(deadline: string | null | undefined, today: string): string | null {
  const s = untilLabel(deadline, today);
  return s ? `締切 ${s}` : null;
}
