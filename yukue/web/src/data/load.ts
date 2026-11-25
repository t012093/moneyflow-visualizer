/**
 * 画面のデータを、サイトと同じ場所の data/ から読み込む（ビルドには埋め込まない）。
 * 予算・動き・制度の3つは必須。そのほかは、読めなくても画面を出す（その旨を「このサイトについて」に示す）。
 * 収集システムが書きかえるファイルなので、形のおかしい項目は1件ずつ捨てて、画面が止まらないようにする。
 */
import { isAudId, isThemeId, isUpdateType } from '../content.ts';
import files from './files.json';
import type {
  Audience,
  Briefing,
  BudgetFile,
  CalendarEntry,
  JGrant,
  JGrantsFile,
  Program,
  ProgramApply,
  RunReport,
  SourceLink,
  SourceStatus,
  UpdateItem,
  UpdatesFile
} from '../types.ts';

export interface AppData {
  budget: BudgetFile;
  updates: UpdatesFile;
  programs: Program[];
  briefing: Briefing | null;
  calendar: CalendarEntry[];
  jgrants: JGrantsFile;
  run: RunReport | null;
  /** 読めなかった（必須でない）ファイル */
  missing: { path: string; reason: string }[];
}

/** 読み込むファイル（data/ からの相対パス）。scripts/sync-data.mjs と開発サーバーも、同じ一覧を使う */
export const DATA_FILES: Readonly<Record<'budget' | 'updates' | 'programs' | 'briefing' | 'calendar' | 'jgrants' | 'run', string>> = files;

/** 必須のファイルが読めなかったときのエラー */
export class DataLoadError extends Error {
  readonly failures: { path: string; reason: string }[];
  constructor(failures: { path: string; reason: string }[]) {
    super('データを読み込めませんでした');
    this.name = 'DataLoadError';
    this.failures = failures;
  }
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const strOr = (v: unknown, d: string): string => (isStr(v) ? v : d);

const dataUrl = (path: string): string => `${import.meta.env.BASE_URL}data/${path}`;

async function fetchJson(path: string, signal?: AbortSignal): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(dataUrl(path), { signal, cache: 'no-cache' });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new Error('サーバーにつながりませんでした');
  }
  if (!res.ok) throw new Error(`サーバーの応答が ${res.status} でした`);
  try {
    return (await res.json()) as unknown;
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new Error('JSON として読めませんでした');
  }
}

/* ---------- 形の確認 ---------- */

const isNumList = (v: unknown): v is number[] => Array.isArray(v) && v.every(isNum);
const isNode = (v: unknown): v is Json => isObj(v) && isStr(v.id) && isStr(v.name) && isNum(v.v) && v.v >= 0 && isStr(v.desc);
const isDrillItem = (v: unknown): boolean => isNode(v) && isObj(v.to) && Object.values(v.to).every(isNum);
const isUse = (v: unknown): boolean =>
  isNode(v) &&
  isStr(v.theme) &&
  isStr(v.long) &&
  (v.trend === undefined || isNumList(v.trend)) &&
  (v.drill === undefined || (isObj(v.drill) && Array.isArray(v.drill.items) && v.drill.items.every(isDrillItem)));
const isSrc = (v: unknown): boolean =>
  isNode(v) && (v.trend === undefined || isNumList(v.trend)) && (v.alias === undefined || (Array.isArray(v.alias) && v.alias.every(isStr)));

