import type { CommandFlags, CommandResult } from './shared.ts';

/**
 * 集めた動きから先を作る処理（発表に付いた資料、案件の組み立て、AIによる資料のポイント、情報源さがし）。
 */
export const DERIVE_HELP = '';

export async function runDeriveCommand(_command: string, _args: string[], _flags: CommandFlags): CommandResult {
  return undefined;
}
