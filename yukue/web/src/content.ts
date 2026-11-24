/** 画面にそのまま出す決まった文言と選択肢。データ（yukue/data）に入っていないものをここに置く。 */
import type { Audience, SourceLink, SourceStatus, ThemeId, UpdateType } from './types.ts';
import type { IconName } from './components/Icons.tsx';

export type ViewId = 'home' | 'flow' | 'updates' | 'find' | 'me' | 'apply' | 'connect' | 'about';

export const VIEWS: readonly ViewId[] = ['home', 'flow', 'updates', 'find', 'me', 'apply', 'connect', 'about'];

export const VIEW_NAMES: Record<ViewId, string> = {
  home: 'ホーム',
  flow: 'お金の流れ',
  updates: '政策の動き',
  find: '制度をさがす',
  me: 'マイページ',
  apply: '申請の準備',
  connect: 'AIとつなぐ',
  about: 'このサイトについて'
};

/** 動きの種類。'news' は、どれにも当てはまらない発表 */
export const TYPES: Record<UpdateType, { n: string; i: IconName }> = {
  law: { n: '法律', i: 'law' },
  budget: { n: '予算', i: 'yen' },
  tax: { n: '税', i: 'pct' },
  system: { n: '制度', i: 'flag' },
  grant: { n: '補助金', i: 'gift' },
  news: { n: '発表', i: 'news' }
};
export const TYPE_IDS = Object.keys(TYPES) as UpdateType[];
export const isUpdateType = (v: string): v is UpdateType => Object.hasOwn(TYPES, v);
/** 知らない種類が来たら「発表」として扱う */
export const typeInfo = (t: string): { n: string; i: IconName } => (isUpdateType(t) ? TYPES[t] : TYPES.news);

/** 分野のID（型と同じ一覧を、実行時の確認にも使う） */
const THEME_KEYS: Record<ThemeId, true> = {
  social: true,
  debt: true,
  local: true,
  defense: true,
  infra: true,
  edu: true,
  industry: true,
  other: true,
  whole: true
};
export const isThemeId = (v: string): v is ThemeId => Object.hasOwn(THEME_KEYS, v);

export type AudId = Audience | 'all';
export const AUD: Record<AudId, string> = {
  all: 'すべて',
  family: '子育て世帯',
  person: '個人',
  biz: '事業者・中小企業',
  npo: 'NPO・団体',
  local: '自治体'
};
export const isAudId = (v: string): v is AudId => Object.hasOwn(AUD, v);

/* プロフィールの選択肢 */
export const KIND = { person: '個人', biz: '事業者', npo: 'NPO・団体', local: '自治体' } as const;
export const KIDS = { pre: '未就学', school: '小・中学生', high: '高校生年代', none: 'いない' } as const;
export const WORK = {
  emp: '会社員・公務員',
  part: 'パート・アルバイト',
  self: '自営・フリーランス',
  seek: '求職中',
  student: '学生',
  pension: '年金でくらしている'
} as const;
export const KOYO = { yes: '入っている・入っていた', no: '入ったことがない', unk: 'わからない' } as const;
export const INCOME = { a: '300万円未満', b: '300〜600万円', c: '600〜900万円', d: '900万円以上' } as const;
export const BFORM = { sole: '個人事業主', sme: '中小企業（法人）', large: '大企業' } as const;
export const INDUSTRY = {
  make: '製造',
  shop: '小売・飲食',
  service: 'サービス',
  build: '建設',
  it: 'IT・情報',
  agri: '農林水産',
  etc: 'その他'
} as const;
export const AIMS = {
  sales: '販路を広げる',
  invest: '設備投資・省エネ',
  gx: '脱炭素（GX）',
  wage: '賃上げ',
  hire: '人を雇う・正社員にする'
} as const;
export const OFORM = { npo: 'NPO法人', assoc: '一般社団・財団法人', vol: '任意団体' } as const;

/** 合うかどうかの段階。o は並び順 */
export const LV = {
  high: { n: '対象の可能性が高い', o: 0 },
  when: { n: '必要なときに使える', o: 1 },
  later: { n: 'これから対象になる', o: 2 },
  maybe: { n: '条件しだい', o: 3 },
  no: { n: '対象外の見込み', o: 4 }
} as const;
export type MatchLevel = keyof typeof LV;

