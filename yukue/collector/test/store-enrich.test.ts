import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Briefing, UpdateItem, UpdatesFile } from '../../shared/types.ts';
import { stageOf } from '../src/classify.ts';
import { applyEnrichment, enrichItems, isReadablePage, mainText, type Enricher } from '../src/enrich.ts';
import { PoliteClient } from '../src/http.ts';
import { buildBriefing, mergeUpdates, readArchive, rebuildFromArchive, writeArchive } from '../src/store.ts';
import { addDays } from '../src/text.ts';

const NOW = new Date('2026-11-24T16:00:00Z'); // 日本時間 11月25日

function item(over: Partial<UpdateItem> & { id: string }): UpdateItem {
  return {
    date: '2026-11-24', type: 'news', theme: 'other', title: over.id, summary: '', ministry: '財務省',
    links: [{ name: '財務省', url: `https://www.mof.go.jp/${over.id}.html` }], sourceId: 'mof',
    firstSeen: '2026-11-24T00:00:00.000Z', importance: 30, enriched: 'rules', ...over
  };
}

test('重ね合わせ：新しいものを足し、同じIDは上書きするが、最初に見つけた日時は保つ', () => {
  const prev = [item({ id: 'mof:a', title: '古い題', firstSeen: '2026-11-20T00:00:00.000Z' })];
  const r = mergeUpdates(prev, [], [item({ id: 'mof:a', title: '新しい題', firstSeen: NOW.toISOString() }), item({ id: 'mof:b' })], NOW);
  assert.deepEqual(r.addedIds, ['mof:b']);
  const a = r.items.find(i => i.id === 'mof:a')!;
  assert.deepEqual([a.title, a.firstSeen], ['新しい題', '2026-11-20T00:00:00.000Z']);
  assert.deepEqual(r.touched.map(t => t.id).sort(), ['mof:a', 'mof:b']);
});

test('重ね合わせ：AIが整えた項目は、段階が変わらないかぎり書き戻さない', () => {
  const ai = item({ id: 'gian:kaku-222-1', sourceId: 'shugiin', title: 'やさしい題', originalTitle: '消費税法案', enriched: 'ai', stage: stageOf('law', 2, '衆議院で審議中') });
  const same = item({ id: ai.id, sourceId: 'shugiin', title: '消費税法案', stage: stageOf('law', 2, '衆議院で審議中') });
  assert.equal(mergeUpdates([ai], [], [same], NOW).items[0].title, 'やさしい題');
  const moved = { ...same, stage: stageOf('law', 3) };
  const after = mergeUpdates([ai], [], [moved], NOW).items[0];
  assert.deepEqual([after.title, after.enriched, after.stage?.label], ['消費税法案', 'rules', '成立']);
});

test('重ね合わせ：人が整えた項目は常に残し、同じ一次情報を指す収集分は出さない', () => {
  const curated = item({ id: 'curated:x', sourceId: 'curated', enriched: 'curated', importance: 90, links: [{ name: '衆議院', url: 'https://www.shugiin.go.jp/keika/1.htm' }] });
  const dup = item({ id: 'gian:kaku-222-9', sourceId: 'shugiin', links: [{ name: '衆議院 議案経過', url: 'https://www.shugiin.go.jp/keika/1.htm' }] });
  const r = mergeUpdates([], [curated], [dup, item({ id: 'mof:c' })], NOW);
  assert.deepEqual(r.items.map(i => i.id), ['curated:x', 'mof:c']);
  assert.deepEqual(r.addedIds, ['mof:c']);
});

