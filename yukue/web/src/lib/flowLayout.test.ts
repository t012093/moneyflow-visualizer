import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { budget } from '../test/fixtures.ts';
import type { BudgetFile } from '../types.ts';
import { LABEL_GAP, layoutFlow, neighborhood, ribbonPath, spreadLabels, type FlowLayout, type LaidNode } from './flowLayout.ts';
import { drillModel, findNode, parentUseOf, POOL_ID, recipNodeId, rootModel, type FlowModel } from './flowModel.ts';
import { fmtCho, makeFormatters } from './format.ts';

const root = rootModel(budget);
const social = drillModel(budget, 'social');
const defense = drillModel(budget, 'defense');
const fmt = makeFormatters(budget.fy.total, budget.fy.pop);
const lay = (model: FlowModel, width: number, compact = false): FlowLayout => layoutFlow(model, width, { fmt: fmtCho, compact });

const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);
const byId = (l: FlowLayout, id: string): LaidNode => {
  const n = l.nodes.find(x => x.node.id === id);
  if (!n) throw new Error(`項目がありません: ${id}`);
  return n;
};
/** ラベルが占める横の範囲 */
const labelSpan = (n: LaidNode): [number, number] | null => {
  if (!n.label) return null;
  return n.label.anchor === 'end' ? [n.label.x - n.label.width, n.label.x] : [n.label.x, n.label.x + n.label.width];
};

/** 同じ列のラベルが縦に重ならず、ちがう列のラベルや柱とも横に重ならないこと */
function expectNoLabelOverlap(l: FlowLayout): void {
  const cols = new Map<number, LaidNode[]>();
  for (const n of l.nodes) cols.set(n.col, [...(cols.get(n.col) ?? []), n]);
  for (const nodes of cols.values()) {
    const ys = nodes.flatMap(n => (n.label ? [n.label.y] : [])).sort((a, b) => a - b);
    for (let i = 1; i < ys.length; i++) expect(ys[i]! - ys[i - 1]!).toBeGreaterThanOrEqual(LABEL_GAP - 1e-6);
    for (const y of ys) {
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(l.height);
    }
  }
  const spans = [...cols.entries()].map(([col, nodes]) => {
    const xs = nodes.flatMap(n => labelSpan(n) ?? []);
    return { col, min: Math.min(...xs), max: Math.max(...xs), bars: nodes.map(n => [n.x, n.x + n.w] as const) };
  });
  for (const a of spans) {
    for (const b of spans) {
      if (a.col >= b.col || !Number.isFinite(a.min) || !Number.isFinite(b.min)) continue;
      // 左の列のラベルは、右の列のラベルより手前で終わる
      expect(a.max).toBeLessThanOrEqual(b.min);
    }
    // ラベルは、ほかの列の柱にかからない
    for (const b of spans) {
      if (a.col === b.col || !Number.isFinite(a.min)) continue;
      for (const [x0, x1] of b.bars) expect(a.max <= x0 || a.min >= x1).toBe(true);
    }
  }
}

