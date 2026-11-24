import { parse } from 'node-html-parser';
import type { Stage, UpdateItem, UpdateType } from '../../../shared/types.ts';
import { classify, importanceOf, stageOf, themeOf } from '../classify.ts';
import { extractAmount, shortId, shortJaDate, toHalfWidth } from '../text.ts';
import type { Source } from './types.ts';

const INDEX = 'https://www.kantei.go.jp/jp/kakugi/index.html';

export interface KakugiItem {
  /** 一般案件／国会提出案件／法律案／政令／公布（法律）／人事／配布 */
  section: string;
  title: string;
  /** ページに書かれているままの文字（全角の数字を含む）。その案件の位置へのリンクに使う */
  raw: string;
  ministry: string;
}

/** 閣議案件の一覧ページから、各回のページを新しい順に返す。key は「日付8桁＋回2桁」。 */
export function parseKakugiIndex(html: string, base: string): { key: string; url: string }[] {
  const found = new Map<string, string>();
  for (const m of html.matchAll(/href="(\/jp\/kakugi\/\d{4}\/kakugi-(\d{10})\.html)"/g)) found.set(m[2], new URL(m[1], base).toString());
  return [...found].sort((a, b) => b[0].localeCompare(a[0])).map(([key, url]) => ({ key, url }));
}

/** 1回分の閣議案件。案件名の段落の次に、右寄せで担当府省が書かれている（「同上」は直前と同じ）。 */
export function parseKakugiMeeting(html: string): KakugiItem[] {
  const body = parse(html).querySelector('.article-content');
  if (!body) return [];
  const items: KakugiItem[] = [];
  let section = '';
  let lastMinistry = '';
  for (const el of body.querySelectorAll('h2, p')) {
    const raw = el.text.replace(/\s+/g, ' ').trim();
    const txt = toHalfWidth(raw);
    if (!txt) continue;
    if (el.tagName === 'H2') { section = txt.replace(/\s/g, ''); lastMinistry = ''; continue; }
    if (!section || section === '用語解説') continue;
    if (/text-align:\s*right/i.test(el.getAttribute('style') ?? '')) {
      const name = txt.replace(/^[（(]\s*|\s*[）)]$/g, '');
      const ministry = name === '同上' ? lastMinistry : name;
      lastMinistry = ministry;
      const last = items[items.length - 1];
      if (last && last.section === section && !last.ministry) last.ministry = ministry;
      continue;
    }
    items.push({ section, title: txt, raw, ministry: '' });
  }
  return items;
}

/** 1ページに案件が並ぶので、その案件の場所を指すリンクにする（対応するブラウザでは、そこまで移動して強調される）。 */
export function itemUrl(pageUrl: string, raw: string): string {
  const head = raw.replace(/（(決定|了解|報告)）$/, '').slice(0, 80);
  return `${pageUrl}#:~:text=${encodeURIComponent(head).replace(/-/g, '%2D')}`;
}

const TAX = /税/;
const ROUTINE = /報告書及び同報告書に付する|答弁書|海外出張|叙位|叙勲|褒章|臨時代理|信任状|解任状|特命全権|の指定について$/;

