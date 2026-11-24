import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { PoliteClient } from '../src/http.ts';
import { extractList, listSource, readDate } from '../src/sources/list.ts';
import type { CollectorState, Ctx } from '../src/sources/types.ts';

/** 新着ページの巡回。fixtures の list-*.html は、2026年11月時点の実際のページから切り出したもの。 */

const html = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const NOW = new Date('2026-11-24T16:00:00Z'); // 日本時間 11月25日 1時
const page = (body: string) => `<html><body>${body}</body></html>`;

test('日付を読む：和暦・西暦・年のない日付', () => {
  assert.equal(readDate('令和8年11月20日', '2026-11-25'), '2026-11-20');
  assert.equal(readDate('2026.11.5', '2026-11-25'), '2026-11-05');
  assert.equal(readDate('2026-11-24T10:00:00+09:00', '2026-11-25'), '2026-11-24');
  assert.equal(readDate('11月24日（火）', '2026-11-25'), '2026-11-24');
  // 年のない日付は、きょうから見ていちばん近い過去として読む（年をまたいでも前の年になる）
  assert.equal(readDate('12月28日', '2027-01-05'), '2026-12-28');
  assert.equal(readDate('1月4日', '2027-01-05'), '2027-01-04');
  assert.equal(readDate('13月40日', '2026-11-25'), null);
  assert.equal(readDate('2026年2月30日', '2026-11-25'), null);
  assert.equal(readDate('日付なし', '2026-11-25'), null);
});

test('環境省：日付の見出しの下に並ぶ発表を読み、一覧のあとにある別のリンクには日付を付けない', () => {
  const list = extractList(html('list-env.html'), 'https://www.env.go.jp/press/index.html', NOW);
  assert.equal(list.length, 5);
  assert.deepEqual(list.map(e => e.date), ['2026-11-24', '2026-11-24', '2026-11-24', '2026-11-20', '2026-11-20']);
  assert.deepEqual(list[1], { title: '第9回日本・ベトナム環境政策対話の結果について', link: 'https://www.env.go.jp/press/press_05867.html', date: '2026-11-24' });
  assert.ok(!list.some(e => /環境局/.test(e.title)), '「付属機関の発表」のリンクは項目ではない');
});

test('こども家庭庁：カードの形。題は見出しから、日付は <time datetime> から読む', () => {
  const list = extractList(html('list-cfa.html'), 'https://www.cfa.go.jp/news', NOW);
  assert.equal(list.length, 3);
  assert.deepEqual(list[0], { title: '中司大臣記者会見（令和8年11月24日）を掲載しました', link: 'https://www.cfa.go.jp/speech/8b395dc4', date: '2026-11-24' });
  assert.ok(list.every(e => !/^(会見|報道発表)/.test(e.title)), '分類のラベルは題に入れない');
  assert.equal(list[1].title, 'こども家庭審議会 幼児期までのこどもの育ち部会（第17回）の開催について掲載しました', '題の中の空白はそのまま残す');
});

test('国税庁：表の形。題の中に出てくる日付ではなく、日付の列を使う', () => {
  const list = extractList(html('list-nta.html'), 'https://www.nta.go.jp/', NOW, { scope: 'table.index_news' });
  assert.equal(list.length, 4);
  const tobacco = list.find(e => e.link.includes('tabako_r09'))!;
  assert.deepEqual([tobacco.date, tobacco.title], ['2026-11-02', '令和9年4月1日実施のたばこ税の手持品課税について']);
  const pdf = list.find(e => e.link.endsWith('.pdf'))!;
  assert.deepEqual([pdf.date, pdf.title], ['2026-11-20', '法人税及び地方法人税の予定申告書、消費税及び地方消費税の中間申告書並びに納付書発送等に関するお知らせ']);
  assert.ok(list.some(e => e.link === 'https://www.nta.go.jp/taxes/sake/boshujoho/hojojigyo.htm#saitaku'), 'ページの中の位置（#以下）は残す');
  assert.equal(list.find(e => e.link.includes('hojojigyo'))!.title, '酒類事業者向け補助金の第5期採択事業者の決定', '全角の数字は半角にそろえる');
});

test('会計検査院：1つの日付の下に並ぶ複数のリンクを読む。日付の欄のない文や、一覧の外のリンクは拾わない', () => {
  const list = extractList(html('list-jbaudit.html'), 'https://www.jbaudit.go.jp/', NOW);
  assert.equal(list.length, 7);
  assert.ok(list.every(e => e.date === '2026-11-20'));
  assert.equal(list[5].title, '「令和7年度決算検査報告」の本文を掲載しました。');
  assert.ok(!list.some(e => /内閣に送付しました|ご意見/.test(e.title)));
});

