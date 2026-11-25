import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { UpdateItem } from '../../shared/types.ts';
import { compareModels, costOf, pickSamples, renderReport } from '../src/compare.ts';
import { fallbackParams, ungroundedNumbers, type Enricher, type EnrichedFields } from '../src/enrich.ts';
import { PoliteClient } from '../src/http.ts';

function item(over: Partial<UpdateItem> & { id: string }): UpdateItem {
  return {
    date: '2026-11-24', type: 'budget', theme: 'whole', title: over.id, summary: '', ministry: '財務省',
    links: [{ name: '財務省', url: `https://www.mof.go.jp/${over.id}.html` }], sourceId: over.id.split(':')[0],
    firstSeen: '2026-11-24T00:00:00.000Z', importance: 60, enriched: 'rules', ...over
  };
}
const fields = (over: Partial<EnrichedFields> = {}): EnrichedFields => ({ title: '題', summary: '要約', what: '何が', who: 'だれに', when: 'いつ', type: 'budget', theme: 'whole', importance: 70, noise: false, ...over });

test('本文にない数字：全角・桁区切りをそろえて比べ、1桁の数字は見ない', () => {
  const source = '予備費から６，５１９億円を使う。令和8年12月から3か月分。';
  assert.deepEqual(ungroundedNumbers(fields({ summary: '予備費6,519億円を、12月から3か月分の支援に使う。' }), source), []);
  assert.deepEqual(ungroundedNumbers(fields({ summary: '予備費7,000億円を使い、約2,400万世帯が対象。', when: '2026年12月から' }), source), ['7000', '2400', '2026']);
});

test('引き継ぎの指定：Haiku には付けず、ほかのモデルには付ける', () => {
  assert.deepEqual(fallbackParams('claude-haiku-5-5'), {});
  assert.deepEqual(fallbackParams('claude-sonnet-5-5'), { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
});

test('比べる項目：定型と人が書いた分を除き、重要度の高い順に、情報源がかたよらないように取る', () => {
  const items = [
    item({ id: 'shugiin:a', importance: 63 }), item({ id: 'shugiin:b', importance: 62 }), item({ id: 'shugiin:c', importance: 61 }),
    item({ id: 'mof:a', importance: 55 }), item({ id: 'kakugi:a', importance: 52 }),
    item({ id: 'mof:noise', importance: 90, noise: true }), item({ id: 'curated:x', importance: 95 }), item({ id: 'mof:low', importance: 30 })
  ];
  assert.deepEqual(pickSamples(items, 4).map(i => i.id), ['shugiin:a', 'mof:a', 'kakugi:a', 'shugiin:b']);
  assert.equal(pickSamples(items, 50).length, 5);
});

test('費用：料金表にあるモデルだけ金額を出す', () => {
  assert.equal(costOf('claude-sonnet-5-5', { input: 7000, output: 1000 }), 0.024);
  assert.equal(costOf('some-other-model', { input: 1, output: 1 }), null);
});

test('比較：同じ本文を各モデルに渡し、結果・使用量・本文にない数字を報告にまとめる', async () => {
  const pages: string[] = [];
  const http = new PoliteClient({
    userAgent: 'yukue-collector/0.1 (test)', minIntervalMs: 0, timeoutMs: 1000, state: {}, respectRobots: false,
    fetchImpl: (async (input: RequestInfo | URL) => { pages.push(String(input)); return new Response('<main>予備費から6,519億円を使う。</main>'); }) as typeof fetch
  });
  const got: string[] = [];
  const makeEnricher = (model: string, onUsage: (u: { input: number; output: number }) => void): Enricher => ({
    async enrich(it, text) {
      got.push(`${model}|${it.title}|${text}`);
      onUsage({ input: 7000, output: 1000 });
      if (model === 'broken') throw new Error('一時的な失敗');
      return fields({ title: `${model}の題`, summary: model === 'claude-haiku-5-5' ? '予備費9,999億円を使う。' : '予備費6,519億円を使う。' });
    }
  });
  const models = ['claude-haiku-5-5', 'claude-sonnet-5-5', 'broken'];
  const r = await compareModels([item({ id: 'mof:a', title: 'やさしい題', originalTitle: '予備費使用について' })], http, { models, makeEnricher, log: () => {} });
  assert.equal(pages.length, 1, '本文は1回だけ取りに行く');
  assert.ok(got.every(g => g.includes('|予備費使用について|予備費から6,519億円を使う。')), 'どのモデルにも、もとの題と同じ本文を渡す');
  assert.deepEqual(r[0].results.map(x => x.ungrounded), [['9999'], [], []]);
  const md = renderReport(r, models, '2026-11-25T00:00:00.000Z');
  assert.match(md, /\| claude-haiku-5-5 \| 1\/1 \| 1 \| 0 \| 7,000 \| 1,000 \| \$0\.0012 /);
  assert.match(md, /\| claude-sonnet-5-5 \| 1\/1 \| 0 \| 0 \| 7,000 \| 1,000 \| \$0\.0240 /);
  assert.match(md, /\| 本文にない数字 \| 9999 \| なし \| 失敗：一時的な失敗 \|/);
});
