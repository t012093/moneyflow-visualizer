import type { CommandFlags, CommandResult } from './shared.ts';

/**
 * まとまったデータの取り込み（行政事業レビュー、国のデータの目録）。
 * 毎日の collect とは別に、週に1回ほど実行する。
 */
export const DATASET_HELP = '';

export async function runDatasetCommand(_command: string, _args: string[], _flags: CommandFlags): CommandResult {
  return undefined;
}
