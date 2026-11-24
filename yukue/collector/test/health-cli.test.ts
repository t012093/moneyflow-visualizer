import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { RunReport, SourceStatus } from '../../shared/types.ts';
import { mergeReportSources, trackHealth, type HealthState } from '../src/store.ts';

const NOW = new Date('2026-11-24T16:00:00Z');
const CLI = fileURLToPath(new URL('../src/cli.ts', import.meta.url));

function status(over: Partial<SourceStatus> & { id: string }): SourceStatus {
  return { name: over.id, kind: 'rss', url: `https://example.go.jp/${over.id}.xml`, ok: true, fetched: 1, added: 0, ms: 10, ...over };
}

/** 一時フォルダーをデータの置き場にして、コマンドを実行する。通信はしない命令だけを試す。 */
function runCli(args: string[], report?: RunReport, env: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'yukue-cli-'));
  if (report) {
    mkdirSync(join(dir, 'runs'), { recursive: true });
    writeFileSync(join(dir, 'runs/latest.json'), JSON.stringify(report));
  }
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: { ...process.env, YUKUE_DATA_DIR: dir, ...env } });
  return { code: r.status, out: r.stdout + r.stderr };
}

const report = (sources: SourceStatus[]): RunReport => ({ startedAt: NOW.toISOString(), finishedAt: NOW.toISOString(), sources, totals: { fetched: 0, added: 0, items: 0 } });

test('調子の記録：失敗は数え、成功で0に戻り、最後に成功した日時は失敗しても残る', () => {
  const health: HealthState = {};
  assert.deepEqual(trackHealth(health, 'mof', false, NOW), { failures: 1 });
  assert.deepEqual(trackHealth(health, 'mof', false, NOW), { failures: 2 });
  assert.deepEqual(trackHealth(health, 'mof', true, NOW), { failures: 0, lastOk: NOW.toISOString() });
  const later = new Date(NOW.getTime() + 86_400_000);
  assert.deepEqual(trackHealth(health, 'mof', false, later), { failures: 1, lastOk: NOW.toISOString() });
  assert.deepEqual(health, { mof: { failures: 1, lastOk: NOW.toISOString() } });
});

test('実行の記録：一部だけ実行しても、ほかの情報源の前回の記録は残り、登録から外したものは消える', () => {
  const prev = report([status({ id: 'mof', fetched: 100 }), status({ id: 'mhlw', fetched: 50 }), status({ id: 'gone' })]);
  const merged = mergeReportSources(prev, ['kantei', 'mof', 'mhlw'], [status({ id: 'mof', ok: false, fetched: 0, error: 'HTTP 503' })]);
  assert.deepEqual(merged.map(s => [s.id, s.ok, s.fetched]), [['mof', false, 0], ['mhlw', true, 50]]);
  assert.deepEqual(mergeReportSources(null, ['mof'], [status({ id: 'mof' })]).map(s => s.id), ['mof']);
});

test('health：続けて失敗している情報源があると、終了コード1で知らせる', () => {
  const failing = report([status({ id: 'mof' }), status({ id: 'pubcomment', name: 'e-Gov パブリック・コメント', ok: false, error: 'HTTP 403', failures: 6, lastOk: '2026-11-20T21:17:00.000Z' })]);
  const bad = runCli(['health'], failing);
  assert.equal(bad.code, 1);
  assert.match(bad.out, /e-Gov パブリック・コメント: 6回続けて失敗（HTTP 403）／最後に成功したのは 2026-11-21/);
  assert.match(bad.out, /6回以上続けて失敗しています/);
  // まだ回数が少ないうちは、知らせるだけで失敗にはしない
  const early = runCli(['health', '--max-failures', '7'], failing);
  assert.equal(early.code, 0);
  assert.match(early.out, /7回以上続けて失敗している情報源はありません/);
});

test('health：すべて取得できていれば0、記録がなければ1、回数の指定がおかしければ2', () => {
  const ok = runCli(['health'], report([status({ id: 'mof' })]));
  assert.equal(ok.code, 0);
  assert.match(ok.out, /すべての情報源が、前回の実行で取得できています/);
  assert.equal(runCli(['health']).code, 1);
  assert.equal(runCli(['health', '--max-failures', '0'], report([status({ id: 'mof' })])).code, 2);
});

test('設定：空の環境変数は未設定として扱い、短すぎる取得間隔は受け付けない', () => {
  const blank = runCli(['sources'], undefined, { YUKUE_USER_AGENT: '', YUKUE_MIN_INTERVAL_MS: ' ', YUKUE_MODEL: '', YUKUE_ENRICH_LIMIT: '' });
  assert.equal(blank.code, 0);
  assert.match(blank.out, /^kantei\s+rss/m);
  const tooFast = runCli(['sources'], undefined, { YUKUE_MIN_INTERVAL_MS: '0' });
  assert.notEqual(tooFast.code, 0);
  assert.match(tooFast.out, /YUKUE_MIN_INTERVAL_MS は 500 以上の数で指定してください/);
});

test('知らないコマンドは、使い方を出して終了コード2', () => {
  const r = runCli(['fetch-everything']);
  assert.equal(r.code, 2);
  assert.match(r.out, /知らないコマンドです: fetch-everything/);
});
