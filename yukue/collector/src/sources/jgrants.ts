import type { JGrant, UpdateItem } from '../../../shared/types.ts';
import { importanceOf, stageOf, themeOf } from '../classify.ts';
import { cleanTitle, jstDate, parseDate, shortJaDate } from '../text.ts';
import type { Source } from './types.ts';

const API = 'https://api.jgrants-portal.go.jp/exp/v1/public/subsidies';
/** 公開APIはキーワードが必須なので、広い言葉をいくつか投げて、IDでまとめる。 */
const KEYWORDS = ['補助金', '助成', '支援', '事業'];
/** 1回の実行で「動き」に加える、新しい全国向け補助金の上限。 */
const NEW_ITEM_LIMIT = 8;

interface ApiRow {
  id?: unknown;
  title?: unknown;
  target_area_search?: unknown;
  subsidy_max_limit?: unknown;
  acceptance_start_datetime?: unknown;
  acceptance_end_datetime?: unknown;
  target_number_of_employees?: unknown;
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const day = (v: unknown) => { const d = parseDate(str(v)); return d ? jstDate(d) : null; };

/**
 * 対象地域の表示。APIは「全国 / 北海道 / 青森県 / …」のように、すべての都道府県を並べて返すことがある。
 * 全国が含まれていれば「全国」、数が多いときは先頭の3つと全体の数にまとめる。
 */
export function areaLabel(raw: string): string {
  const parts = raw.split('/').map(s => s.trim()).filter(Boolean);
  if (!parts.length) return '指定なし';
  if (parts.includes('全国')) return '全国';
  return parts.length > 4 ? `${parts.slice(0, 3).join('・')}など${parts.length}地域` : parts.join('・');
}

export function grantFromApi(row: ApiRow): JGrant | null {
  const id = str(row.id);
  const title = cleanTitle(str(row.title));
  if (!/^[A-Za-z0-9]+$/.test(id) || !title) return null;
  const max = typeof row.subsidy_max_limit === 'number' && row.subsidy_max_limit > 0 ? row.subsidy_max_limit : null;
  return {
    id,
    title,
    area: areaLabel(str(row.target_area_search)),
    maxAmount: max,
    start: day(row.acceptance_start_datetime),
    end: day(row.acceptance_end_datetime),
    employees: str(row.target_number_of_employees) || null,
    url: `https://www.jgrants-portal.go.jp/subsidy/${id}`
  };
}

/** 円の金額を「2億5,000万円」「200万円」の形にする。 */
export function formatYen(yen: number): string {
  const oku = Math.floor(yen / 1e8);
  const man = Math.round((yen % 1e8) / 1e4);
  if (oku && man) return `${oku.toLocaleString('ja-JP')}億${man.toLocaleString('ja-JP')}万円`;
  if (oku) return `${oku.toLocaleString('ja-JP')}億円`;
  if (man) return `${man.toLocaleString('ja-JP')}万円`;
  return `${yen.toLocaleString('ja-JP')}円`;
}

export function grantToItem(g: JGrant, now: Date): UpdateItem {
  const stage = stageOf('grant', 1);
  const amount = g.maxAmount ? `上限 ${formatYen(g.maxAmount)}` : undefined;
  // 題の頭に付く「令和7年度補正予算」は財源の説明なので、分野や重要度の判定からは外す
  const subject = g.title.replace(/令和\s*\d+\s*年度\s*(第\d次)?\s*(補正|当初)?(予算)?/g, '');
  return {
    id: `jgrants:${g.id}`,
    date: jstDate(now),
    type: 'grant',
    theme: themeOf(subject, '', true),
    title: `${g.title}、受付中`,
    originalTitle: g.title,
    summary: `Jグランツで申請を受け付けています。${g.end ? `締切は${shortJaDate(g.end)}。` : ''}対象地域：${g.area}。`,
    ministry: 'Jグランツ掲載',
    ...(amount ? { amount } : {}),
    stage,
    ...(g.end ? { deadline: g.end } : {}),
    links: [{ name: 'Jグランツ', url: g.url }],
    sourceId: 'jgrants',
    firstSeen: now.toISOString(),
    importance: importanceOf('grant', stage, subject, amount, false),
    enriched: 'rules'
  };
}

export const jgrantsSource: Source = {
  id: 'jgrants',
  name: 'Jグランツ（補助金の公開API）',
  kind: 'api',
  url: API,
  async run(ctx) {
    const byId = new Map<string, JGrant>();
    let fetched = 0;
    for (const kw of KEYWORDS) {
      const url = `${API}?keyword=${encodeURIComponent(kw)}&sort=created_date&order=DESC&acceptance=1`;
      const page = await ctx.http.get(url, { accept: 'application/json', conditional: false });
      const body = JSON.parse(page.text) as { result?: ApiRow[] };
      const rows = Array.isArray(body.result) ? body.result : [];
      fetched += rows.length;
      for (const r of rows) { const g = grantFromApi(r); if (g) byId.set(g.id, g); }
    }
    // 1件も返らないのは、APIの形が変わったときくらい。受付中の補助金の一覧を空で上書きしないよう、失敗にする
    if (!byId.size) throw new Error('Jグランツから、補助金が1件も返ってきませんでした（APIの形が変わった可能性があります）');
    const today = jstDate(ctx.now);
    const grants = [...byId.values()]
      .filter(g => !g.end || g.end >= today)
      .sort((a, b) => (a.end ?? '9999').localeCompare(b.end ?? '9999') || a.title.localeCompare(b.title, 'ja'));
    // 全国向けで、まだ見ていないものだけを「動き」に出す。数が多いので、上限額の大きい順に絞る
    const fresh = grants.filter(g => /全国/.test(g.area) && !ctx.state.seen[`jgrants:${g.id}`]);
    for (const g of grants) ctx.state.seen[`jgrants:${g.id}`] ??= ctx.now.toISOString();
    // 地域や年度だけがちがう同じ補助金（【近畿支部】【四国支部】…）は、1件だけ出す
    const family = (title: string) => title.replace(/【[^】]*】|（[^）]*）|\([^)]*\)|令和\s*\d+\s*年度|第?\d+次?公募|\s/g, '').slice(0, 14);
    const families = new Set<string>();
    const items: UpdateItem[] = [];
    for (const g of fresh.sort((a, b) => (b.maxAmount ?? 0) - (a.maxAmount ?? 0))) {
      const key = family(g.title);
      if (families.has(key) || items.length >= NEW_ITEM_LIMIT) continue;
      families.add(key);
      items.push(grantToItem(g, ctx.now));
    }
    return { items, fetched, grants };
  }
};