export const ASTEPS = ['対象の確認', 'そろえるもの', '下書き', '提出'] as const;

export const PREFS: readonly string[] =
  '北海道 青森県 岩手県 宮城県 秋田県 山形県 福島県 茨城県 栃木県 群馬県 埼玉県 千葉県 東京都 神奈川県 新潟県 富山県 石川県 福井県 山梨県 長野県 岐阜県 静岡県 愛知県 三重県 滋賀県 京都府 大阪府 兵庫県 奈良県 和歌山県 鳥取県 島根県 岡山県 広島県 山口県 徳島県 香川県 愛媛県 高知県 福岡県 佐賀県 長崎県 熊本県 大分県 宮崎県 鹿児島県 沖縄県'.split(
    ' '
  );

/** ホームの「フォロー中のテーマ」。いまは決まった3つ（ログインと通知は、まだ画面の再現だけ） */
export const FOLLOW: readonly ThemeId[] = ['social', 'industry', 'local'];

/** 一覧を少しずつ出すときの1回ぶんの件数 */
export const PAGE_SIZE = 60;

/** 収集の取り方の呼び名 */
export const FETCH_KIND: Record<SourceStatus['kind'], string> = { rss: 'RSS', api: 'API', html: 'ページの巡回' };

/** 「AIとつなぐ」に出す、コネクターの道具の一覧 */
export const TOOLS: readonly { name: string; desc: string; badge?: string }[] = [
  { name: 'show_flow', desc: 'お金の流れを図で表示する（年度・分野・階層を指定）' },
  { name: 'get_budget_item', desc: '予算の項目や事業の金額、推移、出典を返す' },
  { name: 'list_updates', desc: '政策の動きを、種類・分野・期間で一覧する' },
  { name: 'get_update', desc: '1件の動きの要点、いまの段階、一次情報を返す' },
  { name: 'find_programs', desc: '立場や地域に合う制度・補助金をさがす' },
  { name: 'search', desc: '事業・法律・制度をキーワードで横断検索する' },
  { name: 'match_programs', desc: 'ログインした人の設定に合う制度を、理由つきで返す', badge: 'ログインが必要' },
  { name: 'prepare_application', desc: '申請に必要なものの一覧と、文章の下書きを返す（提出はしない）', badge: 'ログインが必要' }
];

export const MCP_URL = 'https://mcp.yukue.example/mcp';

/** 「このサイトについて」：提出は本人が行う理由 */
export const LAW_NOTE =
  '他人の依頼を受け、報酬を得て官公署に出す書類を作ることは、行政書士法で行政書士に限られています。2026年1月施行の改正で「いかなる名目によるかを問わず」と明記されました。雇用関係の助成金（キャリアアップ助成金など）は、社会保険労務士法で社会保険労務士の業務です。総務省の回答例では、利用者が自分の判断で書類を作るための道具なら、作成者は利用者本人とされています。一方、AIが文章の中身まで書くことについての公式の見解は、まだ見当たりません。そのため、ゆくえは本人が自分で書いて自分で出すのを助ける道具にとどめ、送信の代行はしません。下書きの機能を有料の範囲に入れる前に、専門家と所管の窓口に確認します。';

export const LAW_LINKS: readonly SourceLink[] = [
  { name: '行政書士法（e-Gov）', url: 'https://laws.e-gov.go.jp/law/326AC1000000004' },
  { name: '社会保険労務士法（e-Gov）', url: 'https://laws.e-gov.go.jp/law/343AC1000000089' },
  { name: '行政書士制度（総務省）', url: 'https://www.soumu.go.jp/main_sosiki/jichi_gyousei/gyouseishoshi/index.html' },
  { name: '外国にある第三者への提供（個人情報保護委員会）', url: 'https://www.ppc.go.jp/personalinfo/legal/guidelines_offshore/' }
];

/** 「AIに聞く」の今の答え方（手元の規則で答える） */
export const CHAT_MODE_LABEL = 'かんたん応答（試作）';
export const CHAT_FOOTNOTE = 'あらかじめ用意した規則で答える、かんたん応答です。公開版では、出典つきでAIが答えます。';
export const CHAT_GREETING = '国のお金の流れや、最近の政策の動きについて聞いてください。答えに合わせて、左の画面も動かします。';
