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
  /** 発表ページに付いていた資料（PDF・Excel など）。多いときは先頭から12件 */
  docs?: DocLink[];
  /** docs を確かめた日時（ISO 8601）。資料がなかったときも入る（取り直さないため） */
  docsChecked?: string;
  /** AIが資料から作ったポイント。どの資料の何ページの、どの文にもとづくかを必ず持つ */
  points?: DocPoint[];
  /** points を作ろうとした日時（ISO 8601）。作れなかったときも入る（やり直さないため） */
  pointsChecked?: string;
}

/** 資料の種類。画面の印と、読み方の切り替えに使う */
export type DocKind = 'pdf' | 'sheet' | 'csv' | 'zip' | 'doc' | 'slide' | 'other';

export interface DocLink {
  title: string;
  url: string;
  kind: DocKind;
}

export interface DocPoint {
  /** ポイントの文（1〜2文） */
  text: string;
  /** docs の何番目の資料か（0始まり） */
  doc: number;
  /** ページ（1始まり）。ページのない資料は null */
  page: number | null;
  /** 根拠にした元の文（資料からそのまま抜き出したもの） */
  quote: string;
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
  /** 行政事業レビューの「主要経費」の名前。この内訳に入る事業をさがすのに使う */
  cats?: string[];
  /** 出典（BudgetFile.sources の id） */
  src?: string;
}

