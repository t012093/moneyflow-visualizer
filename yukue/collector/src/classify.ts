import type { Stage, ThemeId, UpdateType } from '../../shared/types.ts';
import { extractAmount } from './text.ts';

/**
 * 題と発表元から、種類・分野・段階・重要度を決める規則。
 * ここは「まず外さない」ための粗い判定で、AIによる整形（enrich.ts）が使えるときは、そちらが上書きする。
 */

export type StagedType = Exclude<UpdateType, 'news'>;

export const STAGES: Record<StagedType, string[]> = {
  law: ['検討', '閣議決定', '国会審議', '成立', '公布', '施行'],
  budget: ['概算要求', '政府案', '国会審議', '成立', '執行', '決算'],
  tax: ['要望', '与党大綱', '閣議決定', '国会審議', '成立', '施行'],
  system: ['検討', '意見募集', '決定', '開始'],
  grant: ['予告', '公募中', '審査', '採択']
};

export function stageOf(type: StagedType, index: number, label?: string): Stage {
  return { steps: STAGES[type], index, label: label ?? STAGES[type][index] };
}

const TYPE_RULES: [RegExp, UpdateType][] = [
  [/(補助金|助成金|交付金|支援事業|実証事業|委託事業|補助事業).{0,30}(公募|募集|受付|採択|交付決定)|(公募|募集)(を開始|開始|のお知らせ|について)|採択結果|交付決定/, 'grant'],
  [/税制|税率|減税|増税|課税|控除|租税|消費税|所得税|法人税|関税|印紙税|酒税|たばこ税/, 'tax'],
  [/予算|補正|予備費|決算|概算要求|財政投融資/, 'budget'],
  [/法律案|法案|法律第\d+号|を改正する法律|法律の公布|法律が成立/, 'law'],
  [/政令|省令|告示|指針|ガイドライン|基本方針|基本計画|戦略|大綱|制度|意見募集|パブリック.?コメント|検討会|審議会|分科会|部会|取りまとめ|とりまとめ|報告書|中間整理|答申|建議|閣議決定|閣議了解|推進会議|諮問会議/, 'system']
];

const KEYWORD_THEME: [RegExp, ThemeId][] = [
  // 「公務員災害補償」などが防災に入らないよう、先に受ける
  [/公務員|職員の給与|俸給|裁判官の報酬|検察官|国会議員の秘書/, 'other'],
  [/国債|公債|利払/, 'debt'],
  [/予算|決算|補正|予備費|税制|消費税|所得税|法人税|租税|財政|概算要求/, 'whole'],
  [/年金|医療|介護|保育|子ども|こども|児童|子育て|福祉|障害|雇用保険|生活保護|保健|感染症|肝炎|労災|高齢者|母子|健康保険|医薬|診療報酬/, 'social'],
  [/防衛|自衛隊|自衛官|安全保障/, 'defense'],
  [/地方交付税|地方公共団体|自治体|地方財政|地方創生|地方選|選挙期日|重点支援地方/, 'local'],
  [/道路|河川|港湾|防災|災害|住宅|インフラ|鉄道|空港|下水道|治水|国土強靱|地震/, 'infra'],
  [/教育|学校|大学|高校|授業料|奨学|科学技術|研究開発|文化|スポーツ/, 'edu'],
  [/中小企業|小規模事業者|エネルギー|電気・ガス|電力|ガス料金|燃料|農業|農林|漁業|食料|半導体|GX|脱炭素|排出削減|二酸化炭素|省エネ|再エネ|太陽光|水素|蓄電池|電動化|原子力|革新炉|鉱山|産業|輸出|貿易|観光|スタートアップ/, 'industry']
];

/** 手続きとしては法律や税でも、多くの人の暮らしには直接かかわらないもの。重要度を下げる。 */
const MINOR = /不当廉売関税|関税割当|租税条約|条約|議定書|給与に関する法律|給与等に関する法律|俸給|報酬等に関する法律|公務員|施行期日を定める|発行条件|入札/;

const MINISTRY_THEME: [RegExp, ThemeId][] = [
  [/厚生労働|こども家庭|年金/, 'social'],
  [/防衛/, 'defense'],
  [/国土交通|防災|復興|気象/, 'infra'],
  [/文部科学|スポーツ庁|文化庁/, 'edu'],
  [/経済産業|農林水産|環境省|資源エネルギー|中小企業庁|観光庁/, 'industry'],
  [/総務省|消防庁/, 'local'],
  [/財務省|国税庁|会計検査院/, 'whole']
];

/** 日々の定型の発表。一覧の既定の表示からは外す。 */
const NOISE = /人事異動|幹部名簿|記者会見|会見の概要|会見要旨|入札|落札|調達|企画競争|意見招請|採用|職員の募集|職員募集|非常勤|講演|挨拶|あいさつ|表敬|会談|視察|出席しました|開催しました|開催します|開催案内|開催について|開催日程|開催のお知らせ|傍聴|議事録|議事要旨|議事次第|配布資料|資料$|資料）$|資料について|統計|月報|年報|速報|調査結果|金利情報|外国為替|国庫短期証券|訃報|叙勲|褒章|メールマガジン|広報誌|動画|ポスター|イベント|セミナー|シンポジウム|フォーラム|キャンペーン|更新しました|掲載しました|海外出張|答弁書|報告書及び同報告書に付する/;