test('重ね合わせ：同じ法律は、閣議の公布決定を国会の議案のほうにまとめる', () => {
  const bill = item({ id: 'gian:kaku-222-10', sourceId: 'shugiin', type: 'law', title: '防衛省の職員の給与等に関する法律の一部を改正する法律', originalTitle: '防衛省の職員の給与等に関する法律の一部を改正する法律案', links: [{ name: '衆議院 議案経過', url: 'https://www.shugiin.go.jp/keika/2.htm' }] });
  const cabinet = item({ id: 'kakugi:2026111701:abc', sourceId: 'kakugi', type: 'law', title: '防衛省の職員の給与等に関する法律の一部を改正する法律', links: [{ name: '首相官邸 閣議案件', url: 'https://www.kantei.go.jp/k.html#:~:text=x' }] });
  const r = mergeUpdates([], [], [cabinet, bill], NOW);
  assert.deepEqual(r.items.map(i => i.id), ['gian:kaku-222-10']);
  assert.deepEqual(r.items[0].links.map(l => l.name), ['衆議院 議案経過', '首相官邸 閣議案件']);
});

test('重ね合わせ：古いものは一覧から外し、新しい順・重要度順に並べる', () => {
  const r = mergeUpdates([], [], [
    item({ id: 'mof:old', date: '2026-08-01' }),
    item({ id: 'mof:low', date: '2026-11-24', importance: 20 }),
    item({ id: 'mof:high', date: '2026-11-24', importance: 80 }),
    item({ id: 'mof:yesterday', date: '2026-11-23', importance: 99 })
  ], NOW);
  assert.deepEqual(r.items.map(i => i.id), ['mof:high', 'mof:low', 'mof:yesterday']);
});

test('月ごとの保管用ファイルに重ねて書く', () => {
  const dir = mkdtempSync(join(tmpdir(), 'yukue-'));
  writeArchive(dir, [item({ id: 'mof:a' }), item({ id: 'mof:b', date: '2026-10-30' })], NOW);
  writeArchive(dir, [item({ id: 'mof:a', title: '直した題' }), item({ id: 'mof:c' })], NOW);
  const nov = JSON.parse(readFileSync(join(dir, 'updates/archive/2026-11.json'), 'utf8')) as UpdatesFile;
  assert.deepEqual(nov.items.map(i => [i.id, i.title]), [['mof:a', '直した題'], ['mof:c', 'mof:c']]);
  assert.equal((JSON.parse(readFileSync(join(dir, 'updates/archive/2026-10.json'), 'utf8')) as UpdatesFile).items.length, 1);
});

test('きょうのまとめ：直近3日の重要なものから3件。定型の発表は入れない', () => {
  const items = [
    item({ id: 'a', importance: 90, date: '2026-11-25' }),
    item({ id: 'b', importance: 95, date: '2026-11-20' }),
    item({ id: 'c', importance: 99, date: '2026-11-25', noise: true }),
    item({ id: 'd', importance: 70, date: '2026-11-24', enriched: 'ai', summary: 'AIの要約' }),
    item({ id: 'e', importance: 60, date: '2026-11-23' }),
    item({ id: 'f', importance: 10, date: '2026-11-25' })
  ];
  const b = buildBriefing(items, null, NOW);
  assert.deepEqual([b.date, b.method], ['2026-11-25', 'ai']);
  assert.deepEqual(b.items, [{ id: 'a', text: 'a' }, { id: 'd', text: 'AIの要約' }, { id: 'e', text: 'e' }]);
});

test('きょうのまとめ：人が書いた当日分があれば、上書きしない', () => {
  const today: Briefing = { date: '2026-11-25', generatedAt: '', method: 'curated', items: [{ id: 'x', text: '人が書いた' }] };
  assert.equal(buildBriefing([item({ id: 'a', date: '2026-11-25', importance: 90 })], today, NOW), today);
  const yesterday: Briefing = { ...today, date: '2026-11-24' };
  assert.equal(buildBriefing([item({ id: 'a', date: '2026-11-25', importance: 90 })], yesterday, NOW).method, 'rules');
});