/** 帯の太さと柱の高さが、金額と同じ縮尺になっていること */
function expectTotalsPreserved(model: FlowModel, l: FlowLayout): void {
  expect(l.scale).toBeGreaterThan(0);
  expect(l.ribbons).toHaveLength(model.links.length);
  for (const c of model.cols) {
    for (const nd of c.nodes) {
      const n = byId(l, nd.id);
      // 柱の高さは金額に比例する（細すぎるものだけ 2px に底上げ）
      expect(n.h).toBeCloseTo(Math.max(nd.v * l.scale, 2), 6);
      const out = l.ribbons.filter(r => r.link.s === nd.id);
      const inn = l.ribbons.filter(r => r.link.t === nd.id);
      for (const side of [out, inn]) {
        if (!side.length) continue;
        // 出入りする帯の太さの合計 ＝ 帯の金額の合計 × 縮尺
        expect(sum(side.map(r => r.th))).toBeCloseTo(sum(side.map(r => r.link.v)) * l.scale, 6);
        // 帯は柱の中に、すきまなく上から積む
        const tops = side.map(r => (r.link.s === nd.id ? r.sy : r.ty)).sort((a, b) => a - b);
        expect(tops[0]).toBeCloseTo(n.y, 6);
        expect(sum(side.map(r => r.th))).toBeLessThanOrEqual(n.h + 0.05 * l.scale + 2);
      }
    }
  }
  // 列の中は、上から下へ重ならずに並ぶ
  for (let ci = 0; ci < model.cols.length; ci++) {
    const nodes = l.nodes.filter(n => n.col === ci).sort((a, b) => a.idx - b.idx);
    for (let i = 1; i < nodes.length; i++) expect(nodes[i]!.y).toBeGreaterThanOrEqual(nodes[i - 1]!.y + nodes[i - 1]!.h);
    for (const n of nodes) {
      expect(n.y).toBeGreaterThanOrEqual(0);
      expect(n.y + n.h).toBeLessThanOrEqual(l.height + 1e-6);
    }
  }
}

describe('流れ図の内容（モデル）', () => {
  it('全体：財源の合計と使いみちの合計が、どちらも総額と合う', () => {
    const [src, pool, use] = root.cols;
    expect(root.cols).toHaveLength(3);
    expect(sum(src!.nodes.map(n => n.v))).toBeCloseTo(budget.fy.total, 1);
    expect(sum(use!.nodes.map(n => n.v))).toBeCloseTo(budget.fy.total, 1);
    expect(pool!.nodes).toEqual([{ id: POOL_ID, name: '一般会計', v: budget.fy.total, kind: 'pool' }]);
    expect(root.links).toHaveLength(budget.src.length + budget.use.length);
    expect(sum(root.links.filter(l => l.t === POOL_ID).map(l => l.v))).toBeCloseTo(sum(budget.src.map(s => s.v)), 9);
    expect(sum(root.links.filter(l => l.s === POOL_ID).map(l => l.v))).toBeCloseTo(sum(budget.use.map(u => u.v)), 9);
  });

  it('全体：内訳のある使いみちだけ、押すと進める', () => {
    expect(findNode(root, 'social')?.drill).toBe(true);
    expect(findNode(root, 'debt')?.drill).toBe(false);
    expect(findNode(root, 'consumption')?.drill).toBeUndefined();
  });

  it('内訳：分野 → 内訳 → 届け先。届け先の金額は、届く帯の合計', () => {
    expect(social).not.toBeNull();
    const m = social!;
    expect(m.key).toBe('social');
    expect(m.cols.map(c => c.nodes.length)).toEqual([1, 7, 6]);
    const items = m.cols[1]!.nodes;
    expect(sum(items.map(n => n.v))).toBeCloseTo(39.06, 6);
    const recips = m.cols[2]!.nodes;
    expect(sum(recips.map(n => n.v))).toBeCloseTo(39.06, 6);
    for (const r of recips) expect(sum(m.links.filter(l => l.t === r.id).map(l => l.v))).toBeCloseTo(r.v, 9);
    // 届け先は、データに書かれた順（recips の順）
    expect(recips.map(n => n.name)).toEqual(['年金の受給者', '医療保険（病院への支払い）', '子育て世帯', '個人・世帯', '自治体', '事業者']);
    expect(findNode(m, recipNodeId('muni'))?.v).toBeCloseTo(3.1 + 3.8 + 0.9 + 0.3, 9);
  });

  it('内訳のない使いみち・知らないIDは null', () => {
    expect(drillModel(budget, 'debt')).toBeNull();
    expect(drillModel(budget, 'nothing')).toBeNull();
  });

  it('届け先のIDが内訳のIDと同じでも、別の項目として扱う。名前の登録がない届け先も落とさない', () => {
    const b: BudgetFile = {
      ...budget,
      recips: { x: '届け先X' },
      use: [{ id: 'u', name: '使いみち', long: '', v: 3, theme: 'other', desc: '', drill: { items: [{ id: 'x', name: '内訳X', v: 3, desc: '', to: { x: 2, y: 1 } }] } }]
    };
    const m = drillModel(b, 'u')!;
    expect(m.cols[1]!.nodes.map(n => n.id)).toEqual(['x']);
    expect(m.cols[2]!.nodes.map(n => [n.id, n.name, n.v])).toEqual([
      [recipNodeId('x'), '届け先X', 2],
      [recipNodeId('y'), 'y', 1]
    ]);
    const l = lay(m, 800);
    expect(l.nodes).toHaveLength(4);
    expect(l.ribbons).toHaveLength(3);
  });

  it('内訳のIDから、親の使いみちをさがせる', () => {
    expect(parentUseOf(budget, 'f-equip')?.id).toBe('defense');
    expect(parentUseOf(budget, 'social')).toBeNull();
  });
});

