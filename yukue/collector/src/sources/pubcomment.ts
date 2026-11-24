import type { UpdateItem } from '../../../shared/types.ts';
import { importanceOf, stageOf, themeOf } from '../classify.ts';
import { parseFeed, type FeedEntry } from '../feeds.ts';
import { jstDate, parseJaDate, shortJaDate } from '../text.ts';
import type { Source } from './types.ts';

const URL = 'https://public-comment.e-gov.go.jp/rss/pcm_list.xml';

const MINISTRY = /内閣官房|内閣府|公正取引委員会|個人情報保護委員会|原子力規制委員会|国家公安委員会|カジノ管理委員会|会計検査院|人事院|[぀-ヿ一-鿿]{1,8}?(?:省|庁)/;

const field = (text: string, label: string): string => {
  const m = new RegExp(`${label}[：:]\\s*([^\\n]*)`).exec(text);
  return m ? m[1].trim() : '';
};

/** e-Gov のパブリック・コメントの項目を、意見募集中の「制度」の動きにする。 */
export function pubcommentItems(entries: FeedEntry[], now: Date): UpdateItem[] {
  const today = jstDate(now);
  const out: UpdateItem[] = [];
  for (const e of entries) {
    const caseId = /[?&]id=(\d+)/.exec(e.link)?.[1];
    if (!e.title || !caseId) continue;
    const posted = parseJaDate(field(e.summary, '案の公示日')) ?? (e.date ? jstDate(e.date) : today);
    const deadline = parseJaDate(field(e.summary, '受付締切日時')) ?? undefined;
    const category = field(e.summary, 'カテゴリー');
    const contact = e.summary.slice(e.summary.indexOf('問合せ先')).replace(/^[^：:]*[：:]/, '');
    const ministry = MINISTRY.exec(contact.replace(/【[^】]*】/g, ''))?.[0] ?? 'e-Gov パブリック・コメント';
    const stage = stageOf('system', 1);
    out.push({
      id: `pubcomment:${caseId}`,
      date: posted,
      type: 'system',
      theme: themeOf(`${e.title} ${category}`, ministry),
      title: e.title,
      summary: `意見を募集しています。${deadline ? `締切は${shortJaDate(deadline)}。` : ''}${category ? `分野：${category}。` : ''}`,
      ministry,
      stage,
      ...(deadline ? { deadline } : {}),
      links: [{ name: 'e-Gov パブリック・コメント', url: e.link }],
      sourceId: 'pubcomment',
      firstSeen: now.toISOString(),
      importance: importanceOf('system', stage, e.title, undefined, false),
      enriched: 'rules'
    });
  }
  return out;
}

export const pubcommentSource: Source = {
  id: 'pubcomment',
  name: 'e-Gov パブリック・コメント',
  kind: 'rss',
  url: URL,
  async run(ctx) {
    const page = await ctx.http.get(URL, { accept: 'application/xml, text/xml, */*' });
    if (page.notModified || !page.changed) return { items: [], fetched: 0, unchanged: true };
    const feed = parseFeed(page.text);
    return { items: pubcommentItems(feed.entries, ctx.now), fetched: feed.entries.length };
  }
};
