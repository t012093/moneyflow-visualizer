/**
 * ゆくえ：収集システム（collector）と画面（web）が共有するデータの型。
 * yukue/data 以下の JSON は、すべてここの型に従う。
 *
 * Node の型除去（--experimental-strip-types 相当）でそのまま読めるよう、
 * 型と interface だけを置く（enum や namespace は使わない）。
 */

/** 分野。図・一覧・チャットで同じ色を使う。'whole' は予算全体・税。 */
export type ThemeId = 'social' | 'debt' | 'local' | 'defense' | 'infra' | 'edu' | 'industry' | 'other' | 'whole';

export interface Theme {
  name: string;
  /** CSS のカスタムプロパティ名（例：--t1） */
  c: string;
}

/* ---------- 政策の動き ---------- */

/** 動きの種類。'news' は、どれにも当てはまらない発表。 */
export type UpdateType = 'law' | 'budget' | 'tax' | 'system' | 'grant' | 'news';

export interface SourceLink {
  name: string;
  url: string;
}

/** いまの段階。steps[index] が現在地。label は画面に出す言い方。 */
export interface Stage {
  steps: string[];
  index: number;
  label: string;
}

export interface UpdateItem {
  /** 安定したID。収集元ごとに `${sourceId}:${key}` */
  id: string;
  /** 出来事の日付（日本時間、YYYY-MM-DD） */
  date: string;
  type: UpdateType;
  theme: ThemeId;
  /** 画面に出す題 */
  title: string;
  /** 発表元の題（title を書き直したとき） */
  originalTitle?: string;
  /** 1〜2文の要約 */
  summary: string;
  /** 担当・発表元 */
  ministry: string;
  /** 金額（「6,519億円」のような表示用の文字列） */
  amount?: string;
  stage?: Stage;
  /** 締切（補助金・意見募集。YYYY-MM-DD） */
  deadline?: string;
  /** 何が変わる／だれに関係／いつから。人かAIが書いたときだけ入る */
  qa?: { what: string; who: string; when: string };
  /** 一次情報 */
  links: SourceLink[];
  /** 収集元のID（collector/src/sources/registry.ts） */
  sourceId: string;
  /** 最初に見つけた日時（ISO 8601） */
  firstSeen: string;
  /** 重要度 0〜100。「きょうの動き」と並び順に使う */
  importance: number;
  /** 人事・入札・会見など。既定の一覧からは外す */
  noise?: boolean;
  /** だれが整えたか：人（curated）／AI（ai）／規則（rules） */
  enriched: 'curated' | 'ai' | 'rules';
}

export interface UpdatesFile {
  generatedAt: string;
  items: UpdateItem[];
}

export interface Briefing {
  date: string;
  generatedAt: string;
  method: 'curated' | 'ai' | 'rules';
  items: { id: string; text: string }[];
}

export interface CalendarEntry {
  /** 並べ替え用（YYYY-MM-DD。日付が決まっていないものは月末など） */
  date: string;
  /** 表示用（「12.14 月」「12月下旬」） */
  when: string;
  title: string;
  note: string;
  /** 関連する動きのID */
  updateId?: string;
}

/* ---------- 予算（お金の流れ） ---------- */

export interface FlowSource {
  id: string;
  name: string;
  short?: string;
  /** 兆円 */
  v: number;
  tax?: boolean;
  alias?: string[];
  trend?: number[];
  desc: string;
}

export interface DrillItem {
  id: string;
  name: string;
  v: number;
  desc: string;
  /** 届け先ID → 兆円 */
  to: Record<string, number>;
}

export interface FlowUse {
  id: string;
  name: string;
  short?: string;
  long: string;
  v: number;
  theme: ThemeId;
  desc: string;
  trend?: number[];
  drill?: { items: DrillItem[] };
}

export interface BudgetFile {
  fy: {
    label: string;
    west: string;
    kind: string;
    total: number;
    pop: number;
    popNote: string;
    years: number[];
    trend: number[];
    poolDesc: string;
    lifeNote: string;
    capRoot: string;
    capDrill: string;
    srcShort: string;
    srcDrill: string;
    srcChip: string;
    sampleNote: string;
  };
  themes: Record<ThemeId, Theme>;
  src: FlowSource[];
  use: FlowUse[];
  recips: Record<string, string>;
  life: { k: string; d: string; s: '' | 'done' | 'now' }[];
  tiles: { label: string; value: string; unit: string; delta: string; series: number[] }[];
}

/* ---------- 制度 ---------- */

export type Audience = 'family' | 'person' | 'biz' | 'npo' | 'local';

export interface ProgramApply {
  where: string;
  whereNote: string;
  url: string;
  urlName?: string;
  needs: { id: string; name: string; note: string }[];
  draft: null | {
    q1: string;
    q1ph: string;
    q2: string;
    q2ph: string;
    parts: { id: string; name: string }[];
  };
}

/** 人が整えた制度。合うかどうかの規則は web 側が id で持つ。 */
export interface Program {
  id: string;
  name: string;
  kind: string;
  aud: Audience[];
  theme: ThemeId;
  amt: string;
  amtNote: string;
  who: string;
  by: string;
  status: 'open' | 'soon' | 'always';
  statusText: string;
  link: SourceLink;
  apply?: ProgramApply;
}

/** Jグランツの公開APIから取った、受付中の補助金。 */
export interface JGrant {
  id: string;
  title: string;
  /** 対象地域（「全国」「東京都」など） */
  area: string;
  /** 補助上限額（円）。不明なら null */
  maxAmount: number | null;
  /** 受付開始・終了（日本時間、YYYY-MM-DD） */
  start: string | null;
  end: string | null;
  /** 対象の従業員規模（APIの表記のまま） */
  employees: string | null;
  url: string;
}

export interface JGrantsFile {
  generatedAt: string;
  items: JGrant[];
}

/* ---------- 収集の記録 ---------- */

export interface SourceStatus {
  id: string;
  name: string;
  /** 取り方：rss / api / html */
  kind: 'rss' | 'api' | 'html';
  url: string;
  ok: boolean;
  /** 取得した件数／新しく加わった件数 */
  fetched: number;
  added: number;
  /** 前回から中身が変わっていなかったので、読み込みを省いた（このとき fetched は0） */
  unchanged?: boolean;
  /** 失敗したときの理由 */
  error?: string;
  ms: number;
  /** この情報源を最後に確かめた日時（一部の情報源だけを実行した回は、ほかの情報源は前の記録のまま残る） */
  checkedAt?: string;
  /** 続けて失敗している回数（成功すると0に戻る） */
  failures?: number;
  /** 最後に成功した日時 */
  lastOk?: string;
}

export interface RunReport {
  startedAt: string;
  finishedAt: string;
  sources: SourceStatus[];
  totals: { fetched: number; added: number; items: number };
}