describe('流れ図の配置：全体（財源 → 一般会計 → 使いみち）', () => {
  it.each([1000, 640, 560, 480, 400, 332, 300, 260])('幅 %ipx：金額と形が合っている', width => {
    expectTotalsPreserved(root, lay(root, width));
    expectTotalsPreserved(root, lay(root, width, true));
  });

  it('幅 1000px：ラベルが重ならない。両端のラベルは図の外', () => {
    const l = lay(root, 1000);
    expect(l.outside).toBe(true);
    expect(l.narrow).toBe(false);
    expect(l.scrolled).toBe(false);
    expect(l.width).toBe(1000);
    expectNoLabelOverlap(l);
    // 財源のラベルは柱の左、使いみちのラベルは柱の右
    const src = byId(l, 'consumption');
    expect(src.side).toBe('L');
    expect(src.label).toMatchObject({ anchor: 'end', halo: false, name: '消費税', value: '26.7兆円' });
    expect(labelSpan(src)![1]).toBeLessThan(src.x);
    expect(labelSpan(src)![0]).toBeGreaterThanOrEqual(0);
    const use = byId(l, 'industry');
    expect(use.side).toBe('R');
    expect(use.label).toMatchObject({ anchor: 'start', halo: false, name: '産業・エネルギー', value: '2.2兆円' });
    expect(labelSpan(use)![0]).toBeGreaterThan(use.x + use.w);
    // 右端のラベルと「内訳に進める」しるしまで、幅に収まる
    for (const n of l.nodes.filter(x => x.col === 2)) expect(labelSpan(n)![1]).toBeLessThanOrEqual(l.width);
  });

  it('幅 300px：ラベルが重ならない。ラベルはすべて図の内側で、短い名前と「兆」を使う', () => {
    const l = lay(root, 300);
    expect(l.outside).toBe(false);
    expect(l.narrow).toBe(true);
    expect(l.scrolled).toBe(false);
    expect(l.width).toBe(300);
    expect(l.nodeW).toBe(8);
    expectNoLabelOverlap(l);
    const bond = byId(l, 'bond');
    expect(bond.side).toBe('R');
    expect(bond.label).toMatchObject({ anchor: 'start', halo: true, name: '国債', value: '29.6兆' });
    const industry = byId(l, 'industry');
    expect(industry.side).toBe('L');
    expect(industry.label).toMatchObject({ anchor: 'end', halo: true, name: '産業・エネ', value: '2.2兆' });
    // すべてのラベルが、図の幅の中にある
    for (const n of l.nodes) {
      const span = labelSpan(n);
      if (!span) continue;
      expect(span[0]).toBeGreaterThanOrEqual(0);
      expect(span[1]).toBeLessThanOrEqual(l.width);
    }
    expect(l.headers.map(h => h.text)).toEqual(['財源', '一般会計　122.3兆', '使いみち']);
  });

  it.each([1000, 760, 642, 560, 559, 480, 400, 399, 358, 332, 300])('幅 %ipx：ラベルが重ならない', width => {
    expectNoLabelOverlap(lay(root, width));
    expectNoLabelOverlap(lay(root, width, true));
  });

  it('同じ列のラベルは 15px 以上はなれる（細い項目が続くところは、ラベルを下へずらす）', () => {
    // スマホのホームに置く低めの図。教育・科学と産業・エネルギーの柱の中心は 15px より近い
    const l = lay(root, 300, true);
    const use = l.nodes.filter(n => n.col === 2 && n.label).sort((a, b) => a.label!.y - b.label!.y);
    const centers = use.map(n => n.y + n.h / 2);
    expect(Math.min(...centers.slice(1).map((c, i) => c - centers[i]!))).toBeLessThan(LABEL_GAP);
    const gaps = use.slice(1).map((n, i) => n.label!.y - use[i]!.label!.y);
    expect(Math.min(...gaps)).toBeCloseTo(LABEL_GAP, 6);
    // 細い柱（産業・エネルギー）のラベルは、柱の真横から下へずらしてある
    const industry = byId(l, 'industry');
    expect(industry.label!.y).toBeGreaterThan(industry.y + industry.h / 2);
    // ずらしても、押せる範囲は柱とラベルの両方をおおう
    expect(industry.hit.y).toBeLessThanOrEqual(industry.y);
    expect(industry.hit.y + industry.hit.h).toBeGreaterThanOrEqual(industry.label!.y + 11 - 1e-6);
  });

  it('一般会計の柱にはラベルを付けず、見出しに金額を出す', () => {
    const l = lay(root, 1000);
    expect(byId(l, POOL_ID).label).toBeNull();
    expect(l.headers.map(h => [h.text, h.anchor])).toEqual([
      ['財源（どこから）', 'end'],
      ['一般会計　122.3兆円', 'middle'],
      ['使いみち（どこへ）', 'start']
    ]);
  });

  it('「内訳に進める」しるしは、広い図の使いみち（内訳あり）にだけ付く', () => {
    const wide = lay(root, 1000);
    expect(wide.nodes.filter(n => n.chevron).map(n => n.node.id)).toEqual(['social', 'defense']);
    expect(byId(wide, 'social').chevron).toMatch(/^M991,[\d.]+l4,4l-4,4$/);
    expect(lay(root, 1000, true).nodes.some(n => n.chevron)).toBe(false);
    expect(lay(root, 300).nodes.some(n => n.chevron)).toBe(false);
  });

  it('高さ：ふつうの図は 440px（狭いと 400px）、低めの図は 310px（狭いと 290px）', () => {
    expect(lay(root, 1000).height).toBe(440);
    expect(lay(root, 479).height).toBe(400);
    expect(lay(root, 1000, true).height).toBe(310);
    expect(lay(root, 300, true).height).toBe(290);
  });

  it('列のあいだは 64px 以上。余った幅は、列のあいだに等しく配る', () => {
    const l = lay(root, 1000);
    const xs = [byId(l, 'consumption').x, byId(l, POOL_ID).x, byId(l, 'social').x];
    expect(xs[1]! - xs[0]! - l.nodeW).toBeGreaterThanOrEqual(64);
    expect(xs[1]! - xs[0]!).toBeCloseTo(xs[2]! - xs[1]!, 6);
    expect(l.need).toBeLessThanOrEqual(1000);
  });

  it('押せる範囲は、柱とラベルをおおう', () => {
    for (const width of [1000, 300]) {
      const l = lay(root, width);
      for (const n of l.nodes) {
        expect(n.hit.x).toBeLessThanOrEqual(n.x);
        expect(n.hit.x + n.hit.w).toBeGreaterThanOrEqual(n.x + n.w);
        expect(n.hit.y).toBeLessThanOrEqual(n.y);
        expect(n.hit.y + n.hit.h).toBeGreaterThanOrEqual(n.y + n.h - 1e-6);
        expect(n.hit.h).toBeGreaterThanOrEqual(22);
        const span = labelSpan(n);
        if (span) {
          expect(n.hit.x).toBeLessThanOrEqual(span[0]);
          expect(n.hit.x + n.hit.w).toBeGreaterThanOrEqual(span[1]);
          expect(n.hit.y).toBeLessThanOrEqual(n.label!.y - 11 + 1e-6);
          expect(n.hit.y + n.hit.h).toBeGreaterThanOrEqual(n.label!.y + 11 - 1e-6);
        }
      }
    }
  });

  it('単位を変えると、ラベルの金額と必要な幅が変わる', () => {
    const cho = layoutFlow(root, 1000, { fmt: fmtCho });
    const pc = layoutFlow(root, 1000, { fmt: fmt.pc });
    expect(byId(pc, 'social').label!.value).toBe('約31.9万円');
    expect(pc.need).toBeGreaterThan(cho.need);
    expectNoLabelOverlap(pc);
    expectNoLabelOverlap(layoutFlow(root, 300, { fmt: fmt.man }));
  });

  it('幅が 260px より狭くても、260px として配置する', () => {
    const l = lay(root, 120);
    expect(l.available).toBe(260);
    expect(l.scrolled).toBe(true);
    expect(l.width).toBe(l.need);
    expectNoLabelOverlap(l);
  });
});