test('法務省：リンクの中の日付の欄（年なし）を使い、題からは外す。分類へのリンクは拾わない', () => {
  const list = extractList(html('list-moj.html'), 'https://www.moj.go.jp/', NOW, { scope: 'ul.info_list' });
  assert.deepEqual(list, [
    { title: '法務大臣閣議後記者会見の概要－令和8年11月20日（金）', link: 'https://www.moj.go.jp/hisho/kouhou/hisho08_01194.html', date: '2026-11-24' },
    { title: '事務補佐員の募集（厚生管理官・令和9年2月採用）', link: 'https://www.moj.go.jp/kouseikanrikan/shomu/kouseikanrikan01_00075.html', date: '2026-11-24' },
    { title: '法務大臣閣議後記者会見の概要－令和8年11月17日（火）', link: 'https://www.moj.go.jp/hisho/kouhou/hisho08_01193.html', date: '2026-11-20' }
  ]);
});

test('定義リストの形：それぞれのリンクに、直前の日付を付ける', () => {
  const list = extractList(page(`<dl>
    <dt>2026.11.20</dt><dd><a href="/a.html">補助金の公募を開始しました</a></dd>
    <dt>2026.11.19</dt><dd><a href="/b.html">基本方針（令和8年11月1日決定）を掲載しました</a> <a href="/b.pdf">基本方針の概要 [PDF：240KB]</a></dd>
  </dl>`), 'https://example.go.jp/news/', NOW);
  assert.deepEqual(list.map(e => [e.date, e.title, e.link]), [
    ['2026-11-20', '補助金の公募を開始しました', 'https://example.go.jp/a.html'],
    ['2026-11-19', '基本方針（令和8年11月1日決定）を掲載しました', 'https://example.go.jp/b.html'],
    ['2026-11-19', '基本方針の概要', 'https://example.go.jp/b.pdf']
  ]);
});

test('題の頭に日付が書かれた形：日付の欄として読み、題からは外す', () => {
  const list = extractList(page(`<ul>
    <li><a href="/a.html">2026.11.20 制度の見直しについて</a></li>
    <li><a href="/b.html">令和8年11月19日（木）：検討会の報告書を公表しました</a></li>
    <li><a href="/c.html">11月5日、決算検査報告を内閣に送付しました</a></li>
  </ul>`), 'https://example.go.jp/', NOW);
  assert.deepEqual(list.map(e => [e.date, e.title]), [['2026-11-20', '制度の見直しについて'], ['2026-11-19', '検討会の報告書を公表しました']]);
});

test('日付がリンクのあとにある形は、指定したときだけ読む', () => {
  const body = page('<ul><li><a href="/a.html">制度の見直しについて</a>（2026年11月20日）</li><li><a href="/b.html">検討会の報告書について</a>（2026年11月18日）</li></ul>');
  assert.deepEqual(extractList(body, 'https://example.go.jp/', NOW), []);
  assert.deepEqual(extractList(body, 'https://example.go.jp/', NOW, { dateAfter: true }).map(e => e.date), ['2026-11-20', '2026-11-18']);
});

test('読む範囲・対象のリンク・題の場所を指定できる', () => {
  const body = page(`
    <div class="side"><p>2026年11月1日</p><p><a href="/old.html">サイドの特集ページはこちら</a></p></div>
    <div class="news">
      <div class="item"><p class="meta">2026年11月20日 <a class="tag" href="/tag/hojo">補助金・助成金の一覧</a></p><p><a class="ttl" href="/a.html"><em>お知らせ</em><b>補助金の公募を開始しました</b></a></p></div>
      <div class="item"><p class="meta">2026年11月19日 <a class="tag" href="/tag/seido">制度・計画の一覧へ</a></p><p><a class="ttl" href="/b.html"><em>お知らせ</em><b>制度の見直しについて</b></a></p></div>
    </div>`);
  const all = extractList(body, 'https://example.go.jp/', NOW);
  assert.ok(all.some(e => e.link.endsWith('/old.html')), '範囲を指定しないと、サイドのリンクも拾う');
  const list = extractList(body, 'https://example.go.jp/', NOW, { scope: '.news', link: 'a.ttl', title: 'b' });
  assert.deepEqual(list.map(e => [e.date, e.title, e.link]), [
    ['2026-11-20', '補助金の公募を開始しました', 'https://example.go.jp/a.html'],
    ['2026-11-19', '制度の見直しについて', 'https://example.go.jp/b.html']
  ]);
});

