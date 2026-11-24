/**
 * 「AIに聞く」の答え手（provider）の約束ごと。
 * いまは手元の規則で答える provider だけ（chat/local.ts）。
 * サーバーで動くAIの provider を足すときは、この ChatProvider を実装して App で差し替える。
 */
import type { ViewId } from '../content.ts';
import type { Model } from '../data/model.ts';
import type { UiState } from '../state/store.ts';
import type { ThemeId } from '../types.ts';

/**
 * 画面を動かす操作。関数ではなく値で表すので、サーバーから返すこともできる。
 * 実行するのは chat/actions.ts の runViewAction。
 */
export type ViewAction =
  /** お金の流れで項目をえらぶ。drill なら内訳まで開く */
  | { kind: 'flow'; id: string; drill: boolean }
  /** 政策の動きを、種類と分野で絞り込む（'all' は絞り込まない） */
  | { kind: 'updates'; type: string; theme: string }
  /** 1件の動きを開く */
  | { kind: 'update'; id: string }
  /** 制度をさがす を、立場で絞り込む。matched なら「あなたに合う制度」 */
  | { kind: 'programs'; aud: string; matched?: boolean }
  /** 画面を切り替えるだけ */
  | { kind: 'view'; view: ViewId }
  /** 申請の準備を始める */
  | { kind: 'apply'; id: string };

export interface FigureItem {
  name: string;
  /** 兆円 */
  v: number;
  theme?: ThemeId;
}

export interface ChatReply {
  text: string;
  /** 答えと一緒に画面を動かす操作。届いたときに1回実行し、あとから押し直せるボタンも出す */
  action?: { label: string; run: ViewAction };
  /** 横棒の小さな図 */
  figure?: { title: string; items: FigureItem[] };
  /** 出典の一行 */
  source?: string;
}

export interface ChatContext {
  /** 読み込んだデータと索引 */
  model: Model;
  /**
   * 画面の状態（見ている画面、えらんでいる項目、この端末の設定など）。
   * 端末の外に出す provider は、state.pf.useInAi が false のとき、設定（state.pf）を送ってはいけない。
   */
  state: UiState;
  /** 「いま見ている画面」の言い方（例：お金の流れ › 防衛） */
  screen: string;
  /** きょう（日本時間、YYYY-MM-DD） */
  today: string;
}

export interface AskOptions {
  /** 利用者が「止める」を押したら中断する */
  signal?: AbortSignal;
  /** 少しずつ届く答えを、その時点の全文で知らせる（使わなければ、届いた全文を画面側が順に表示する） */
  onText?: (textSoFar: string) => void;
}

export interface ChatProvider {
  /** 見出しの横に出す、答え方の呼び名 */
  readonly modeLabel: string;
  /** 入力欄の下の説明 */
  readonly footnote: string;
  ask(question: string, context: ChatContext, options?: AskOptions): Promise<ChatReply>;
}
