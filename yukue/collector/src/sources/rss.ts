import type { UpdateItem } from '../../../shared/types.ts';
import { classify } from '../classify.ts';
import { FEED_ENTRY_LIMIT, KEEP_DAYS } from '../config.ts';
import { parseFeed, type FeedEntry } from '../feeds.ts';
import { addDays, jstDate, shortId, truncate } from '../text.ts';
import type { Source } from './types.ts';

export interface RssDef {
  id: string;
  name: string;
  url: string;
  ministry: string;
  /** 重要度への加点 */
  boost?: number;
}

/** フィードの項目を、画面に出す形にそろえる。 */
export function entriesToItems(entries: FeedEntry[], def: RssDef, now: Date): UpdateItem[] {
  const today = jstDate(now);
  const oldest = addDays(today, -KEEP_DAYS);
  const out: UpdateItem[] = [];
  for (const e of entries.slice(0, FEED_ENTRY_LIMIT)) {
    if (!e.title || !/^https:\/\//.test(e.link)) continue;
    const date = e.date ? jstDate(e.date) : today;
    if (date < oldest || date > addDays(today, 1)) continue;
    const summary = e.summary && e.summary !== e.title ? truncate(e.summary.replace(/\n/g, ' '), 200) : '';
    const c = classify({ title: e.title, summary, ministry: def.ministry, boost: def.boost });
    out.push({
      id: `${def.id}:${shortId(e.link)}`,
      date,
      type: c.type,
      theme: c.theme,
      title: e.title,
      summary,
      ministry: def.ministry,
      ...(c.amount ? { amount: c.amount } : {}),
      ...(c.stage ? { stage: c.stage } : {}),
      links: [{ name: def.ministry, url: e.link }],
      sourceId: def.id,
      firstSeen: now.toISOString(),
      importance: c.importance,
      ...(c.noise ? { noise: true } : {}),
      enriched: 'rules'
    });
  }
  return out;
}

export function rssSource(def: RssDef): Source {
  return {
    id: def.id,
    name: def.name,
    kind: 'rss',
    url: def.url,
    async run(ctx) {
      const page = await ctx.http.get(def.url, { accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' });
      if (page.notModified || !page.changed) return { items: [], fetched: 0, unchanged: true };
      const feed = parseFeed(page.text);
      return { items: entriesToItems(feed.entries, def, ctx.now), fetched: feed.entries.length };
    }
  };
}
