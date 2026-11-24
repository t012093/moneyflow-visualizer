/** 流れ図に描く内容（列・項目・帯）を、予算のデータから組み立てる。 */
import type { BudgetFile, FlowUse, ThemeId } from '../types.ts';

export type NodeKind = 'src' | 'pool' | 'use' | 'item' | 'recip';

export interface FlowNode {
  id: string;
  name: string;
  /** 狭い画面で使う短い名前 */
  short?: string;
  /** 兆円 */
  v: number;
  kind: NodeKind;
  theme?: ThemeId;
  /** 押すと内訳に進める */
  drill?: boolean;
}

export interface FlowCol {
  title: string;
  titleShort?: string;
  /** 見出しに金額も出す（一般会計の列） */
  showValue?: boolean;
  nodes: FlowNode[];
}

export interface FlowLink {
  /** 出どころの項目ID */
  s: string;
  /** 行き先の項目ID */
  t: string;
  v: number;
  /** 帯の色にする分野。null は中立の色 */
  c: ThemeId | null;
}

export interface FlowModel {
  /** 'root'（全体）か、内訳を開いている使いみちのID */
  key: string;
  cols: FlowCol[];
  links: FlowLink[];
}

export const POOL_ID = 'pool';
/** 届け先のIDは、内訳のIDと重ならないように印を付ける */
export const recipNodeId = (recipId: string): string => `recip:${recipId}`;

const hasDrill = (u: FlowUse): boolean => !!u.drill && u.drill.items.length > 0;

/** 全体：財源 → 一般会計 → 使いみち */
export function rootModel(budget: BudgetFile): FlowModel {
  return {
    key: 'root',
    cols: [
      {
        title: '財源（どこから）',
        titleShort: '財源',
        nodes: budget.src.map(s => ({ id: s.id, name: s.name, short: s.short, v: s.v, kind: 'src' as const }))
      },
      { title: '一般会計', showValue: true, nodes: [{ id: POOL_ID, name: '一般会計', v: budget.fy.total, kind: 'pool' }] },
      {
        title: '使いみち（どこへ）',
        titleShort: '使いみち',
        nodes: budget.use.map(u => ({
          id: u.id,
          name: u.name,
          short: u.short,
          v: u.v,
          theme: u.theme,
          kind: 'use' as const,
          drill: hasDrill(u)
        }))
      }
    ],
    links: [
      ...budget.src.map(s => ({ s: s.id, t: POOL_ID, v: s.v, c: null })),
      ...budget.use.map(u => ({ s: POOL_ID, t: u.id, v: u.v, c: u.theme }))
    ]
  };
}

/** 内訳：分野 → 内訳 → 届け先。内訳のない使いみちなら null */
export function drillModel(budget: BudgetFile, id: string): FlowModel | null {
  const u = budget.use.find(x => x.id === id);
  if (!u || !u.drill || !hasDrill(u)) return null;
  const items = u.drill.items;
  const received = new Map<string, number>();
  const links: FlowLink[] = [];
  for (const it of items) {
    links.push({ s: u.id, t: it.id, v: it.v, c: u.theme });
    for (const [r, v] of Object.entries(it.to)) {
      if (!(v > 0)) continue;
      received.set(r, (received.get(r) ?? 0) + v);
      links.push({ s: it.id, t: recipNodeId(r), v, c: u.theme });
    }
  }
  // 届け先は、データに書かれた順に並べる。名前の登録がないものは最後に、IDのまま出す
  const known = Object.keys(budget.recips).filter(r => received.has(r));
  const unknown = [...received.keys()].filter(r => !Object.hasOwn(budget.recips, r));
  return {
    key: u.id,
    cols: [
      { title: '分野', nodes: [{ id: u.id, name: u.name, v: u.v, theme: u.theme, kind: 'use' }] },
      { title: '内訳', nodes: items.map(it => ({ id: it.id, name: it.name, v: it.v, theme: u.theme, kind: 'item' as const })) },
      {
        title: '届け先（おもな受け取り手）',
        nodes: [...known, ...unknown].map(r => ({
          id: recipNodeId(r),
          name: budget.recips[r] ?? r,
          v: received.get(r) ?? 0,
          kind: 'recip' as const
        }))
      }
    ],
    links
  };
}

export function findNode(model: FlowModel, id: string): FlowNode | null {
  for (const c of model.cols) {
    const n = c.nodes.find(x => x.id === id);
    if (n) return n;
  }
  return null;
}

/** 内訳の項目IDから、それを持つ使いみちをさがす */
export function parentUseOf(budget: BudgetFile, itemId: string): FlowUse | null {
  return budget.use.find(u => !!u.drill && u.drill.items.some(i => i.id === itemId)) ?? null;
}