test('AIの整形：結果を項目に反映する。定型と判定されたら一覧から外れる扱いにする', () => {
  const base = item({ id: 'mof:a', title: '令和8年度一般会計予備費使用について', type: 'budget', theme: 'whole', stage: stageOf('budget', 4), importance: 70 });
  const r = applyEnrichment(base, { title: '冬の電気・ガス料金の支援に予備費', summary: '要約', what: '何が', who: 'だれに', when: 'いつ', type: 'budget', theme: 'industry', importance: 82.4, noise: false });
  assert.deepEqual([r.title, r.originalTitle, r.theme, r.importance, r.enriched, r.stage?.label], ['冬の電気・ガス料金の支援に予備費', '令和8年度一般会計予備費使用について', 'industry', 82, 'ai', '執行']);
  assert.deepEqual(r.qa, { what: '何が', who: 'だれに', when: 'いつ' });
  const noisy = applyEnrichment(base, { title: '会議資料を掲載', summary: '', what: '', who: '', when: '', type: 'news', theme: 'other', importance: 60, noise: true });
  assert.deepEqual([noisy.noise, noisy.stage, noisy.importance <= 15], [true, undefined, true]);
});

test('AIの整形：重要度の高い順に上限まで処理し、失敗した項目はそのまま残す', async () => {
  const pages: string[] = [];
  const http = new PoliteClient({
    userAgent: 'yukue-collector/0.1 (test)', minIntervalMs: 0, timeoutMs: 1000, state: {}, respectRobots: false,
    fetchImpl: (async (input: RequestInfo | URL) => { pages.push(String(input)); return new Response('<html><body><nav>メニュー</nav><main><h1>発表</h1><p>本文です。</p></main></body></html>'); }) as typeof fetch
  });
  const seen: string[] = [];
  const enricher: Enricher = {
    async enrich(it, text) {
      seen.push(`${it.id}|${text}`);
      if (it.id === 'mof:boom') throw new Error('一時的な失敗');
      return { title: it.title + '（整形）', summary: 's', what: 'w', who: 'h', when: 'n', type: it.type, theme: it.theme, importance: it.importance, noise: false };
    }
  };
  const items = [
    item({ id: 'mof:hi', importance: 80 }),
    item({ id: 'mof:boom', importance: 75 }),
    item({ id: 'mof:pdf', importance: 70, links: [{ name: '財務省', url: 'https://www.mof.go.jp/a.pdf' }] }),
    item({ id: 'mof:low', importance: 40 }),
    item({ id: 'mof:noise', importance: 90, noise: true }),
    item({ id: 'mof:done', importance: 90, enriched: 'ai' })
  ];
  const logs: string[] = [];
  const r = await enrichItems(items, enricher, http, { limit: 5, minImportance: 50, log: m => logs.push(m) });
  assert.equal(r.done, 2);
  assert.deepEqual(r.items.map(i => i.enriched), ['ai', 'rules', 'ai', 'rules', 'rules', 'ai']);
  assert.deepEqual(seen.map(s => s.split('|')[0]), ['mof:hi', 'mof:boom', 'mof:pdf']);
  assert.equal(seen[0].split('|')[1], '発表\n本文です。', 'ナビゲーションを除いた本文を渡す');
  assert.equal(seen[2].split('|')[1], '', 'PDFは本文を取りに行かない');
  assert.equal(pages.length, 2);
  assert.match(logs[0], /mof:boom/);
});

test('AIの整形：本文を取りに行くのは、国の機関のサイトのページだけ', async () => {
  assert.equal(isReadablePage('https://www.mof.go.jp/policy/budget/index.html'), true);
  assert.equal(isReadablePage('https://www.jgrants-portal.go.jp/subsidy/a0W'), true);
  for (const url of ['http://www.mof.go.jp/a.html', 'https://www.mof.go.jp/a.pdf', 'https://www.mof.go.jp/a.PDF?x=1', 'https://example.com/go.jp/a.html', 'https://evilgo.jp/a.html', 'https://go.jp.example.com/', 'https://localhost/a', 'https://169.254.169.254/latest', 'https://user@www.mof.go.jp/', 'https://www.mof.go.jp:8443/', 'ftp://www.mof.go.jp/a', 'not a url']) {
    assert.equal(isReadablePage(url), false, url);
  }
  const pages: string[] = [];
  const http = new PoliteClient({
    userAgent: 'yukue-collector/0.1 (test)', minIntervalMs: 0, timeoutMs: 1000, state: {}, respectRobots: false,
    fetchImpl: (async (input: RequestInfo | URL) => { pages.push(String(input)); return new Response('<main>本文</main>'); }) as typeof fetch
  });
  const texts: string[] = [];
  const enricher: Enricher = { async enrich(_it, text) { texts.push(text); return null; } };
  await enrichItems([item({ id: 'x:a', importance: 80, links: [{ name: 'よそのサイト', url: 'https://example.com/a.html' }] }), item({ id: 'mof:b', importance: 70 })], enricher, http, { limit: 5, minImportance: 50, log: () => {} });
  assert.deepEqual(pages, ['https://www.mof.go.jp/mof:b.html']);
  assert.deepEqual(texts, ['', '本文'], 'よそのサイトは取りに行かず、題だけで整える');
});

