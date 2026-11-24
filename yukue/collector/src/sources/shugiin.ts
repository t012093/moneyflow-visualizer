import { parse } from 'node-html-parser';
import type { Stage, UpdateItem, UpdateType } from '../../../shared/types.ts';
import { importanceOf, stageOf, themeOf } from '../classify.ts';
import { addDays, jstDate, parseJaDate, shortJaDate, toHalfWidth } from '../text.ts';
import type { Source } from './types.ts';

const LIST = 'https://www.shugiin.go.jp/internet/itdb_gian.nsf/html/gian/menu.htm';

export interface BillRow {
  /** 閣法／衆法／参法 */
  kind: string;
  /** 提出回次（第何回国会か） */
  kaiji: string;
  no: string;
  title: string;
  /** 審議状況（「衆議院で審議中」「成立」など） */
  status: string;
  keikaUrl: string;
  honbunUrl: string;
}

const clean = (s: string) => toHalfWidth(s.replace(/\s+/g, ' ').trim());

/** 議案の一覧ページ。表ごとに「衆法の一覧」「閣法の一覧」などの見出しが付いている。 */
export function parseBillList(html: string, base: string): BillRow[] {
  const out: BillRow[] = [];
  for (const table of parse(html).querySelectorAll('table')) {
    const kind = clean(table.querySelector('caption')?.text ?? '').replace('の一覧', '');
    if (!['閣法', '衆法', '参法'].includes(kind)) continue;
    for (const tr of table.querySelectorAll('tr')) {
      const td = tr.querySelectorAll('td');
      if (td.length < 5) continue;
      const href = (re: RegExp) => tr.querySelectorAll('a').map(a => a.getAttribute('href') ?? '').find(h => re.test(h));
      const keika = href(/keika\//);
      if (!keika) continue;
      const honbun = href(/honbun\//);
      out.push({
        kind,
        kaiji: clean(td[0].text),
        no: clean(td[1].text),
        title: clean(td[2].text),
        status: clean(td[3].text),
        keikaUrl: new URL(keika, base).toString(),
        honbunUrl: honbun ? new URL(honbun, base).toString() : ''
      });
    }
  }
  return out;
}

/** 経過のページ（項目と内容の2列の表）を、項目名 → 内容 にする。 */
export function parseKeika(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const tr of parse(html).querySelectorAll('tr')) {
    const td = tr.querySelectorAll('td');
    if (td.length >= 2) out[clean(td[0].text)] = clean(td[1].text);
  }
  return out;
}

const KIND = {
  閣法: { code: 'kaku', by: '内閣提出の法案', boost: 8 },
  衆法: { code: 'shu', by: '衆議院議員提出の法案', boost: 0 },
  参法: { code: 'san', by: '参議院議員提出の法案', boost: 0 }
} as const;

export const billKey = (row: BillRow) => `gian:${KIND[row.kind as keyof typeof KIND]?.code ?? 'etc'}-${row.kaiji}-${row.no}`;

const TAX = /租税|消費税|所得税|法人税|税率|関税|税制/;

/** 「日付 ／ 結果」の欄から、日付と結果を取り出す。 */
function cell(keika: Record<string, string>, name: string): { date: string | null; note: string } {
  const [d, n] = (keika[name] ?? '').split('／');
  return { date: parseJaDate(d), note: (n ?? '').trim() };
}

/** 一覧の1行と経過から、いまの段階と、直近の出来事の日付を決める。 */
export function billToItem(row: BillRow, keika: Record<string, string>, now: Date): UpdateItem {
  const today = jstDate(now);
  const kind = KIND[row.kind as keyof typeof KIND] ?? { code: 'etc', by: '法案', boost: 0 };
  const shuRecv = cell(keika, '衆議院議案受理年月日');
  const shuRef = cell(keika, '衆議院付託年月日／衆議院付託委員会');
  const shuEnd = cell(keika, '衆議院審議終了年月日／衆議院審議結果');
  const sanRecv = cell(keika, '参議院議案受理年月日');
  const sanRef = cell(keika, '参議院付託年月日／参議院付託委員会');
  const sanEnd = cell(keika, '参議院審議終了年月日／参議院審議結果');
  const pub = cell(keika, '公布年月日／法律番号');
  const submitted = [shuRecv.date, sanRecv.date].filter((d): d is string => !!d).sort()[0] ?? null;
  // 前の国会から持ち越した法案は受理日が空で、委員会への付託日だけが入っている
  const referred = [shuRef, sanRef].filter(c => c.date).sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '')).pop() ?? null;
  const type: UpdateType = TAX.test(row.title) ? 'tax' : 'law';
  const at = (law: number, tax: number, label?: string): Stage => (type === 'tax' ? stageOf('tax', tax, label) : stageOf('law', law, label));

  const steps: string[] = [];
  if (submitted) steps.push(`${shortJaDate(submitted)}に提出`);
  else if (referred?.date) steps.push(`${shortJaDate(referred.date)}に${referred.note ? `${referred.note}委員会に` : '委員会に'}付託`);
  const first = row.kind === '参法' ? sanEnd : shuEnd;
  const second = row.kind === '参法' ? shuEnd : sanEnd;
  const firstHouse = row.kind === '参法' ? '参議院' : '衆議院';
  const secondHouse = row.kind === '参法' ? '衆議院' : '参議院';
  if (first.date) steps.push(`${shortJaDate(first.date)}に${firstHouse}で${first.note || '議決'}`);
  if (second.date) steps.push(`${shortJaDate(second.date)}に${secondHouse}で${second.note || '議決'}`);

  let stage: Stage;
  let date: string | null;
  if (pub.date) {
    stage = at(4, 4, '公布');
    date = pub.date;
    steps.push(`${shortJaDate(pub.date)}に公布${pub.note ? `（法律第${pub.note}号）` : ''}`);
  } else if (row.status === '成立') {
    stage = at(3, 4, '成立');
    date = [shuEnd.date, sanEnd.date].filter((d): d is string => !!d).sort().pop() ?? null;
  } else if (/審議中/.test(row.status)) {
    stage = at(2, 3, row.status);
    date = [submitted, referred?.date, first.date].filter((d): d is string => !!d).sort().pop() ?? null;
  } else {
    stage = at(2, 3, row.status || '国会審議');
    date = [submitted, referred?.date, shuEnd.date, sanEnd.date].filter((d): d is string => !!d).sort().pop() ?? null;
  }
  const eventDate = date ?? today;
  const done = !!pub.date || row.status === '成立';
  const summaryTail = done ? '' : `いまは${row.status}。`;
  const summary = `${kind.by}。${steps.length ? steps.join('、') + '。' : ''}${summaryTail}`;
  // 成立したあとは「法律案」ではなく「法律」と呼ぶ
  const title = done ? row.title.replace(/法律案$/, '法律') : row.title;
  // 長く動きのない継続審議の法案は、重要度を下げる
  const stale = /審議中/.test(row.status) && eventDate < addDays(today, -45);
  const links = [{ name: '衆議院 議案経過', url: row.keikaUrl }];
  if (row.honbunUrl) links.push({ name: '法案の本文', url: row.honbunUrl });
  return {
    id: billKey(row),
    date: eventDate,
    type,
    theme: themeOf(row.title, ''),
    title,
    ...(title !== row.title ? { originalTitle: row.title } : {}),
    summary,
    ministry: kind.by,
    stage,
    links,
    sourceId: 'shugiin',
    firstSeen: now.toISOString(),
    importance: Math.max(0, importanceOf(type, stage, row.title, undefined, false, kind.boost) - (stale ? 20 : 0)),
    enriched: 'rules'
  };
}

