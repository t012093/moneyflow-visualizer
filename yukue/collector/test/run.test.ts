import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { PoliteClient } from '../src/http.ts';
import { jgrantsSource } from '../src/sources/jgrants.ts';
import { kakugiSource } from '../src/sources/kakugi.ts';
import { rssSource } from '../src/sources/rss.ts';
import { shugiinSource } from '../src/sources/shugiin.ts';
import type { CollectorState, Ctx } from '../src/sources/types.ts';

/**
 * 情報源を、にせの通信相手に向けて最初から最後まで走らせる。
 * 2回目以降に「変わったところだけ取りに行く」ことを、ここで確かめる。
 */

const bytes = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
const NOW = new Date('2026-11-24T16:00:00Z'); // 日本時間 11月25日 1時

type Handler = (url: string, headers: Record<string, string>) => Response | undefined;

function site(handler: Handler) {
  const calls: string[] = [];
  const logs: string[] = [];
  const state: CollectorState = { http: {}, seen: {}, gian: {} };
  const http = new PoliteClient({
    userAgent: 'yukue-collector/0.1 (test)',
    minIntervalMs: 1500,
    timeoutMs: 5000,
    state: state.http,
    sleep: async () => {},
    fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/robots.txt')) return new Response('User-agent: *\nDisallow:\n');
      calls.push(url);
      return handler(url, (init?.headers ?? {}) as Record<string, string>) ?? new Response('not found', { status: 404 });
    }) as typeof fetch
  });
  const ctx: Ctx = { http, now: NOW, state, log: msg => logs.push(msg) };
  return { ctx, calls, logs, state };
}

test('RSS：2回目は条件付きで取りに行き、変わっていなければ読み込みを省く', async () => {
  const source = rssSource({ id: 'mof', name: '財務省 新着情報', url: 'https://www.mof.go.jp/news.rss', ministry: '財務省' });
  const seenHeaders: Record<string, string>[] = [];
  const { ctx } = site((_url, headers) => {
    seenHeaders.push(headers);
    if (headers['if-none-match'] === '"v1"') return new Response(null, { status: 304 });
    return new Response(bytes('mof.rss'), { headers: { 'content-type': 'application/rss+xml', etag: '"v1"' } });
  });
  const first = await source.run(ctx);
  assert.equal(first.fetched, 8);
  assert.ok(first.items.length > 0 && first.items.every(i => i.sourceId === 'mof' && i.ministry === '財務省'));
  assert.equal(first.unchanged, undefined);
  const second = await source.run(ctx);
  assert.deepEqual(second, { items: [], fetched: 0, unchanged: true });
  assert.equal(seenHeaders[1]['if-none-match'], '"v1"');
});

test('RSS：フィードとして読めない返事は、その情報源の失敗として投げる', async () => {
  const source = rssSource({ id: 'x', name: 'こわれたフィード', url: 'https://example.go.jp/news.rss', ministry: '◯◯省' });
  const { ctx } = site(() => new Response('<html><body>メンテナンス中</body></html>', { headers: { 'content-type': 'text/html' } }));
  await assert.rejects(source.run(ctx), /フィードとして読めません/);
});

