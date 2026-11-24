import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { findFeedLinks, parseFeed } from '../src/feeds.ts';
import { decodeBody } from '../src/http.ts';
import { canonicalUrl, cleanTitle, extractAmount, jstDate, parseDate, parseJaDate, stripTags, toHalfWidth } from '../src/text.ts';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));

test('和暦と西暦の日付を読む', () => {
  assert.equal(parseJaDate('令和 8年11月 6日'), '2026-11-06');
  assert.equal(parseJaDate('令和８年１１月２０日（金）'), '2026-11-20');
  assert.equal(parseJaDate('令和元年5月1日'), '2019-05-01');
  assert.equal(parseJaDate('2026/12/21 23:59'), '2026-12-21');
  assert.equal(parseJaDate('／'), null);
});

test('秒が抜けた日時や、曜日のない日時も読める', () => {
  assert.equal(parseDate('2026-11-20T15:00:Z')?.toISOString(), '2026-11-20T15:00:00.000Z');
  assert.equal(jstDate(parseDate('2026-11-20T15:00:Z')!), '2026-11-21');
  assert.equal(jstDate(parseDate('25 Nov 2026 02:30:00 +0900')!), '2026-11-25');
  assert.equal(parseDate('Tue, 24 Nov 2026 17:00:00 JST')?.toISOString(), '2026-11-24T08:00:00.000Z');
  assert.equal(parseDate('きのう'), null);
});

test('金額を取り出す', () => {
  assert.equal(extractAmount('予備費から6,519億円を使う'), '6,519億円');
  assert.equal(extractAmount('１兆１，４８１億円'.replace('，', ',')), '1兆1,481億円');
  assert.equal(extractAmount('上限は200万円、補助率は3分の2'), '200万円');
  assert.equal(extractAmount('約2万4,000件を掲載'), undefined);
});

test('全角の英数字だけを半角にし、かっこは残す', () => {
  assert.equal(toHalfWidth('令和８年第１７回（ＩＣＣ）'), '令和8年第17回（ICC）');
  assert.equal(cleanTitle('  法律案\n  － 概要 －  '), '法律案 － 概要 －');
});

test('二重にエスケープされた説明文をテキストにする', () => {
  assert.equal(stripTags('案の公示日：2026/11/21&lt;br/&gt;受付締切日時：2026/12/21 23:59'), '案の公示日：2026/11/21\n受付締切日時：2026/12/21 23:59');
});

test('重複判定用のURLにそろえる', () => {
  assert.equal(canonicalUrl('http://www.mof.go.jp/a.html?utm_source=x&id=1#top'), 'https://www.mof.go.jp/a.html?id=1');
  assert.equal(canonicalUrl('/rss/news.xml', 'https://www.digital.go.jp/'), 'https://www.digital.go.jp/rss/news.xml');
});

test('RSS 2.0（財務省）を読む', () => {
  const feed = parseFeed(fixture('mof.rss').toString('utf8'));
  assert.equal(feed.title, '財務省：新着RSS');
  assert.equal(feed.entries.length, 8);
  const first = feed.entries[0];
  assert.equal(first.title, '国債市場特別参加者会合（第122回）開催日程');
  assert.equal(first.link, 'https://www.mof.go.jp/about_mof/councils/meeting_of_jgbsp/press_release/261124.html');
  assert.equal(jstDate(first.date!), '2026-11-24');
});

test('RSS 1.0（厚生労働省、CDATAの題）を読む', () => {
  const feed = parseFeed(fixture('mhlw.rdf').toString('utf8'));
  assert.equal(feed.entries.length, 6);
  assert.equal(feed.entries[0].title, '第134回労働政策審議会労働条件分科会労災保険部会資料');
  assert.equal(feed.entries[0].author, '厚生労働省');
  assert.equal(jstDate(feed.entries[0].date!), '2026-11-24');
});

test('Shift_JIS のフィード（総務省）を、XML宣言から文字コードを判断して読む', () => {
  const xml = decodeBody(fixture('soumu.rdf'), 'text/xml');
  const feed = parseFeed(xml);
  assert.equal(feed.entries.length, 5);
  assert.equal(feed.entries[0].title, '令和8年熊本地震による被災地方公共団体における職員採用情報');
});

test('Atom を読み、rel=alternate のリンクを使う', () => {
  const feed = parseFeed(`<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>お知らせ</title>
    <entry><title>制度を見直しました</title><link rel="self" href="https://example.go.jp/a.atom"/><link rel="alternate" href="https://example.go.jp/a.html"/>
    <updated>2026-11-24T10:00:00+09:00</updated><summary type="html">&lt;p&gt;概要です&lt;/p&gt;</summary><category term="制度"/></entry></feed>`);
  assert.deepEqual(feed.entries.map(e => [e.title, e.link, e.summary, e.categories[0]]), [['制度を見直しました', 'https://example.go.jp/a.html', '概要です', '制度']]);
});

test('フィードでないものは、分かる言葉で失敗する', () => {
  assert.throws(() => parseFeed('<html><body>403</body></html>'), /フィードとして読めません/);
});

test('ページからフィードのURLを見つける', () => {
  const html = '<head><link rel="stylesheet" href="/a.css"><link rel="alternate" type="application/rss+xml" title="新着" href="/rss/news.xml"></head>';
  assert.deepEqual(findFeedLinks(html, 'https://www.digital.go.jp/'), ['https://www.digital.go.jp/rss/news.xml']);
});
