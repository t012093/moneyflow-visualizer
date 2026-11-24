import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { classify } from '../src/classify.ts';
import { parseFeed } from '../src/feeds.ts';
import { decodeBody } from '../src/http.ts';
import { formatYen, grantFromApi, grantToItem } from '../src/sources/jgrants.ts';
import { itemUrl, kakugiToItems, parseKakugiIndex, parseKakugiMeeting } from '../src/sources/kakugi.ts';
import { pubcommentItems } from '../src/sources/pubcomment.ts';
import { entriesToItems } from '../src/sources/rss.ts';
import { billKey, billToItem, parseBillList, parseKeika, type BillRow } from '../src/sources/shugiin.ts';

const bytes = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
const utf8 = (name: string) => bytes(name).toString('utf8');
const sjis = (name: string) => decodeBody(bytes(name), 'text/html; charset=Shift_JIS');
const NOW = new Date('2026-11-24T16:00:00Z'); // 日本時間 11月25日 1時

test('分類：題と発表元から、種類・分野・段階・定型かどうかを決める', () => {
  const c = (title: string, ministry = '財務省') => classify({ title, ministry });
  assert.deepEqual([c('令和8年度一般会計中東情勢等対応予備費使用について').type, c('令和8年度一般会計中東情勢等対応予備費使用について').stage?.label], ['budget', '執行']);
  assert.deepEqual([c('令和9年度予算の編成等に関する建議').type, c('令和9年度予算の編成等に関する建議').stage?.label], ['budget', '審議会の提言']);
  assert.equal(c('租税特別措置法の一部を改正する法律案').type, 'tax');
  assert.deepEqual([c('こども基本法の一部を改正する法律案', 'こども家庭庁').type, c('こども基本法の一部を改正する法律案', 'こども家庭庁').theme], ['law', 'social']);
  assert.deepEqual([c('省エネ設備導入補助金の公募を開始します', '経済産業省').type, c('省エネ設備導入補助金の公募を開始します', '経済産業省').theme], ['grant', 'industry']);
  assert.equal(c('「基本方針」の改定案に対する意見募集', '総務省').stage?.label, '意見募集');
  assert.equal(c('片山財務大臣閣議後記者会見の概要').noise, true);
  assert.equal(c('国庫短期証券（第1420回）の入札結果').noise, true);
  assert.equal(c('第134回労働政策審議会労働条件分科会労災保険部会資料', '厚生労働省').noise, true);
  assert.equal(c('経済財政諮問会議を開催しました', '首相官邸').noise, false, '重要な会議は、定型の言い回しでも残す');
  assert.equal(c('地方公務員災害補償法の一部を改正する法律案', '総務省').theme, 'other', '公務員の「災害補償」は防災ではない');
  assert.ok(c('検察官の俸給等に関する法律の一部を改正する法律の公布').importance < c('こども基本法の一部を改正する法律の公布').importance);
});

test('RSS：フィードの項目を動きにする。古すぎるものや、リンクのないものは落とす', () => {
  const feed = parseFeed(utf8('mof.rss'));
  const items = entriesToItems(feed.entries, { id: 'mof', name: '財務省 新着情報', url: 'https://www.mof.go.jp/news.rss', ministry: '財務省', boost: 5 }, NOW);
  assert.equal(items.length, 8);
  assert.ok(items.every(i => i.id.startsWith('mof:') && i.sourceId === 'mof' && i.enriched === 'rules' && i.links[0].url.startsWith('https://')));
  assert.equal(items.find(i => /記者会見/.test(i.title))?.noise, true);
  assert.equal(items.find(i => /租税条約/.test(i.title))?.type, 'tax');
  const old = entriesToItems([{ title: '古い発表', link: 'https://www.mof.go.jp/old.html', date: new Date('2026-01-01T00:00:00Z'), summary: '', categories: [], author: '' }], { id: 'mof', name: '', url: '', ministry: '財務省' }, NOW);
  assert.equal(old.length, 0);
});

test('パブリック・コメント：公示日・締切・担当を説明文から取り出す', () => {
  const items = pubcommentItems(parseFeed(utf8('pubcomment.xml')).entries, NOW);
  assert.equal(items.length, 3);
  const first = items[0];
  assert.equal(first.id, 'pubcomment:145210800');
  assert.deepEqual([first.date, first.deadline, first.ministry, first.type, first.stage?.label], ['2026-11-21', '2026-12-21', '総務省', 'system', '意見募集']);
  assert.match(first.summary, /締切は12月21日/);
  assert.match(first.title, /意見募集 － 自律型海上無線機器/);
});

