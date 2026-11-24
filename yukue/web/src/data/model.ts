/** 読み込んだデータから、画面のあちこちで使う索引と書式をまとめて作る。 */
import { makeFormatters, type Formatters } from '../lib/format.ts';
import { drillModel, rootModel, type FlowModel, type FlowNode } from '../lib/flowModel.ts';
import { sortUpdates, withoutNoise } from '../lib/updates.ts';
import type { BudgetFile, FlowSource, FlowUse, Program, UpdateItem } from '../types.ts';
import type { AppData } from './load.ts';

export interface Model {
  data: AppData;
  budget: BudgetFile;
  fy: BudgetFile['fy'];
  fmt: Formatters;
  useById: ReadonlyMap<string, FlowUse>;
  srcById: ReadonlyMap<string, FlowSource>;
  upById: ReadonlyMap<string, UpdateItem>;
  /** すべての動き。新しい順（同じ日は重要度の高い順） */
  updates: readonly UpdateItem[];
  /** 既定の一覧に出す動き（人事・入札・会見などを外したもの） */
  visibleUpdates: readonly UpdateItem[];
  programs: readonly Program[];
  /** 最初にえらんでおく使いみち */
  firstUseId: string;
  /** 分野の色（CSS の値。例：var(--t1)） */
  themeVar: (theme: string | null | undefined) => string;
  themeName: (theme: string) => string;
  /** 図の項目の色 */
  nodeColor: (node: Pick<FlowNode, 'kind' | 'theme'>) => string;
  /** 全体の図 */
  root: FlowModel;
  /** 内訳の図。内訳のない使いみちなら null */
  drill: (id: string) => FlowModel | null;
}

const CSS_VAR = /^--[a-zA-Z0-9-]+$/;

export function buildModel(data: AppData): Model {
  const { budget } = data;
  const themes: Record<string, { name: string; c: string } | undefined> = budget.themes;
  const fallback = themes.other;
  const themeVar = (theme: string | null | undefined): string => {
    const c = (theme ? themes[theme]?.c : undefined) ?? fallback?.c ?? '--t0';
    return `var(${CSS_VAR.test(c) ? c : '--t0'})`;
  };
  const themeName = (theme: string): string => themes[theme]?.name ?? fallback?.name ?? 'その他';
  const updates = sortUpdates(data.updates.items);
  const drills = new Map<string, FlowModel | null>();
  return {
    data,
    budget,
    fy: budget.fy,
    fmt: makeFormatters(budget.fy.total, budget.fy.pop),
    useById: new Map(budget.use.map(u => [u.id, u])),
    srcById: new Map(budget.src.map(s => [s.id, s])),
    upById: new Map(updates.map(u => [u.id, u])),
    updates,
    visibleUpdates: withoutNoise(updates),
    programs: data.programs,
    firstUseId: budget.use[0]?.id ?? '',
    themeVar,
    themeName,
    nodeColor: node => (node.kind === 'pool' ? 'var(--flow-pool)' : node.theme ? themeVar(node.theme) : 'var(--flow-neutral)'),
    root: rootModel(budget),
    drill(id) {
      if (!drills.has(id)) drills.set(id, drillModel(budget, id));
      return drills.get(id) ?? null;
    }
  };
}