/** 予算のファイルは人が整えるものなので、形がちがえば全体を読み込みの失敗として扱う */
export function isBudget(v: unknown): v is BudgetFile {
  if (!isObj(v) || !isObj(v.fy) || !isObj(v.themes) || !isObj(v.recips)) return false;
  const fy = v.fy;
  if (!isNum(fy.total) || !(fy.total > 0) || !isNum(fy.pop) || !(fy.pop > 0)) return false;
  if (!isStr(fy.label) || !isStr(fy.west) || !isStr(fy.kind) || !isNumList(fy.years) || !isNumList(fy.trend)) return false;
  if (!Object.values(v.themes).every(t => isObj(t) && isStr(t.name) && isStr(t.c))) return false;
  if (!Object.values(v.recips).every(isStr)) return false;
  if (!Array.isArray(v.src) || !v.src.length || !v.src.every(isSrc)) return false;
  if (!Array.isArray(v.use) || !v.use.length || !v.use.every(isUse)) return false;
  if (!Array.isArray(v.life) || !v.life.every(x => isObj(x) && isStr(x.k) && isStr(x.d))) return false;
  return Array.isArray(v.tiles) && v.tiles.every(x => isObj(x) && isStr(x.label) && isStr(x.value) && isNumList(x.series));
}

function cleanLinks(v: unknown): SourceLink[] {
  if (!Array.isArray(v)) return [];
  const out: SourceLink[] = [];
  for (const l of v) if (isObj(l) && isStr(l.name) && isStr(l.url)) out.push({ name: l.name, url: l.url });
  return out;
}

function cleanUpdate(v: unknown): UpdateItem | null {
  if (!isObj(v) || !isStr(v.id) || !v.id || !isStr(v.date) || !isStr(v.title) || !isStr(v.type) || !isStr(v.theme)) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.date)) return null;
  const stage =
    isObj(v.stage) && Array.isArray(v.stage.steps) && v.stage.steps.every(isStr) && v.stage.steps.length > 0 && isNum(v.stage.index)
      ? { steps: v.stage.steps, index: v.stage.index, label: strOr(v.stage.label, '') }
      : undefined;
  const qa =
    isObj(v.qa) && isStr(v.qa.what) && isStr(v.qa.who) && isStr(v.qa.when)
      ? { what: v.qa.what, who: v.qa.who, when: v.qa.when }
      : undefined;
  return {
    id: v.id,
    date: v.date,
    // 知らない種類は「発表」、知らない分野は「その他」として出す
    type: isUpdateType(v.type) ? v.type : 'news',
    theme: isThemeId(v.theme) ? v.theme : 'other',
    title: v.title,
    originalTitle: isStr(v.originalTitle) && v.originalTitle ? v.originalTitle : undefined,
    summary: strOr(v.summary, ''),
    ministry: strOr(v.ministry, ''),
    amount: isStr(v.amount) && v.amount ? v.amount : undefined,
    stage,
    deadline: isStr(v.deadline) && /^\d{4}-\d{2}-\d{2}$/.test(v.deadline) ? v.deadline : undefined,
    qa,
    links: cleanLinks(v.links),
    sourceId: strOr(v.sourceId, ''),
    firstSeen: strOr(v.firstSeen, ''),
    importance: isNum(v.importance) ? v.importance : 0,
    noise: v.noise === true,
    enriched: v.enriched === 'ai' || v.enriched === 'curated' ? v.enriched : 'rules'
  };
}

export function cleanUpdates(v: unknown): UpdatesFile | null {
  if (!isObj(v) || !Array.isArray(v.items)) return null;
  const items: UpdateItem[] = [];
  const seen = new Set<string>();
  for (const raw of v.items) {
    const u = cleanUpdate(raw);
    if (u && !seen.has(u.id)) {
      seen.add(u.id);
      items.push(u);
    }
  }
  return { generatedAt: strOr(v.generatedAt, ''), items };
}