describe('流れ図の配置：内訳（分野 → 内訳 → 届け先）', () => {
  it('幅 300px：入りきらないので、横スクロールにする', () => {
    const l = lay(social!, 300);
    expect(l.scrolled).toBe(true);
    expect(l.need).toBeGreaterThan(300 + 8);
    expect(l.width).toBe(l.need);
    expect(l.outside).toBe(false);
    expectNoLabelOverlap(l);
    expectTotalsPreserved(social!, l);
    // 必要な幅で描けば、ラベルはすべて図の中に収まる
    for (const n of l.nodes) {
      const span = labelSpan(n);
      if (!span) continue;
      expect(span[0]).toBeGreaterThanOrEqual(0);
      expect(span[1]).toBeLessThanOrEqual(l.width);
    }
  });

  it('幅 300px：防衛の内訳も、横スクロールにする', () => {
    const l = lay(defense!, 300, true);
    expect(l.scrolled).toBe(true);
    expectNoLabelOverlap(l);
    expectTotalsPreserved(defense!, l);
  });

  it('幅 1000px：横スクロールなしで入る。内訳のラベルは柱の右に、ふち付きで置く', () => {
    const l = lay(social!, 1000);
    expect(l.scrolled).toBe(false);
    expect(l.outside).toBe(true);
    expectNoLabelOverlap(l);
    expectTotalsPreserved(social!, l);
    expect(byId(l, 'social').side).toBe('L');
    expect(byId(l, 's-pension').label).toMatchObject({ anchor: 'start', halo: true });
    expect(byId(l, recipNodeId('elder')).label).toMatchObject({ anchor: 'start', halo: false });
    expect(l.nodes.some(n => n.chevron)).toBe(false);
  });

  it('入りきるぎりぎりの幅（必要な幅 − 8px）までは、横スクロールにしない', () => {
    const need = lay(social!, 1000).need;
    expect(need).toBeGreaterThanOrEqual(560);
    expect(lay(social!, need - 8).scrolled).toBe(false);
    expect(lay(social!, need - 9).scrolled).toBe(true);
  });

  it('項目の多い列に合わせて、高さを足す（1項目あたり 27px）', () => {
    const many: FlowModel = {
      key: 'x',
      cols: [
        { title: 'A', nodes: [{ id: 'a', name: 'A', v: 20, kind: 'use' }] },
        { title: 'B', nodes: Array.from({ length: 20 }, (_, i) => ({ id: `b${i}`, name: `項目${i}`, v: 1, kind: 'item' as const })) }
      ],
      links: Array.from({ length: 20 }, (_, i) => ({ s: 'a', t: `b${i}`, v: 1, c: null }))
    };
    const l = lay(many, 800);
    expect(l.height).toBe(26 + 8 + 20 * 27);
    expectNoLabelOverlap(l);
    expectTotalsPreserved(many, l);
  });

  it('空の列や、行き先のない帯があっても止まらない', () => {
    const odd: FlowModel = {
      key: 'x',
      cols: [
        { title: 'A', nodes: [{ id: 'a', name: 'A', v: 2, kind: 'use' }] },
        { title: '空', nodes: [] },
        { title: 'B', nodes: [{ id: 'b', name: 'B', v: 2, kind: 'recip' }] }
      ],
      links: [
        { s: 'a', t: 'b', v: 2, c: null },
        { s: 'a', t: 'ない', v: 1, c: null }
      ]
    };
    const l = lay(odd, 600);
    expect(l.nodes.map(n => n.node.id)).toEqual(['a', 'b']);
    expect(l.ribbons).toHaveLength(1);
    expect(lay({ key: 'x', cols: [], links: [] }, 600).nodes).toEqual([]);
  });
});