test('閣議案件：まだ見ていない回だけを読み、一覧が変わらなければ何も取りに行かない', async () => {
  const INDEX = 'https://www.kantei.go.jp/jp/kakugi/index.html';
  let index = bytes('kakugi-index.html').toString('utf8');
  const { ctx, calls, state } = site(url => {
    if (url === INDEX) return new Response(index, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    if (/\/kakugi-\d{10}\.html$/.test(url)) return new Response(bytes('kakugi-meeting.html'), { headers: { 'content-type': 'text/html; charset=utf-8' } });
    return undefined;
  });
  const source = kakugiSource(2);
  const first = await source.run(ctx);
  // 新しい順に2回分だけ
  assert.deepEqual(calls.slice(1), ['https://www.kantei.go.jp/jp/kakugi/2026/kakugi-2026112401.html', 'https://www.kantei.go.jp/jp/kakugi/2026/kakugi-2026112001.html']);
  assert.ok(first.items.length > 0 && first.fetched > 0);
  assert.deepEqual(Object.keys(state.seen).sort(), ['kakugi:2026112001', 'kakugi:2026112401']);
  assert.ok(first.items.every(i => i.links[0].url.startsWith('https://www.kantei.go.jp/jp/kakugi/2026/kakugi-20261')));

  // 読み残しがあるうちは、一覧が変わっていなくても、古いほうへ順に続きを読む
  calls.length = 0;
  const second = await source.run(ctx);
  assert.deepEqual(calls.slice(1), ['https://www.kantei.go.jp/jp/kakugi/2026/kakugi-2026111701.html', 'https://www.kantei.go.jp/jp/kakugi/2026/kakugi-2026111301.html']);
  assert.equal(second.unchanged, undefined);
  await source.run(ctx);
  assert.equal(Object.keys(state.seen).length, 6);

  // すべて読み終えたら、一覧が変わるまでは一覧だけを確かめる
  calls.length = 0;
  assert.deepEqual(await source.run(ctx), { items: [], fetched: 0, unchanged: true });
  assert.deepEqual(calls, [INDEX]);

  // 新しい回が載ったら、その回だけを読む
  index = index.replace('kakugi-2026112401.html', 'kakugi-2026112701.html');
  calls.length = 0;
  const fresh = await source.run(ctx);
  assert.deepEqual(calls.slice(1), ['https://www.kantei.go.jp/jp/kakugi/2026/kakugi-2026112701.html']);
  assert.ok(fresh.items.every(i => i.date === '2026-11-27'));
});

test('議案：審議状況が変わった法案の経過だけを取りに行く', async () => {
  const LIST = 'https://www.shugiin.go.jp/internet/itdb_gian.nsf/html/gian/menu.htm';
  const sjis = { headers: { 'content-type': 'text/html; charset=Shift_JIS' } };
  let extra = '';
  const { ctx, calls, state, logs } = site(url => {
    if (url === LIST) return new Response(Buffer.concat([bytes('shugiin-list.html'), Buffer.from(extra)]), sjis);
    if (url.includes('/keika/')) return new Response(bytes('shugiin-keika-pending.html'), sjis);
    return undefined;
  });
  const source = shugiinSource();
  const first = await source.run(ctx);
  const keika = (list: string[]) => list.filter(u => u.includes('/keika/'));
  assert.equal(first.fetched, 8, '一覧の行数（同じ法案が2か所に載っている分も数える）');
  assert.equal(keika(calls).length, 6, '同じ法案は1回だけ取りに行く');
  assert.equal(first.items.length, 6);
  assert.equal(Object.keys(state.gian).length, 6);

  calls.length = 0;
  assert.deepEqual(await source.run(ctx), { items: [], fetched: 0, unchanged: true });
  assert.deepEqual(calls, [LIST]);

  // 一覧は変わったが、どの法案も審議状況が同じなら、経過は取りに行かない
  extra = '<!-- 1 -->';
  calls.length = 0;
  assert.equal((await source.run(ctx)).items.length, 0);
  assert.equal(keika(calls).length, 0);

  // 1本だけ審議状況が進んだ
  extra = '<!-- 2 -->';
  state.gian['gian:kaku-222-1'] = { status: '衆議院で審議中' };
  calls.length = 0;
  const moved = await source.run(ctx);
  assert.deepEqual(keika(calls), ['https://www.shugiin.go.jp/internet/itdb_gian.nsf/html/gian/keika/1DE342E.htm']);
  assert.deepEqual(moved.items.map(i => i.id), ['gian:kaku-222-1']);
  assert.equal(state.gian['gian:kaku-222-1'].status, '参議院で審議中');
  assert.deepEqual(logs, []);
});

test('議案：1回に読むページ数の上限を超えた分は、次の回に回す', async () => {
  const sjis = { headers: { 'content-type': 'text/html; charset=Shift_JIS' } };
  let extra = '';
  const { ctx, state, logs } = site(url => (url.includes('/keika/') ? new Response(bytes('shugiin-keika-pending.html'), sjis) : new Response(Buffer.concat([bytes('shugiin-list.html'), Buffer.from(extra)]), sjis)));
  const source = shugiinSource(4);
  assert.equal((await source.run(ctx)).items.length, 4);
  assert.match(logs[0], /上限（4ページ）/);
  // 一覧が変わっていなくても、読み残しは次の回に続ける
  assert.equal((await source.run(ctx)).items.length, 2);
  assert.equal(Object.keys(state.gian).length, 6);
  assert.deepEqual(await source.run(ctx), { items: [], fetched: 0, unchanged: true });
  extra = '<!-- 次の日 -->';
  assert.equal((await source.run(ctx)).items.length, 0);
});

test('議案：経過のページが1本取れなくても、ほかの法案は続ける', async () => {
  const sjis = { headers: { 'content-type': 'text/html; charset=Shift_JIS' } };
  let down = true;
  const { ctx, state, logs, calls } = site(url => {
    if (down && url.endsWith('/keika/1DE342E.htm')) return new Response('gone', { status: 404 });
    return url.includes('/keika/') ? new Response(bytes('shugiin-keika-pending.html'), sjis) : new Response(bytes('shugiin-list.html'), sjis);
  });
  const source = shugiinSource();
  const r = await source.run(ctx);
  assert.equal(r.items.length, 5);
  assert.equal(state.gian['gian:kaku-222-1'], undefined);
  assert.match(logs.join('\n'), /gian:kaku-222-1 の経過を取得できませんでした/);
  // 取れなかった法案は、一覧が変わっていなくても、次の回にもう一度試す
  down = false;
  calls.length = 0;
  const again = await source.run(ctx);
  assert.deepEqual(again.items.map(i => i.id), ['gian:kaku-222-1']);
  assert.equal(calls.filter(u => u.includes('/keika/')).length, 1);
});

test('議案・閣議案件・Jグランツ：中身が1件も読み取れないときは、空で上書きせずに失敗として知らせる', async () => {
  const empty = () => new Response('<html><body><p>ただいまメンテナンス中です</p></body></html>', { headers: { 'content-type': 'text/html; charset=utf-8' } });
  await assert.rejects(shugiinSource().run(site(empty).ctx), /法案を1件も読み取れませんでした/);
  await assert.rejects(kakugiSource().run(site(empty).ctx), /各回のページを見つけられませんでした/);
  await assert.rejects(jgrantsSource.run(site(() => new Response('{"result":[]}', { headers: { 'content-type': 'application/json' } })).ctx), /補助金が1件も返ってきませんでした/);
  // 直ったら、次の実行でふつうに読める（「変わっていない」として飛ばさない）
  let broken = true;
  const s = site(url => (broken ? empty() : url.includes('/keika/') ? new Response(bytes('shugiin-keika-pending.html'), { headers: { 'content-type': 'text/html; charset=Shift_JIS' } }) : new Response(bytes('shugiin-list.html'), { headers: { 'content-type': 'text/html; charset=Shift_JIS' } })));
  await assert.rejects(shugiinSource().run(s.ctx));
  await assert.rejects(shugiinSource().run(s.ctx), /法案を1件も読み取れませんでした/, '同じこわれたページでも、毎回失敗として数える');
  broken = false;
  assert.equal((await shugiinSource().run(s.ctx)).items.length, 6);
});

test('閣議案件：途中の回が取れなくても、そこまでに読めた回は生かし、取れなかった回は次にもう一度試す', async () => {
  const INDEX = 'https://www.kantei.go.jp/jp/kakugi/index.html';
  const html = { headers: { 'content-type': 'text/html; charset=utf-8' } };
  let down = true;
  const { ctx, state, logs, calls } = site(url => {
    if (url === INDEX) return new Response(bytes('kakugi-index.html'), html);
    if (down && url.endsWith('kakugi-2026112001.html')) return new Response('error', { status: 404 });
    return new Response(bytes('kakugi-meeting.html'), html);
  });
  const source = kakugiSource(3);
  const first = await source.run(ctx);
  assert.ok(first.items.length > 0);
  assert.deepEqual(Object.keys(state.seen), ['kakugi:2026112401']);
  assert.match(logs.join('\n'), /閣議 2026112001 を取得できませんでした/);
  down = false;
  calls.length = 0;
  const second = await source.run(ctx);
  assert.deepEqual(calls.slice(1).map(u => u.slice(-15, -5)), ['2026112001', '2026111701', '2026111301']);
  assert.ok(second.items.length > first.items.length);
  // 最初の回から取れないときは、情報源の失敗として投げ、次の実行でまた試す
  const dead = site(url => (url === INDEX ? new Response(bytes('kakugi-index.html'), html) : new Response('error', { status: 404 })));
  await assert.rejects(kakugiSource().run(dead.ctx), /HTTP 404/);
  await assert.rejects(kakugiSource().run(dead.ctx), /HTTP 404/);
});

test('Jグランツ：言葉を変えて何度か尋ねた結果をまとめ、動きに出すのは初めて見た全国向けだけ', async () => {
  const { ctx, calls, state } = site(url => (url.startsWith('https://api.jgrants-portal.go.jp/exp/v1/public/subsidies?') ? new Response(bytes('jgrants.json'), { headers: { 'content-type': 'application/json' } }) : undefined));
  const first = await jgrantsSource.run(ctx);
  assert.equal(calls.length, 4);
  assert.ok(calls.every(u => /[?&]acceptance=1(&|$)/.test(u)), '受付中のものだけを尋ねる');
  assert.equal(first.grants?.length, 5, '同じ補助金は1件にまとめる');
  assert.deepEqual(first.items.map(i => i.id).sort(), ['jgrants:a0WfQ000003lu8IUAQ', 'jgrants:a0WfQ0000049swXUAQ']);
  assert.equal(Object.keys(state.seen).filter(k => k.startsWith('jgrants:')).length, 5);
  // 2回目：補助金の一覧は出し直すが、動きには足さない
  const second = await jgrantsSource.run(ctx);
  assert.equal(second.grants?.length, 5);
  assert.deepEqual(second.items, []);
});