function cleanApply(v: unknown): ProgramApply | undefined {
  if (!isObj(v) || !Array.isArray(v.needs)) return undefined;
  const needs: ProgramApply['needs'] = [];
  for (const n of v.needs) if (isObj(n) && isStr(n.id) && isStr(n.name)) needs.push({ id: n.id, name: n.name, note: strOr(n.note, '') });
  let draft: ProgramApply['draft'] = null;
  if (isObj(v.draft) && Array.isArray(v.draft.parts)) {
    const parts: { id: string; name: string }[] = [];
    for (const p of v.draft.parts) if (isObj(p) && isStr(p.id) && isStr(p.name)) parts.push({ id: p.id, name: p.name });
    if (parts.length) {
      draft = {
        q1: strOr(v.draft.q1, ''),
        q1ph: strOr(v.draft.q1ph, ''),
        q2: strOr(v.draft.q2, ''),
        q2ph: strOr(v.draft.q2ph, ''),
        parts
      };
    }
  }
  return {
    where: strOr(v.where, ''),
    whereNote: strOr(v.whereNote, ''),
    url: strOr(v.url, ''),
    urlName: isStr(v.urlName) && v.urlName ? v.urlName : undefined,
    needs,
    draft
  };
}

function cleanProgram(v: unknown): Program | null {
  if (!isObj(v) || !isStr(v.id) || !v.id || !isStr(v.name)) return null;
  const aud: Audience[] = [];
  if (Array.isArray(v.aud)) for (const a of v.aud) if (isStr(a) && isAudId(a) && a !== 'all') aud.push(a);
  const link = isObj(v.link) ? { name: strOr(v.link.name, ''), url: strOr(v.link.url, '') } : { name: '', url: '' };
  return {
    id: v.id,
    name: v.name,
    kind: strOr(v.kind, ''),
    aud,
    theme: isStr(v.theme) && isThemeId(v.theme) ? v.theme : 'other',
    amt: strOr(v.amt, ''),
    amtNote: strOr(v.amtNote, ''),
    who: strOr(v.who, ''),
    by: strOr(v.by, ''),
    status: v.status === 'open' || v.status === 'soon' ? v.status : 'always',
    statusText: strOr(v.statusText, ''),
    link,
    apply: cleanApply(v.apply)
  };
}

export function cleanPrograms(v: unknown): Program[] | null {
  if (!Array.isArray(v)) return null;
  const out: Program[] = [];
  for (const raw of v) {
    const p = cleanProgram(raw);
    if (p && !out.some(x => x.id === p.id)) out.push(p);
  }
  return out;
}

export function cleanBriefing(v: unknown): Briefing | null {
  if (!isObj(v) || !Array.isArray(v.items)) return null;
  const items: Briefing['items'] = [];
  for (const it of v.items) if (isObj(it) && isStr(it.id)) items.push({ id: it.id, text: strOr(it.text, '') });
  const method = v.method === 'ai' || v.method === 'curated' ? v.method : 'rules';
  return { date: strOr(v.date, ''), generatedAt: strOr(v.generatedAt, ''), method, items };
}

export function cleanCalendar(v: unknown): CalendarEntry[] | null {
  if (!Array.isArray(v)) return null;
  const out: CalendarEntry[] = [];
  for (const c of v) {
    if (!isObj(c) || !isStr(c.date) || !isStr(c.title)) continue;
    out.push({
      date: c.date,
      when: strOr(c.when, ''),
      title: c.title,
      note: strOr(c.note, ''),
      updateId: isStr(c.updateId) ? c.updateId : undefined
    });
  }
  return out;
}

export function cleanJGrants(v: unknown): JGrantsFile | null {
  if (!isObj(v) || !Array.isArray(v.items)) return null;
  const items: JGrant[] = [];
  for (const g of v.items) {
    if (!isObj(g) || !isStr(g.id) || !isStr(g.title)) continue;
    items.push({
      id: g.id,
      title: g.title,
      area: strOr(g.area, ''),
      maxAmount: isNum(g.maxAmount) ? g.maxAmount : null,
      start: isStr(g.start) && g.start ? g.start : null,
      end: isStr(g.end) && g.end ? g.end : null,
      employees: isStr(g.employees) && g.employees ? g.employees : null,
      url: strOr(g.url, '')
    });
  }
  return { generatedAt: strOr(v.generatedAt, ''), items };
}