describe('流れ図の部品', () => {
  it('帯の形：太い帯は上下に 0.75px のすきま、細い帯は 0.8px を下回らない', () => {
    expect(ribbonPath(10, 20, 110, 40, 10)).toBe('M10.0,20.8C60.0,20.8 60.0,40.8 110.0,40.8L110.0,49.3C60.0,49.3 60.0,29.3 10.0,29.3Z');
    expect(ribbonPath(0, 0, 100, 0, 0.1)).toBe('M0.0,0.0C50.0,0.0 50.0,0.0 100.0,0.0L100.0,0.8C50.0,0.8 50.0,0.8 0.0,0.8Z');
  });

  it('ラベルを上から 15px ずつはなし、下にはみ出したら下から詰め直す', () => {
    const a = [{ y: 10 }, { y: 12 }, { y: 14 }];
    spreadLabels(a, 15, 0, 100);
    expect(a.map(l => l.y)).toEqual([10, 25, 40]);
    const b = [{ y: 80 }, { y: 82 }, { y: 84 }];
    spreadLabels(b, 15, 0, 100);
    expect(b.map(l => l.y)).toEqual([70, 85, 100]);
    const c = [{ y: 50 }, { y: -5 }];
    spreadLabels(c, 15, 6, 100);
    expect(c.map(l => l.y)).toEqual([6, 50]);
    const none: { y: number }[] = [];
    spreadLabels(none, 15, 0, 100);
    expect(none).toEqual([]);
  });

  it('えらんだ項目の近く（つながる帯と、となりの項目）', () => {
    const l = lay(root, 1000);
    const near = neighborhood(l, 'social');
    expect([...near.nodes].sort()).toEqual([POOL_ID, 'social'].sort());
    expect(near.ribbons.size).toBe(1);
    const pool = neighborhood(l, POOL_ID);
    expect(pool.nodes.size).toBe(1 + budget.src.length + budget.use.length);
    expect(pool.ribbons.size).toBe(l.ribbons.length);
  });
});

describe('実際のデータ（yukue/data/budget/fy2026.json）', () => {
  const file = fileURLToPath(new URL('../../../data/budget/fy2026.json', import.meta.url));
  const real = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as BudgetFile) : null;

  it.skipIf(!real)('全体の図：幅 1000px と 300px でラベルが重ならず、金額と形が合う', () => {
    const m = rootModel(real!);
    for (const width of [1000, 300]) {
      const l = lay(m, width);
      expect(l.scrolled).toBe(false);
      expectNoLabelOverlap(l);
      expectTotalsPreserved(m, l);
    }
  });

  it.skipIf(!real)('内訳の図：どの使いみちも、幅 300px では横スクロールになる', () => {
    for (const u of real!.use) {
      const m = drillModel(real!, u.id);
      if (!m) continue;
      const narrow = lay(m, 300);
      expect(narrow.scrolled).toBe(true);
      expectNoLabelOverlap(narrow);
      expectTotalsPreserved(m, narrow);
      expectNoLabelOverlap(lay(m, 1000));
    }
  });
});
