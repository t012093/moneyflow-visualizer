import { jgrantsSource } from './jgrants.ts';
import { kakugiSource } from './kakugi.ts';
import { listSource, type ListDef } from './list.ts';
import { pubcommentSource } from './pubcomment.ts';
import { rssSource, type RssDef } from './rss.ts';
import { shugiinSource } from './shugiin.ts';
import type { Source } from './types.ts';

/**
 * 各府省の新着情報のフィード。
 * 増やすときは `npm run discover -- https://www.example.go.jp/` で候補を探し、
 * 実際に読めることを確かめてから、ここに足す。
 */
export const RSS_FEEDS: RssDef[] = [
  { id: 'kantei', name: '首相官邸 新着情報', url: 'https://www.kantei.go.jp/index-jnews.rdf', ministry: '首相官邸', boost: 4 },
  { id: 'mof', name: '財務省 新着情報', url: 'https://www.mof.go.jp/news.rss', ministry: '財務省', boost: 5 },
  { id: 'mhlw', name: '厚生労働省 新着情報', url: 'https://www.mhlw.go.jp/stf/news.rdf', ministry: '厚生労働省' },
  { id: 'soumu', name: '総務省 新着情報', url: 'https://www.soumu.go.jp/news.rdf', ministry: '総務省' },
  { id: 'cao', name: '内閣府 報道発表', url: 'https://www.cao.go.jp/rss/news.rdf', ministry: '内閣府' },
  { id: 'mext', name: '文部科学省 新着情報', url: 'https://www.mext.go.jp/b_menu/news/index.rdf', ministry: '文部科学省' },
  { id: 'mlit', name: '国土交通省 新着情報', url: 'https://www.mlit.go.jp/index.rdf', ministry: '国土交通省' },
  { id: 'maff', name: '農林水産省 新着情報', url: 'https://www.maff.go.jp/rss.xml', ministry: '農林水産省' },
  { id: 'fsa', name: '金融庁 新着情報', url: 'https://www.fsa.go.jp/fsaNewsListAll_rss2.xml', ministry: '金融庁' },
  { id: 'caa', name: '消費者庁 新着情報', url: 'https://www.caa.go.jp/news.rss', ministry: '消費者庁' },
  { id: 'digital', name: 'デジタル庁 新着・更新', url: 'https://www.digital.go.jp/rss/news.xml', ministry: 'デジタル庁' },
  { id: 'mod', name: '防衛省 お知らせ', url: 'https://www.mod.go.jp/j/rss/news.xml', ministry: '防衛省' }
];

/**
 * フィードのない府省の、新着ページ。ページに並ぶ「日付とリンク」を読む（sources/list.ts）。
 * 増やすときは `npm run discover -- <新着ページのURL>` で、何件読み取れるかを先に確かめる。
 * メニューなどを拾うページでは、scope（読む範囲）や link（対象のリンク）をCSSセレクターで指定する。
 */
export const LIST_PAGES: ListDef[] = [
  { id: 'env', name: '環境省 報道発表', url: 'https://www.env.go.jp/press/index.html', ministry: '環境省', scope: '.p-press-release-list' },
  { id: 'cfa', name: 'こども家庭庁 新着・更新', url: 'https://www.cfa.go.jp/news', ministry: 'こども家庭庁', scope: 'main', more: ['https://www.cfa.go.jp/news?page=1'] },
  // 国税庁の新着は手続きの案内が中心。題に税の名前が入るので、そのままだと重要度が高く出すぎる
  { id: 'nta', name: '国税庁 新着情報', url: 'https://www.nta.go.jp/', ministry: '国税庁', scope: 'table.index_news', boost: -12 },
  { id: 'moj', name: '法務省 新着情報', url: 'https://www.moj.go.jp/', ministry: '法務省', scope: 'ul.info_list' },
  { id: 'jbaudit', name: '会計検査院 新着情報', url: 'https://www.jbaudit.go.jp/', ministry: '会計検査院', scope: '.shinchaku', boost: 4 }
];

/* まだ入れていないもの（2026年11月時点）：
   経済産業省・外務省・公正取引委員会は、この収集の名乗りでは 403 が返る（自動の取得を受け付けていない）。 */

export function allSources(): Source[] {
  return [...RSS_FEEDS.map(rssSource), ...LIST_PAGES.map(listSource), pubcommentSource, kakugiSource(), shugiinSource(), jgrantsSource];
}

/** 規則による分類をやり直すときに使う、情報源ごとの発表元と加点。 */
export function classifyDefs(): Map<string, { ministry: string; boost?: number }> {
  return new Map([...RSS_FEEDS, ...LIST_PAGES].map(d => [d.id, { ministry: d.ministry, boost: d.boost }] as const));
}