/** 案件を動きにする。同じ府省の似た案件が4件以上続くときは、先頭の1件にまとめる。 */
export function kakugiToItems(items: KakugiItem[], key: string, url: string, now: Date): UpdateItem[] {
  const date = `${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8)}`;
  const day = shortJaDate(date);
  const built: { group: string; item: UpdateItem }[] = [];
  for (const it of items) {
    const decision = /（(決定|了解|報告)）$/.exec(it.title)?.[1] ?? '決定';
    const title = it.title.replace(/（(決定|了解|報告)）$/, '');
    const c = classify({ title, ministry: it.ministry, boost: 6 });
    let type: UpdateType;
    let stage: Stage | undefined;
    let how: string;
    if (/^公布/.test(it.section)) {
      type = TAX.test(title) ? 'tax' : 'law';
      stage = type === 'tax' ? stageOf('tax', 4, '公布') : stageOf('law', 4);
      how = `${day}の閣議で、公布を決定。`;
    } else if (it.section === '法律案') {
      type = TAX.test(title) ? 'tax' : 'law';
      stage = type === 'tax' ? stageOf('tax', 2) : stageOf('law', 1);
      how = `${day}の閣議で、法律案を決定。国会に提出される。`;
    } else if (it.section === '政令') {
      type = 'system';
      stage = stageOf('system', 2, '政令を決定');
      how = `${day}の閣議で、政令を決定。`;
    } else {
      type = c.type === 'news' ? 'system' : c.type;
      stage = c.type === 'news' || !c.stage ? (type === 'system' ? stageOf('system', 2, decision === '了解' ? '閣議了解' : '閣議決定') : c.stage) : c.stage;
      how = `${day}の閣議で${decision}。`;
    }
    const noise = it.section === '人事' || it.section === '配布' || c.noise || ROUTINE.test(title);
    const amount = extractAmount(title);
    const ministry = it.ministry.replace(/^（|）$/g, '') || '閣議案件';
    built.push({
      group: `${it.section}|${ministry}|${title.slice(0, 5)}`,
      item: {
        id: `kakugi:${key}:${shortId(title)}`,
        date,
        type,
        theme: themeOf(title, ministry),
        title,
        summary: how,
        ministry,
        ...(amount ? { amount } : {}),
        ...(stage ? { stage } : {}),
        links: [{ name: '首相官邸 閣議案件', url: itemUrl(url, it.raw) }],
        sourceId: 'kakugi',
        firstSeen: now.toISOString(),
        // 政令は数が多く、法律の施行日や細目を決めるものが大半なので、ほかの案件より下に置く
        importance: importanceOf(type, stage, title, amount, noise, it.section === '政令' ? -10 : 6),
        ...(noise ? { noise: true } : {}),
        enriched: 'rules'
      }
    });
  }
  const counts = new Map<string, number>();
  for (const b of built) counts.set(b.group, (counts.get(b.group) ?? 0) + 1);
  const used = new Set<string>();
  const out: UpdateItem[] = [];
  for (const b of built) {
    const n = counts.get(b.group) ?? 1;
    if (n < 4) { out.push(b.item); continue; }
    if (used.has(b.group)) continue;
    used.add(b.group);
    out.push({ ...b.item, summary: `${b.item.summary}同じ種類の案件が、ほかに${n - 1}件あります。` });
  }
  return out;
}

export function kakugiSource(maxMeetings = 4): Source {
  return {
    id: 'kakugi',
    name: '首相官邸 閣議案件',
    kind: 'html',
    url: INDEX,
    async run(ctx) {
      const index = await ctx.http.get(INDEX, { accept: 'text/html' });
      if (index.notModified || !index.changed) return { items: [], fetched: 0, unchanged: true };
      const listed = parseKakugiIndex(index.text, INDEX);
      // 読み残しがあるうちは、一覧が変わっていなくても次の実行でもう一度見る
      const revisit = () => { delete ctx.state.http[INDEX]; };
      if (!listed.length) {
        revisit();
        throw new Error('閣議案件の一覧から、各回のページを見つけられませんでした（ページの作りが変わった可能性があります）');
      }
      const unseen = listed.filter(m => !ctx.state.seen[`kakugi:${m.key}`]);
      const out: UpdateItem[] = [];
      let fetched = 0;
      let done = 0;
      for (const m of unseen.slice(0, maxMeetings)) {
        try {
          const page = await ctx.http.get(m.url, { accept: 'text/html', conditional: false });
          const parsed = parseKakugiMeeting(page.text);
          fetched += parsed.length;
          out.push(...kakugiToItems(parsed, m.key, m.url, ctx.now));
          ctx.state.seen[`kakugi:${m.key}`] = ctx.now.toISOString();
          done++;
          ctx.log(`閣議 ${m.key}: ${parsed.length}件`);
        } catch (e) {
          // 1回分が取れなくても、そこまでに読めた回は生かす。取れなかった回は、次の実行でもう一度試す
          if (!done) { revisit(); throw e; }
          ctx.log(`閣議 ${m.key} を取得できませんでした（次の実行でもう一度試します）: ${e instanceof Error ? e.message : String(e)}`);
          break;
        }
      }
      if (done < unseen.length) revisit();
      return { items: out, fetched };
    }
  };
}