/** 予算の数字の出典 */
export interface BudgetSource {
  id: string;
  name: string;
  url: string;
  /** 資料の中の場所（「3ページ 主要経費別内訳」など） */
  where?: string;
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
  /** 出典（BudgetFile.sources の id） */
  src?: string;
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
  /** 数字の出典。use[].src と drill.items[].src がここを指す */
  sources?: BudgetSource[];
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
  /** 取り方：rss / api / html / file（CSVなどの一括ダウンロード） */
  kind: 'rss' | 'api' | 'html' | 'file';
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

/* ---------- 案件（時間をかけて進むもの。ウォッチの単位） ---------- */

export interface MatterEvent {
  /** YYYY-MM-DD。日が分からないときは YYYY-MM */
  date: string;
  /** steps の何番目の段階で起きたか */
  at: number;
  text: string;
  /** もとになった動きのID */
  updateId?: string;
  links?: SourceLink[];
}

/** まだ決まっていないこと。発表にもとづくものだけを持つ */
export interface OpenPoint {
  /** 何が決まっていないか（「規模（総額）」） */
  q: string;
  /** 段階の線の上に出す短い名前（「規模」） */
  s: string;
  /** steps の何番目の段階で決まる見込みか */
  at: number;
  /** said：発表で「未定」とされている ／ silent：発表に書かれていない */
  basis: 'said' | 'silent';
  /** 発表の中の元の言葉 */
  quote?: string;
  /** 分かる時期の目安 */
  due?: string;
  /** だれが書いたか */
  by: 'curated' | 'ai';
}

export interface MatterNext {
  /** steps の何番目の段階か */
  at: number;
  /** 時期（「日程は未公表」「例年は12月下旬」） */
  when: string;
  /** 段階の線の上に出す短い言い方 */
  s?: string;
  /** 何が起きるか（「政府案の閣議決定」） */
  what: string;
  note?: string;
}

export interface Matter {
  /** 国会の議案は動きと同じID（gian:...）。人が定義したものは m:... */
  id: string;
  title: string;
  type: Exclude<UpdateType, 'news'>;
  theme: ThemeId;
  steps: string[];
  /** いまの段階（steps の何番目か） */
  cur: number;
  amount?: string;
  summary?: string;
  qa?: { what: string; who: string; when: string };
  /** 古い順 */
  events: MatterEvent[];
  open?: OpenPoint[];
  next?: MatterNext;
  links: SourceLink[];
  /** この案件に関係する動きのID（新しい順） */
  updateIds: string[];
  /** bill：国会の議案から自動で組み立てた ／ curated：人が定義し、動きを自動でひも付けた */
  origin: 'bill' | 'curated';
  /** いま動いている案件として、ウォッチの候補に出す */
  top?: boolean;
  /** いちばん新しい出来事の日付（YYYY-MM-DD） */
  updatedAt: string;
}

export interface MattersFile {
  generatedAt: string;
  items: Matter[];
}

/* ---------- 行政事業レビュー（事業ごとの予算・執行・支出先） ---------- */

/** 一覧と検索のための軽い索引。金額は円 */
export interface RsProjectLite {
  /** 予算事業ID（6桁） */
  id: string;
  /** 事業名 */
  n: string;
  /** 府省庁（RsIndexFile.ministries の id） */
  m: string;
  /** 主要経費（複数あるときは先頭のもの） */
  c: string;
  /** 今年度の当初予算（一般会計と特別会計の合計） */
  b: number;
  /** うち一般会計 */
  g: number;
  /** 前年度の執行額 */
  e: number | null;
  /** 前年度の執行率（％） */
  r: number | null;
  /** 翌年度の要求額 */
  q: number | null;
}

export interface RsMinistry {
  id: string;
  name: string;
  projects: number;
  /** 今年度の当初予算（円）：一般会計／特別会計 */
  general: number;
  special: number;
  /** 前年度の執行額（円） */
  exec: number;
}

export interface RsCategory {
  /** 主要経費の名前（財務省の区分） */
  name: string;
  /** 一般会計・当初予算の合計（円）。事業が複数の主要経費にまたがるときは、先頭の区分に入れている */
  budget: number;
  projects: number;
  /** 府省庁ごとの内訳（上位6つ。id → 円） */
  by: Record<string, number>;
}

export interface RsIndexFile {
  generatedAt: string;
  /** レビューシートの事業年度 */
  sheetYear: number;
  /** 元のファイルの更新日（YYYY-MM-DD） */
  asOf: string | null;
  source: { name: string; url: string; license: string };
  /** detail/NNN.json の1ファイルあたりの件数。事業 i（projects の並び）は detail/floor(i/shardSize) にある */
  shardSize: number;
  totals: { projects: number; general: number; special: number; exec: number };
  ministries: RsMinistry[];
  categories: RsCategory[];
  projects: RsProjectLite[];
}

/** [年度, 当初, 補正, 前年度から繰越し, 予備費等, 歳出予算現額, 執行額, 執行率, 翌年度要求額]（金額は円、合計は一般会計＋特別会計） */
export type RsYear = [number, number, number, number, number, number | null, number | null, number | null, number | null];

export interface RsPayee {
  name: string;
  /** 法人番号（13桁）。ないときは null */
  corp: string | null;
  /** 支出額（円） */
  amount: number;
  /** 契約の件数 */
  n: number;
  /** いちばん大きい契約の方式（「一般競争契約（最低価格）」など） */
  method: string | null;
  /** いちばん大きい契約の概要 */
  what: string | null;
  /** 事業の中での役割 */
  role: string | null;
  /** 担当の府省庁から直接支出されたか（false は、その先の支出） */
  direct: boolean;
}

export interface RsProject {
  id: string;
  name: string;
  ministry: string;
  bureau: string | null;
  /** 主要経費（先頭が主） */
  cats: string[];
  /** 事業区分（「前年度事業」「新規開始事業」など） */
  kind: string | null;
  start: number | null;
  end: number | null;
  /** 事業の目的・概要（長いものは途中まで） */
  purpose: string;
  overview: string;
  /** 府省庁の事業紹介ページ */
  url: string | null;
  /** 実施方法（直接実施・補助・負担・交付・分担金・拠出金・その他） */
  methods: string[];
  accounts: string[];
  years: RsYear[];
  /** 支出先（支出額の大きい順に上位） */
  payees: RsPayee[];
  payeeCount: number;
  /** 公式のレビューシート */
  sheet: string | null;
}

export interface RsDetailFile {
  items: RsProject[];
}

/** 法人番号ごとに、支出先としての合計をまとめたもの（検索用） */
export interface RsCorp {
  /** 法人番号 */
  id: string;
  n: string;
  /** 記載された支出額の合計（円）。事業の中の支出の段階が重なると、二重に数えていることがある */
  a: number;
  /** 記載の件数 */
  k: number;
  /** 支出額の大きい事業（予算事業ID、最大5件） */
  p: string[];
}

export interface RsPayeesFile {
  generatedAt: string;
  items: RsCorp[];
}

/* ---------- 国のデータの目録（e-Govデータポータル） ---------- */

export interface CatalogItem {
  /** データセットのID（https://data.e-gov.go.jp/data/dataset/{id}） */
  id: string;
  /** 題 */
  t: string;
  /** 機関（CatalogFile.orgs の id） */
  o: string;
  /** ファイルの形式（PDF・XLSX・CSV など。重複なし） */
  f: string[];
  /** 更新日（YYYY-MM-DD） */
  m: string;
  /** ファイルの数 */
  n: number;
}

export interface CatalogFile {
  generatedAt: string;
  source: { name: string; url: string; license: string };
  total: number;
  orgs: { id: string; name: string; count: number }[];
  items: CatalogItem[];
}
