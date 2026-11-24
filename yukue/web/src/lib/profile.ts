/** プロフィール（自分の設定）。この端末にだけ保存する。 */
import { AIMS, BFORM, INCOME, INDUSTRY, KIDS, KIND, KOYO, OFORM, WORK } from '../content.ts';

export type KindId = keyof typeof KIND;
export type KidsId = keyof typeof KIDS;
export type AimId = keyof typeof AIMS;

export interface Profile {
  /** 立場。'' は未設定 */
  kind: KindId | '';
  pref: string;
  kids: KidsId[];
  work: keyof typeof WORK | '';
  koyo: keyof typeof KOYO | '';
  income: keyof typeof INCOME | '';
  bform: keyof typeof BFORM | '';
  /** 入力欄の文字のまま持つ（'' は未入力） */
  staff: string;
  years: string;
  industry: keyof typeof INDUSTRY | '';
  aims: AimId[];
  oform: keyof typeof OFORM | '';
  /** AIの回答に、この設定を使うか */
  useInAi: boolean;
}

export const PF0: Profile = {
  kind: '',
  pref: '',
  kids: [],
  work: '',
  koyo: '',
  income: '',
  bform: '',
  staff: '',
  years: '',
  industry: '',
  aims: [],
  oform: '',
  useInAi: true
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const pick = <T extends string>(map: Record<T, string>, v: unknown): T | '' =>
  typeof v === 'string' && Object.hasOwn(map, v) ? (v as T) : '';
const pickMany = <T extends string>(map: Record<T, string>, v: unknown): T[] =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is T => typeof x === 'string' && Object.hasOwn(map, x)))] : [];
const text = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : '');

/** 保存されていた値を、いまの型に合わせて読み直す（知らない値は捨てる） */
export function cleanProfile(saved: unknown): Profile {
  if (!isObj(saved)) return { ...PF0, kids: [], aims: [] };
  return {
    kind: pick(KIND, saved.kind),
    pref: text(saved.pref),
    kids: pickMany(KIDS, saved.kids),
    work: pick(WORK, saved.work),
    koyo: pick(KOYO, saved.koyo),
    income: pick(INCOME, saved.income),
    bform: pick(BFORM, saved.bform),
    staff: text(saved.staff),
    years: text(saved.years),
    industry: pick(INDUSTRY, saved.industry),
    aims: pickMany(AIMS, saved.aims),
    oform: pick(OFORM, saved.oform),
    useInAi: saved.useInAi !== false
  };
}

export type PresetId = 'person' | 'biz';

/** 「例でためす」の設定 */
export const PRESETS: Record<PresetId, Partial<Profile>> = {
  person: { kind: 'person', pref: '東京都', kids: ['school'], work: 'emp', koyo: 'yes', income: 'b' },
  biz: { kind: 'biz', pref: '大阪府', bform: 'sole', staff: '3', years: '2', industry: 'shop', aims: ['sales', 'wage'] }
};

export const applyPreset = (id: PresetId, current: Profile): Profile => cleanProfile({ ...PRESETS[id], useInAi: current.useInAi });

/** 設定をひとことで（「個人 ・ 東京都 ・ 子ども：小・中学生 ・ 会社員・公務員」） */
export function profileSummary(pf: Profile): string {
  if (!pf.kind) return '';
  const a: string[] = [KIND[pf.kind]];
  if (pf.pref) a.push(pf.pref);
  if (pf.kind === 'person') {
    if (pf.kids.length) a.push('子ども：' + pf.kids.map(k => KIDS[k]).join('・'));
    if (pf.work) a.push(WORK[pf.work]);
  } else if (pf.kind === 'biz') {
    if (pf.bform) a.push(BFORM[pf.bform]);
    if (pf.industry) a.push(INDUSTRY[pf.industry]);
    if (pf.staff !== '') a.push(`従業員${pf.staff}名`);
    if (pf.years !== '') a.push(`創業${pf.years}年`);
  } else if (pf.kind === 'npo') {
    if (pf.oform) a.push(OFORM[pf.oform]);
    if (pf.staff !== '') a.push(`職員${pf.staff}名`);
  }
  return a.join(' ・ ');
}

/** 子どもの選択：「いない」と年齢は、どちらかだけ */
export function toggleKid(kids: readonly KidsId[], v: KidsId): KidsId[] {
  const on = kids.includes(v);
  if (v === 'none') return on ? [] : ['none'];
  return on ? kids.filter(x => x !== v) : [...kids.filter(x => x !== 'none'), v];
}

export const toggleAim = (aims: readonly AimId[], v: AimId): AimId[] => (aims.includes(v) ? aims.filter(x => x !== v) : [...aims, v]);
