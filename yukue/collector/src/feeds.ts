import { XMLParser } from 'fast-xml-parser';
import { canonicalUrl, cleanTitle, parseDate, stripTags } from './text.ts';

export interface FeedEntry {
  title: string;
  link: string;
  date: Date | null;
  summary: string;
  categories: string[];
  author: string;
}

export interface Feed {
  title: string;
  entries: FeedEntry[];
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  processEntities: true
});

type Node = Record<string, unknown>;
const isNode = (v: unknown): v is Node => typeof v === 'object' && v !== null && !Array.isArray(v);
const arr = (v: unknown): unknown[] => (v == null ? [] : Array.isArray(v) ? v : [v]);

/** 要素の中身を文字列にする（文字列、{#text}、配列の先頭のどれでも）。 */
function text(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return text(v[0]);
  if (isNode(v)) return text(v['#text']);
  return '';
}

function rssItem(raw: unknown): FeedEntry {
  const it = isNode(raw) ? raw : {};
  const guid = it.guid;
  const guidIsLink = isNode(guid) ? guid['@_isPermaLink'] !== 'false' : true;
  const link = text(it.link) || text(it['@_rdf:about']) || (guidIsLink && /^https?:/.test(text(guid)) ? text(guid) : '');
  return {
    title: cleanTitle(text(it.title)),
    link: link ? canonicalUrl(link) : '',
    date: parseDate(text(it.pubDate) || text(it['dc:date']) || text(it.date)),
    summary: stripTags(text(it.description) || text(it['content:encoded'])),
    categories: [...arr(it.category), ...arr(it['dc:subject'])].map(text).filter(Boolean),
    author: text(it['dc:creator']) || text(it.author)
  };
}

function atomEntry(raw: unknown): FeedEntry {
  const e = isNode(raw) ? raw : {};
  const links = arr(e.link);
  const alt = links.find(l => isNode(l) && (l['@_rel'] ?? 'alternate') === 'alternate') ?? links[0];
  const href = isNode(alt) ? text(alt['@_href']) : text(alt);
  const author = isNode(e.author) ? text(e.author.name) : text(e.author);
  return {
    title: cleanTitle(text(e.title)),
    link: href ? canonicalUrl(href) : '',
    date: parseDate(text(e.updated) || text(e.published)),
    summary: stripTags(text(e.summary) || text(e.content)),
    categories: arr(e.category).map(c => (isNode(c) ? text(c['@_term']) || text(c) : text(c))).filter(Boolean),
    author
  };
}

/** RSS 2.0、RSS 1.0（RDF）、Atom を同じ形にそろえて返す。 */
export function parseFeed(xml: string): Feed {
  const doc = parser.parse(xml) as Node;
  const rss = doc.rss;
  if (isNode(rss) && isNode(rss.channel)) {
    return { title: text(rss.channel.title), entries: arr(rss.channel.item).map(rssItem) };
  }
  const rdf = doc['rdf:RDF'] ?? doc.RDF;
  if (isNode(rdf)) {
    return { title: isNode(rdf.channel) ? text(rdf.channel.title) : '', entries: arr(rdf.item).map(rssItem) };
  }
  if (isNode(doc.feed)) {
    return { title: text(doc.feed.title), entries: arr(doc.feed.entry).map(atomEntry) };
  }
  throw new Error('フィードとして読めませんでした（RSS・RDF・Atom のいずれでもない）');
}

/** ページの <link rel="alternate"> から、フィードのURLを見つける。 */
export function findFeedLinks(html: string, pageUrl: string): string[] {
  const out = new Set<string>();
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    if (!/rel\s*=\s*["']?alternate/i.test(tag)) continue;
    if (!/type\s*=\s*["']?application\/(rss|atom|rdf)\+xml/i.test(tag)) continue;
    const href = /href\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (href) out.add(canonicalUrl(href, pageUrl));
  }
  return [...out];
}
