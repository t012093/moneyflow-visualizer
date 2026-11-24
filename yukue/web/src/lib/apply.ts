/** 申請の準備の記録（制度ごと）。この端末にだけ保存する。 */
import type { ProgramApply } from '../types.ts';

export interface AppRecord {
  /** いまの段階（0：対象の確認 〜 3：提出） */
  step: number;
  /** そろえたものの印 */
  checks: Record<string, boolean>;
  q1: string;
  q2: string;
  /** 下書き（項目ID → 文章） */
  draft: Record<string, string>;
  /** 提出した日（「11月24日」）。まだなら '' */
  done: string;
}

export type AppRecords = Record<string, AppRecord>;

export const newAppRecord = (): AppRecord => ({ step: 0, checks: {}, q1: '', q2: '', draft: {}, done: '' });

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** 保存されていた値を、いまの型に合わせて読み直す */
export function cleanAppRecords(saved: unknown): AppRecords {
  const out: AppRecords = {};
  if (!isObj(saved)) return out;
  for (const [id, raw] of Object.entries(saved)) {
    if (!isObj(raw)) continue;
    const step = typeof raw.step === 'number' && Number.isInteger(raw.step) ? Math.min(3, Math.max(0, raw.step)) : 0;
    const checks: Record<string, boolean> = {};
    if (isObj(raw.checks)) for (const [k, v] of Object.entries(raw.checks)) checks[k] = v === true;
    const draft: Record<string, string> = {};
    if (isObj(raw.draft)) for (const [k, v] of Object.entries(raw.draft)) if (typeof v === 'string') draft[k] = v;
    out[id] = { step, checks, q1: str(raw.q1), q2: str(raw.q2), draft, done: str(raw.done) };
  }
  return out;
}

type DraftSpec = NonNullable<ProgramApply['draft']>;

/**
 * 下書きのひな形。本人の答えをそのまま置き、足りないところを【要記入】で示す。
 * 事実や数字は作らない。
 */
export function localDraft(spec: DraftSpec, q1: string, q2: string): Record<string, string> {
  const known: Record<string, string> = {
    gaiyo: `${q1.trim()}\n【要記入：創業の時期、主な商品やサービス、お客さまの層】`,
    torikumi: `この補助金を使って、次のことに取り組みます。${q2.trim()}\n【要記入：具体的な内容、行う時期、かかる費用の内訳】`,
    kouka: `この取り組みで、新しいお客さまに知ってもらい、売上を伸ばすことをめざします。\n【要記入：目標にする売上や客数と、その根拠】`
  };
  const out: Record<string, string> = {};
  for (const part of spec.parts) out[part.id] = known[part.id] ?? `【要記入：${part.name}】`;
  return out;
}

/** 下書きが1つでも入っているか */
export const hasDraft = (spec: DraftSpec | null | undefined, rec: AppRecord): boolean =>
  !!spec && spec.parts.some(x => !!rec.draft[x.id]);

/** コピー用に、下書きを1つの文章にまとめる */
export const draftText = (spec: DraftSpec, rec: AppRecord): string =>
  spec.parts.map(x => `【${x.name}】\n${rec.draft[x.id] ?? ''}`).join('\n\n');
