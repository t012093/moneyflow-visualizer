import { MIN_INTERVAL_MS, TIMEOUT_MS, USER_AGENT } from '../config.ts';
import { PoliteClient, type HttpState } from '../http.ts';

/** コマンドラインの共通の指定。cli.ts が読み取って、各コマンドに渡す */
export interface CommandFlags {
  dryRun: boolean;
  force: boolean;
  full: boolean;
  only?: string;
  limit?: string;
  year?: string;
  model?: string;
  out?: string;
}

/** コマンドの結果。自分のコマンドでなければ undefined を返す（cli.ts が次の担当に回す） */
export type CommandResult = Promise<number | undefined>;

/** 相手に負担をかけない取得（robots.txt、間隔、変わっていなければ受け取らない）。state は data/state/http.json の中身 */
export function politeClient(state: HttpState): PoliteClient {
  return new PoliteClient({ userAgent: USER_AGENT, minIntervalMs: MIN_INTERVAL_MS, timeoutMs: TIMEOUT_MS, state });
}