/** これがあれば、定型の言い回しが混ざっていても残す。 */
const STRONG = /閣議決定|閣議了解|成立|公布|施行|補正予算|予備費|経済対策|概算要求|税制改正|大綱|基本方針|法律案|法案|公募|意見募集|パブリック|取りまとめ|とりまとめ|建議|答申|発足|創設|引き上げ|引上げ|引き下げ|引下げ|改定|見直し|延長|支給|給付|経済財政諮問会議|税制調査会|決算/;

function detectStage(type: UpdateType, t: string): Stage | undefined {
  switch (type) {
    case 'law':
      if (/公布/.test(t)) return stageOf('law', 4);
      if (/成立/.test(t)) return stageOf('law', 3);
      if (/施行(?!期日|令|規則)/.test(t)) return stageOf('law', 5);
      if (/可決|付託|審議|国会に提出|国会提出/.test(t)) return stageOf('law', 2);
      if (/閣議決定|法律案/.test(t)) return stageOf('law', 1);
      return stageOf('law', 0);
    case 'tax':
      if (/成立/.test(t)) return stageOf('tax', 4);
      if (/可決|審議|国会に提出/.test(t)) return stageOf('tax', 3);
      if (/閣議決定/.test(t)) return stageOf('tax', 2);
      if (/大綱/.test(t)) return stageOf('tax', 1);
      return undefined;
    case 'budget':
      if (/決算/.test(t)) return stageOf('budget', 5);
      if (/予備費|交付決定|執行|配分/.test(t)) return stageOf('budget', 4);
      if (/成立/.test(t)) return stageOf('budget', 3);
      if (/国会に提出|審議/.test(t)) return stageOf('budget', 2);
      if (/概算要求/.test(t)) return stageOf('budget', 0);
      if (/建議|答申/.test(t)) return stageOf('budget', 1, '審議会の提言');
      if (/政府案|予算案|閣議決定/.test(t)) return stageOf('budget', 1);
      if (/編成/.test(t)) return stageOf('budget', 1, '編成中');
      return undefined;
    case 'system':
      if (/意見募集|パブリック.?コメント/.test(t)) return stageOf('system', 1);
      if (/発足|運用開始|開始|施行/.test(t)) return stageOf('system', 3);
      if (/決定|策定|取りまとめ|とりまとめ|公表|答申|建議|政令|省令|告示/.test(t)) return stageOf('system', 2);
      return stageOf('system', 0);
    case 'grant':
      if (/採択|交付決定/.test(t)) return stageOf('grant', 3);
      if (/公募|募集|受付/.test(t)) return stageOf('grant', 1);
      return stageOf('grant', 0);
    default:
      return undefined;
  }
}

export interface ClassifyInput {
  title: string;
  summary?: string;
  ministry: string;
  /** 収集元ごとの加点（官邸や財務省など） */
  boost?: number;
}

export interface Classified {
  type: UpdateType;
  theme: ThemeId;
  stage?: Stage;
  amount?: string;
  importance: number;
  noise: boolean;
}

/** 題のことば → 発表元 の順で分野を決める。補助金のように「◯年度補正予算」が題に付くものは skipWhole で「予算全体」を外す。 */
export function themeOf(title: string, ministry: string, skipWhole = false): ThemeId {
  const hit = KEYWORD_THEME.find(([re, theme]) => !(skipWhole && theme === 'whole') && re.test(title))?.[1];
  return hit ?? MINISTRY_THEME.find(([re]) => re.test(ministry))?.[1] ?? 'other';
}

export function importanceOf(type: UpdateType, stage: Stage | undefined, text: string, amount: string | undefined, noise: boolean, boost = 0): number {
  let s = { law: 55, tax: 55, budget: 55, system: 40, grant: 40, news: 25 }[type] + boost;
  const label = stage?.label ?? '';
  if (/成立/.test(label)) s += 20;
  else if (/公布/.test(label)) s += 15;
  else if (/閣議決定|政府案|決定/.test(label)) s += 12;
  else if (/施行|開始|執行|決算/.test(label)) s += 8;
  else if (/意見募集|公募中/.test(label)) s += 4;
  if (/閣議決定|閣議了解/.test(text)) s += 10;
  if (/補正予算|経済対策|予備費|税制改正|概算要求/.test(text)) s += 12;
  if (/基本方針|大綱|戦略/.test(text)) s += 5;
  if (amount) s += /兆/.test(amount) ? 12 : 6;
  if (MINOR.test(text)) s -= 22;
  if (noise) s = Math.min(s, 15);
  return Math.max(0, Math.min(100, Math.round(s)));
}

export function classify(input: ClassifyInput): Classified {
  const t = input.title;
  const all = `${t} ${input.summary ?? ''}`;
  const type = TYPE_RULES.find(([re]) => re.test(t))?.[1] ?? 'news';
  const noise = NOISE.test(t) && !STRONG.test(t);
  const stage = detectStage(type, t);
  const amount = extractAmount(all);
  return { type, theme: themeOf(t, input.ministry), stage, amount, noise, importance: importanceOf(type, stage, all, amount, noise, input.boost) };
}
