// yukue/data のうち、画面が読むファイルだけを public/data に写す。
// 正本は ../data（収集システムが書きかえる）。public/data は git に入れない。
// 収集システムの内部の記録（data/state など）や過去分（data/updates/archive）は、公開する側には写さない。
// 使い方： npm run sync-data   （dev と build の前に自動で動く）
import { cp, mkdir, readFile, rm, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, '../../data');
const dest = resolve(here, '../public/data');
/** 画面が読むファイルの一覧（src/data/load.ts と共通） */
const files = JSON.parse(await readFile(resolve(here, '../src/data/files.json'), 'utf8'));
/** これが無いと、画面は読み込みの失敗として扱う */
const REQUIRED = ['budget', 'updates', 'programs'];

const exists = async p => {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
};

await rm(dest, { recursive: true, force: true });
await mkdir(dest, { recursive: true });

let copied = 0;
const missing = [];
for (const [key, path] of Object.entries(files)) {
  const from = join(src, path);
  if (!(await exists(from))) {
    missing.push({ key, path });
    continue;
  }
  const to = join(dest, path);
  await mkdir(dirname(to), { recursive: true });
  await cp(from, to);
  copied++;
}

console.log(`[sync-data] ${copied} 件を ${relative(process.cwd(), dest) || dest} に写しました`);
for (const m of missing) console.warn(`[sync-data] 見つかりません: ${join(relative(process.cwd(), src), m.path)}`);
if (missing.some(m => REQUIRED.includes(m.key))) {
  console.error('[sync-data] 必須のデータが足りません（budget / updates / programs）');
  process.exit(1);
}