export function cleanRun(v: unknown): RunReport | null {
  if (!isObj(v) || !Array.isArray(v.sources)) return null;
  const sources: SourceStatus[] = [];
  for (const s of v.sources) {
    if (!isObj(s) || !isStr(s.name)) continue;
    sources.push({
      id: strOr(s.id, s.name),
      name: s.name,
      kind: s.kind === 'rss' || s.kind === 'api' || s.kind === 'file' ? s.kind : 'html',
      url: strOr(s.url, ''),
      ok: s.ok === true,
      fetched: isNum(s.fetched) ? s.fetched : 0,
      added: isNum(s.added) ? s.added : 0,
      unchanged: s.unchanged === true ? true : undefined,
      error: isStr(s.error) && s.error ? s.error : undefined,
      ms: isNum(s.ms) ? s.ms : 0,
      checkedAt: isStr(s.checkedAt) && s.checkedAt ? s.checkedAt : undefined,
      failures: isNum(s.failures) && s.failures > 0 ? s.failures : undefined,
      lastOk: isStr(s.lastOk) && s.lastOk ? s.lastOk : undefined
    });
  }
  const t = isObj(v.totals) ? v.totals : {};
  return {
    startedAt: strOr(v.startedAt, ''),
    finishedAt: strOr(v.finishedAt, ''),
    sources,
    totals: { fetched: isNum(t.fetched) ? t.fetched : 0, added: isNum(t.added) ? t.added : 0, items: isNum(t.items) ? t.items : 0 }
  };
}

const BAD_SHAPE = '中身の形が、想定とちがいます';

/* ---------- 読み込み ---------- */

export async function loadData(signal?: AbortSignal): Promise<AppData> {
  type Outcome<T> = { ok: true; value: T } | { ok: false; reason: string };
  async function read<T>(path: string, clean: (v: unknown) => T | null): Promise<Outcome<T>> {
    try {
      const value = clean(await fetchJson(path, signal));
      return value == null ? { ok: false, reason: BAD_SHAPE } : { ok: true, value };
    } catch (e) {
      if (signal?.aborted) throw e;
      return { ok: false, reason: e instanceof Error ? e.message : String(e) };
    }
  }

  const [budget, updates, programs, briefing, calendar, jgrants, run] = await Promise.all([
    read(DATA_FILES.budget, v => (isBudget(v) ? v : null)),
    read(DATA_FILES.updates, cleanUpdates),
    read(DATA_FILES.programs, cleanPrograms),
    read(DATA_FILES.briefing, cleanBriefing),
    read(DATA_FILES.calendar, cleanCalendar),
    read(DATA_FILES.jgrants, cleanJGrants),
    read(DATA_FILES.run, cleanRun)
  ]);

  const failures: { path: string; reason: string }[] = [];
  if (!budget.ok) failures.push({ path: DATA_FILES.budget, reason: budget.reason });
  if (!updates.ok) failures.push({ path: DATA_FILES.updates, reason: updates.reason });
  if (!programs.ok) failures.push({ path: DATA_FILES.programs, reason: programs.reason });
  if (!budget.ok || !updates.ok || !programs.ok) throw new DataLoadError(failures);

  const missing: { path: string; reason: string }[] = [];
  if (!briefing.ok) missing.push({ path: DATA_FILES.briefing, reason: briefing.reason });
  if (!calendar.ok) missing.push({ path: DATA_FILES.calendar, reason: calendar.reason });
  if (!jgrants.ok) missing.push({ path: DATA_FILES.jgrants, reason: jgrants.reason });
  if (!run.ok) missing.push({ path: DATA_FILES.run, reason: run.reason });

  return {
    budget: budget.value,
    updates: updates.value,
    programs: programs.value,
    briefing: briefing.ok ? briefing.value : null,
    calendar: calendar.ok ? calendar.value : [],
    jgrants: jgrants.ok ? jgrants.value : { generatedAt: '', items: [] },
    run: run.ok ? run.value : null,
    missing
  };
}