test('閣議案件の一覧：各回のページを新しい順に返す', () => {
  const list = parseKakugiIndex(utf8('kakugi-index.html'), 'https://www.kantei.go.jp/jp/kakugi/index.html');
  assert.equal(list[0].url, 'https://www.kantei.go.jp/jp/kakugi/2026/kakugi-2026112401.html');
  assert.deepEqual(list.map(m => m.key).slice(0, 3), ['2026112401', '2026112001', '2026111701']);
});

test('閣議案件：見出しごとに案件を読み、右寄せの担当府省と「同上」をつなぐ', () => {
  const items = parseKakugiMeeting(utf8('kakugi-meeting.html'));
  const sections = [...new Set(items.map(i => i.section))];
  assert.deepEqual(sections, ['一般案件', '国会提出案件', '公布（法律）', '政令', '人事']);
  const laws = items.filter(i => i.section === '公布（法律）');
  assert.equal(laws.length, 7);
  assert.equal(laws[0].title, '地方公共団体の議会の議員及び長の選挙期日等の臨時特例に関する法律（決定）');
  const orders = items.filter(i => i.section === '政令');
  assert.deepEqual(orders.map(o => o.ministry), ['総務省', '経済産業省', '経済産業・財務省']);
  assert.ok(items.filter(i => i.section === '一般案件').every(i => i.ministry), '一般案件には担当府省が付く');
});

test('閣議案件：動きに直す。公布は法律、政令は制度、人事は定型として扱う', () => {
  const url = 'https://www.kantei.go.jp/jp/kakugi/2026/kakugi-2026111301.html';
  const items = kakugiToItems(parseKakugiMeeting(utf8('kakugi-meeting.html')), '2026111301', url, NOW);
  assert.ok(items.every(i => i.date === '2026-11-13' && i.sourceId === 'kakugi'));
  const law = items.find(i => i.title === '地方公共団体の議会の議員及び長の選挙期日等の臨時特例に関する法律')!;
  assert.deepEqual([law.type, law.stage?.label, law.theme], ['law', '公布', 'local']);
  const order = items.find(i => /施行令$/.test(i.title))!;
  assert.deepEqual([order.type, order.stage?.label, order.ministry], ['system', '政令を決定', '総務省']);
  const budget = items.find(i => /予備費使用/.test(i.title))!;
  assert.deepEqual([budget.type, budget.stage?.label], ['budget', '執行']);
  assert.ok(items.filter(i => /海外出張/.test(i.title)).every(i => i.noise));
  assert.equal(new Set(items.map(i => i.links[0].url)).size, items.length, '案件ごとにリンクが別になる');
  assert.ok(items.every(i => i.links[0].url.startsWith(url + '#:~:text=')));
});

test('閣議案件：案件の場所を指すリンクは、ページの表記（全角の数字）のまま作る', () => {
  assert.equal(itemUrl('https://example.go.jp/k.html', '令和７年度決算-について（決定）'), 'https://example.go.jp/k.html#:~:text=' + encodeURIComponent('令和７年度決算').replace(/-/g, '%2D') + '%2D' + encodeURIComponent('について'));
});

test('閣議案件：同じ府省の似た案件が続くときは、1件にまとめる', () => {
  const many = Array.from({ length: 5 }, (_, i) => ({ section: '一般案件', title: `令和7年度の報告${i}を国会に提出することについて（決定）`, raw: `令和７年度の報告${i}`, ministry: '財務省' }));
  const items = kakugiToItems(many, '2026112001', 'https://example.go.jp/k.html', NOW);
  assert.equal(items.length, 1);
  assert.match(items[0].summary, /ほかに4件/);
});

test('衆議院の議案一覧（Shift_JIS）を読む', () => {
  const rows = parseBillList(sjis('shugiin-list.html'), 'https://www.shugiin.go.jp/internet/itdb_gian.nsf/html/gian/menu.htm');
  assert.ok(rows.length >= 6);
  assert.deepEqual([...new Set(rows.map(r => r.kind))].sort(), ['参法', '衆法', '閣法']);
  assert.ok(rows.every(r => /^https:\/\/www\.shugiin\.go\.jp\/internet\/itdb_gian\.nsf\/html\/gian\/keika\/\w+\.htm$/.test(r.keikaUrl)));
  assert.ok(rows.some(r => r.status === '成立'));
  assert.ok(rows.every(r => /^\d+$/.test(r.kaiji) && /^\d+$/.test(r.no) && r.title.length > 3));
});