test('本文の抜き出し', () => {
  assert.equal(mainText('<body><header>上</header><article><p>一つめ</p><script>x()</script><p>二つめ</p></article><footer>下</footer></body>'), '一つめ\n二つめ');
});

test('重ね合わせ：重要なものほど長く残し、定型の発表は1週間で一覧から外す', () => {
  const at = (id: string, daysAgo: number, over: Partial<UpdateItem>) => item({ id, date: addDays('2026-11-25', -daysAgo), ...over });
  const r = mergeUpdates([], [], [
    at('mof:noise-6', 6, { noise: true, importance: 15 }), at('mof:noise-8', 8, { noise: true, importance: 15 }),
    at('mof:low-20', 20, { importance: 30 }), at('mof:low-22', 22, { importance: 30 }),
    at('mof:mid-44', 44, { importance: 45 }), at('mof:mid-46', 46, { importance: 45 }),
    at('mof:high-59', 59, { importance: 60 }), at('mof:high-61', 61, { importance: 60 })
  ], NOW);
  assert.deepEqual(r.items.map(i => i.id).sort(), ['mof:high-59', 'mof:low-20', 'mof:mid-44', 'mof:noise-6']);
  assert.deepEqual(r.addedIds.sort(), ['mof:high-59', 'mof:low-20', 'mof:mid-44', 'mof:noise-6'], '外したものは「新しく加わった」に数えない');
});

test('重ね合わせ：件数の上限を超えるときは、定型の発表の古いものから外す', () => {
  const many: UpdateItem[] = [];
  for (let n = 0; n < 350; n++) {
    many.push(item({ id: `mof:n${n}`, date: addDays('2026-11-25', -(n % 3)), noise: true, importance: 15 }));
    many.push(item({ id: `mof:k${n}`, date: addDays('2026-11-25', -5), importance: 30 }));
  }
  const r = mergeUpdates([], [], many, NOW);
  assert.equal(r.items.length, 600);
  assert.equal(r.items.filter(i => !i.noise).length, 350, '定型でないものは、古くてもすべて残る');
  const droppedNoise = many.filter(i => i.noise && !r.items.some(k => k.id === i.id));
  assert.ok(droppedNoise.length === 100 && droppedNoise.every(i => i.date === addDays('2026-11-25', -2)), '外れるのは、定型のうち古いもの');
});

test('作り直し：保管用ファイルから、一覧から外れていた項目を、いまの決まりで入れ直す', () => {
  const dir = mkdtempSync(join(tmpdir(), 'yukue-rebuild-'));
  const kept = item({ id: 'mof:kept', title: '一覧にあるほうの題', importance: 60 });
  const bill = item({ id: 'gian:kaku-222-9', sourceId: 'shugiin', date: '2026-10-10', importance: 62, title: '一覧から外れていた法案' });
  const oldNoise = item({ id: 'mof:noise', date: '2026-11-01', noise: true, importance: 15 });
  writeArchive(dir, [{ ...kept, title: '保管されている古い題' }, bill, oldNoise], NOW);
  assert.equal(readArchive(dir).length, 3);
  const r = rebuildFromArchive([kept], [], readArchive(dir), NOW);
  assert.deepEqual(r.items.map(i => [i.id, i.title]), [['mof:kept', '一覧にあるほうの題'], ['gian:kaku-222-9', '一覧から外れていた法案']]);
  assert.deepEqual(readArchive(join(dir, 'missing')), []);
});
