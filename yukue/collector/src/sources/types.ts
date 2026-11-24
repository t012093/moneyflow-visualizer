import type { JGrant, UpdateItem } from '../../../shared/types.ts';
import type { HttpState, PoliteClient } from '../http.ts';

/** 実行をまたいで持ち越す状態（yukue/data/state）。 */
export interface CollectorState {
  http: HttpState;
  /** 処理ずみの目印（閣議の回、Jグランツの補助金など）→ 最初に見た日時 */
  seen: Record<string, string>;
  /** 議案ごとの前回の審議状況。変わったときだけ経過ページを取りに行く */
  gian: Record<string, { status: string }>;
}

export interface Ctx {
  http: PoliteClient;
  now: Date;
  state: CollectorState;
  log: (msg: string) => void;
}

export interface SourceResult {
  items: UpdateItem[];
  /** 相手から受け取った件数（重複や対象外を除く前） */
  fetched: number;
  /** 前回から中身が変わっていなかった（304、または同じ内容）ので、読み込みを省いた */
  unchanged?: boolean;
  grants?: JGrant[];
}

export interface Source {
  id: string;
  name: string;
  kind: 'rss' | 'api' | 'html';
  url: string;
  run(ctx: Ctx): Promise<SourceResult>;
}