test('ソースの改行はつめ、自分自身やメール・スクリプトへのリンク、短すぎる題は拾わない', () => {
  const list = extractList(page(`<table>
    <tr><th>2026年11月20日</th><td><a href="/a.html">疫学調査の在り方に
        関する検討会（第4回）の開催について</a></td></tr>
    <tr><th>2026年11月19日</th><td><a href="#top">このページの先頭へ戻る</a> <a href="mailto:info@example.go.jp">メールでのお問い合わせ</a> <a href="javascript:void(0)">印刷用のページを開く</a> <a href="/s.html">詳細</a></td></tr>
    <tr><th>2026年11月18日</th><td><a href="/a.html">同じページへの2つ目のリンク</a></td></tr>
  </table>`), 'https://example.go.jp/news/index.html', NOW);
  assert.deepEqual(list, [{ title: '疫学調査の在り方に関する検討会（第4回）の開催について', link: 'https://example.go.jp/a.html', date: '2026-11-20' }]);
});

function site(handler: (url: string) => Response | undefined) {
  const calls: string[] = [];
  const logs: string[] = [];
  const state: CollectorState = { http: {}, seen: {}, gian: {} };
  const http = new PoliteClient({
    userAgent: 'yukue-collector/0.1 (test)', minIntervalMs: 1500, timeoutMs: 5000, state: state.http, sleep: async () => {},
    fetchImpl: (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/robots.txt')) return new Response('', { status: 404 });
      calls.push(url);
      return handler(url) ?? new Response('not found', { status: 404 });
    }) as typeof fetch
  });
  const ctx: Ctx = { http, now: NOW, state, log: msg => logs.push(msg) };
  return { ctx, calls, logs };
}

const asHtml = (body: string) => new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8' } });

test('巡回：読んだ項目を動きにし、2回目は変わっていなければ省く。続きのページもあわせて読む', async () => {
  const source = listSource({ id: 'cfa', name: 'こども家庭庁 新着・更新', url: 'https://www.cfa.go.jp/news', ministry: 'こども家庭庁', more: ['https://www.cfa.go.jp/news?page=1'] });
  const second = page('<section class="card"><a href="/press/older"><h3>こども大綱の見直しに関する意見募集を開始しました</h3><time datetime="2026-11-18">2026年11月18日</time></a></section>'
    + '<section class="card"><a href="/speech/8b395dc4"><h3>1ページ目にもある項目</h3><time datetime="2026-11-24">2026年11月24日</time></a></section>');
  const { ctx, calls } = site(url => (url.endsWith('?page=1') ? asHtml(second) : asHtml(html('list-cfa.html'))));
  const first = await source.run(ctx);
  assert.deepEqual(calls, ['https://www.cfa.go.jp/news', 'https://www.cfa.go.jp/news?page=1']);
  assert.equal(first.fetched, 4, '2ページにまたがって載っている項目は1回だけ数える');
  assert.ok(first.items.every(i => i.sourceId === 'cfa' && i.ministry === 'こども家庭庁' && i.theme === 'social'));
  const consult = first.items.find(i => i.links[0].url === 'https://www.cfa.go.jp/press/older')!;
  assert.deepEqual([consult.date, consult.type, consult.stage?.label], ['2026-11-18', 'system', '意見募集']);
  assert.equal(first.items.find(i => /記者会見/.test(i.title))?.noise, true);
  calls.length = 0;
  assert.deepEqual(await source.run(ctx), { items: [], fetched: 0, unchanged: true });
  assert.deepEqual(calls, ['https://www.cfa.go.jp/news'], '1ページ目が変わっていなければ、続きは読まない');
});

test('巡回：続きのページが取れなくても1ページ目は生かす。1件も読めないページは、失敗として知らせつづける', async () => {
  const withMore = listSource({ id: 'cfa', name: 'こども家庭庁 新着・更新', url: 'https://www.cfa.go.jp/news', ministry: 'こども家庭庁', more: ['https://www.cfa.go.jp/news?page=1'] });
  const a = site(url => (url.endsWith('?page=1') ? undefined : asHtml(html('list-cfa.html'))));
  assert.equal((await withMore.run(a.ctx)).fetched, 3);
  assert.match(a.logs.join('\n'), /続きのページを取得できませんでした/);

  const source = listSource({ id: 'x', name: '作りが変わったページ', url: 'https://example.go.jp/news/', ministry: '◯◯省' });
  const b = site(() => asHtml(page('<p>ただいまメンテナンス中です</p>')));
  await assert.rejects(source.run(b.ctx), /新着の並びを読み取れませんでした/);
  await assert.rejects(source.run(b.ctx), /新着の並びを読み取れませんでした/);
});
