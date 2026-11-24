/** Jグランツの「受付中の補助金」の絞り込みと並べ方。 */
import { PREFS } from '../content.ts';
import type { JGrant } from '../types.ts';
import { dayLabel } from './dates.ts';
import { normalizeText } from './updates.ts';

/** 対象地域は「東京都 / 神奈川県」のように並ぶことがあるので、1つずつに分ける */
export function areaParts(area: string | null | undefined): string[] {
  return (area ?? '')
    .split(/[\/／、,，]/)
    .map(s => s.trim())
    .filter(Boolean);
}

/**
 * 対象地域を短く書く。地域がたくさん並ぶ補助金があるので（47都道府県を並べたものもある）、
 * 「全国」を含めば「全国」、多いときは max 件までを並べて「ほかN地域」とする。
 */
export function areaLabel(area: string | null | undefined, max = 2): string {
  const parts = areaParts(area);
  if (!parts.length) return '';
  if (parts.includes('全国')) return '全国';
  if (parts.length <= max) return parts.join('、');
  return `${parts.slice(0, max).join('、')}、ほか${parts.length - max}地域`;
}

/** データに出てくる地域の一覧。「全国」、都道府県（北から）、それ以外の順 */
export function jgrantAreas(items: readonly JGrant[]): string[] {
  const set = new Set<string>();
  for (const g of items) for (const a of areaParts(g.area)) set.add(a);
  const rank = (a: string): number => {
    if (a === '全国') return -1;
    const i = PREFS.indexOf(a);
    return i >= 0 ? i : PREFS.length;
  };
  return [...set].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b, 'ja'));
}

export interface JGrantFilter {
  query: string;
  /** '' はすべての地域 */
  area: string;
}

/** 受付が終わったものを外し、キーワード（題・地域）と地域で絞る。締切の近い順 */
export function filterJGrants(items: readonly JGrant[], f: JGrantFilter, today: string): JGrant[] {
  const terms = normalizeText(f.query).split(/\s+/).filter(Boolean);
  return items
    .filter(g => {
      if (g.end && g.end < today) return false;
      if (f.area && !areaParts(g.area).includes(f.area)) return false;
      if (!terms.length) return true;
      const hay = normalizeText(`${g.title}\n${g.area}`);
      return terms.every(t => hay.includes(t));
    })
    .map((g, i) => ({ g, i }))
    .sort((a, b) => {
      const ea = a.g.end ?? '9999-12-31';
      const eb = b.g.end ?? '9999-12-31';
      return ea < eb ? -1 : ea > eb ? 1 : a.i - b.i;
    })
    .map(x => x.g);
}

/** 受付の状態（右上の丸い印に出す） */
export function jgrantStatus(g: JGrant, today: string): { cls: 'open' | 'soon'; text: string } {
  if (g.start && g.start > today) return { cls: 'soon', text: `受付前 ・ ${dayLabel(g.start, today)}から` };
  return { cls: 'open', text: g.end ? `受付中 ・ ${dayLabel(g.end, today)}まで` : '受付中' };
}