export function shugiinSource(maxPages = 90): Source {
  return {
    id: 'shugiin',
    name: '衆議院 議案情報',
    kind: 'html',
    url: LIST,
    async run(ctx) {
      const list = await ctx.http.get(LIST, { accept: 'text/html' });
      if (list.notModified || !list.changed) return { items: [], fetched: 0, unchanged: true };
      const rows = parseBillList(list.text, LIST);
      // 読み残しがあるうちは、一覧が変わっていなくても次の実行でもう一度見る
      const revisit = () => { delete ctx.state.http[LIST]; };
      if (!rows.length) {
        revisit();
        throw new Error('議案の一覧から、法案を1件も読み取れませんでした（ページの作りが変わった可能性があります）');
      }
      const out: UpdateItem[] = [];
      let pages = 0;
      let leftover = false;
      for (const row of rows) {
        const key = billKey(row);
        if (ctx.state.gian[key]?.status === row.status) continue;
        if (pages >= maxPages) { ctx.log(`議案: 1回の上限（${maxPages}ページ）に達したので、残りは次回に回します`); leftover = true; break; }
        try {
          const page = await ctx.http.get(row.keikaUrl, { accept: 'text/html', conditional: false });
          pages++;
          const keika = parseKeika(page.text);
          // 日付がひとつも入っていない法案は、いつの動きか分からないので一覧には出さない
          if (Object.values(keika).some(v => parseJaDate(v))) out.push(billToItem(row, keika, ctx.now));
          ctx.state.gian[key] = { status: row.status };
        } catch (e) {
          leftover = true;
          ctx.log(`議案 ${key} の経過を取得できませんでした: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      if (leftover) revisit();
      return { items: out, fetched: rows.length };
    }
  };
}