const row = (over: Partial<BillRow>): BillRow => ({ kind: '閣法', kaiji: '222', no: '1', title: '', status: '', keikaUrl: 'https://www.shugiin.go.jp/k.htm', honbunUrl: 'https://www.shugiin.go.jp/h.htm', ...over });

test('議案：参議院で審議中の法案。直近の出来事の日付と、経過の文を作る', () => {
  const keika = parseKeika(sjis('shugiin-keika-pending.html'));
  assert.equal(keika['議案種類'], '閣法');
  const item = billToItem(row({ title: keika['議案件名'], status: '参議院で審議中' }), keika, NOW);
  assert.equal(item.id, 'gian:kaku-222-1');
  assert.deepEqual([item.type, item.stage?.label, item.stage?.steps[item.stage.index], item.date], ['tax', '参議院で審議中', '国会審議', '2026-11-11']);
  assert.equal(item.summary, '内閣提出の法案。10月9日に提出、11月6日に衆議院で可決。いまは参議院で審議中。');
  assert.equal(item.links.length, 2);
});

test('議案：公布された法律。題は「法律案」ではなく「法律」にし、法律番号を添える', () => {
  const keika = parseKeika(sjis('shugiin-keika-promulgated.html'));
  const item = billToItem(row({ no: '9', title: keika['議案件名'], status: '成立' }), keika, NOW);
  assert.deepEqual([item.type, item.stage?.label, item.date, item.theme], ['law', '公布', '2026-11-20', 'social']);
  assert.match(item.title, /特別措置法の一部を改正する法律$/);
  assert.match(item.originalTitle ?? '', /法律案$/);
  assert.match(item.summary, /11月13日に参議院で可決、11月20日に公布（法律第88号）。$/);
});

test('議案：前の国会から持ち越した議員立法。付託の日付を使い、重要度は下げる', () => {
  const keika = parseKeika(sjis('shugiin-keika-carried.html'));
  const r = row({ kind: '衆法', kaiji: '221', title: keika['議案件名'], status: '衆議院で審議中' });
  const item = billToItem(r, keika, NOW);
  assert.equal(billKey(r), 'gian:shu-221-1');
  assert.deepEqual([item.date, item.ministry, item.stage?.label], ['2026-10-05', '衆議院議員提出の法案', '衆議院で審議中']);
  assert.match(item.summary, /10月5日に政治改革に関する特別委員会に付託/);
  const fresh = billToItem(row({ title: '新しい法律案', status: '衆議院で審議中' }), { 衆議院議案受理年月日: '令和 8年11月20日' }, NOW);
  assert.ok(item.importance < fresh.importance);
});

test('Jグランツ：APIの行を補助金にし、全国向けは動きにもする', () => {
  const body = JSON.parse(utf8('jgrants.json')) as { result: Record<string, unknown>[] };
  const grants = body.result.map(grantFromApi).filter(g => g !== null);
  assert.equal(grants.length, body.result.length);
  const national = grants.find(g => g.area === '全国' && g.maxAmount)!;
  assert.match(national.url, /^https:\/\/www\.jgrants-portal\.go\.jp\/subsidy\/[A-Za-z0-9]+$/);
  assert.match(national.end ?? '', /^\d{4}-\d{2}-\d{2}$/);
  const item = grantToItem(national, NOW);
  assert.deepEqual([item.type, item.stage?.label, item.deadline, item.date], ['grant', '公募中', national.end, '2026-11-25']);
  assert.match(item.amount ?? '', /^上限 /);
  assert.notEqual(item.theme, 'whole', '題に「補正予算」とあっても、分野は中身で決める');
  assert.equal(grantFromApi({ id: '../x', title: 'だめなID' }), null);
});

test('金額の表示', () => {
  assert.equal(formatYen(2_700_000_000), '27億円');
  assert.equal(formatYen(250_000_000), '2億5,000万円');
  assert.equal(formatYen(2_000_000), '200万円');
});
