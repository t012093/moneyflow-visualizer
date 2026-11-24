/**
 * 流れ図（層になったサンキー図）の配置を計算する。
 * DOM には触れない純粋な関数で、入力（図の内容・入れ物の幅・オプション）から、
 * 項目の四角、帯の形、ラベルの位置、横スクロールが要るかどうかを返す。
 *
 * 決まりはプロトタイプ（design/yukue-sample/index.html の renderFlow）と同じ：
 * ・幅が 560px 以上なら、両端の列のラベルは図の外に置く。それより狭ければ、すべて図の内側に置く
 * ・列のあいだの幅は、内側に置くラベルの長さから決める（最低 64px）
 * ・必要な幅が入れ物の幅 + 8px を超えたら、図は必要な幅で描き、横スクロールにする
 * ・400px より狭いときは、短い名前と「兆」を使う
 * ・同じ列のラベルは、15px 以上はなして重ならないようにする
 */
import { textWidth } from './format.ts';
import type { FlowLink, FlowModel, FlowNode } from './flowModel.ts';

export interface LayoutOptions {
  /** 金額の書き方（単位の切り替えで変わる） */
  fmt: (v: number) => string;
  /** ホームや会話の中に置く、低めの図 */
  compact?: boolean;
  /** 文字幅の見積もり。指定しなければ textWidth */
  measure?: (s: string, fontSize?: number) => number;
}

export type Side = 'L' | 'R';
export type Anchor = 'start' | 'middle' | 'end';

export interface LaidLabel {
  /** 文字の基準点（text の x） */
  x: number;
  /** ラベルの中心の高さ。text の y は、これに 4 を足す */
  y: number;
  anchor: 'start' | 'end';
  name: string;
  value: string;
  /** 見積もった幅（名前 + すきま 7px + 金額） */
  width: number;
  /** 帯の上に重なるので、文字にふちを付ける */
  halo: boolean;
}

export interface LaidNode {
  node: FlowNode;
  col: number;
  idx: number;
  x: number;
  y: number;
  w: number;
  h: number;
  side: Side;
  /** 一般会計の柱にはラベルがない */
  label: LaidLabel | null;
  /** 押せる範囲（四角とラベルをおおう） */
  hit: { x: number; y: number; w: number; h: number };
  /** 「内訳に進める」しるしの path。なければ null */
  chevron: string | null;
}

export interface LaidRibbon {
  link: FlowLink;
  /** model.links での位置 */
  index: number;
  /** 太さ */
  th: number;
  /** 出どころ側・行き先側の上端 */
  sy: number;
  ty: number;
  d: string;
}

export interface LaidHeader {
  col: number;
  x: number;
  y: number;
  anchor: Anchor;
  text: string;
}

export interface FlowLayout {
  /** viewBox の幅と高さ */
  width: number;
  height: number;
  /** 計算に使った入れ物の幅（260px を下回らない） */
  available: number;
  /** ラベルまで入れるのに必要な幅 */
  need: number;
  /** 入れ物に入りきらず、図だけ横スクロールにする */
  scrolled: boolean;
  /** 両端のラベルを図の外に置いている */
  outside: boolean;
  /** 短い名前を使っている */
  narrow: boolean;
  nodeW: number;
  /** 1兆円あたりの高さ（px） */
  scale: number;
  nodes: LaidNode[];
  ribbons: LaidRibbon[];
  headers: LaidHeader[];
}

export const MIN_WIDTH = 260;
export const LABEL_GAP = 15;
const TOP = 26;
const BOTTOM = 8;

/** 帯の形。太さが 4px を超える帯は、上下に 0.75px のすきまを空ける */
export function ribbonPath(xa: number, ya: number, xb: number, yb: number, th: number): string {
  const g = th > 4 ? 0.75 : 0;
  const t = Math.max(th - 2 * g, 0.8);
  const y0 = ya + g;
  const y1 = yb + g;
  const mx = (xa + xb) / 2;
  const f = (n: number): string => n.toFixed(1);
  return `M${f(xa)},${f(y0)}C${f(mx)},${f(y0)} ${f(mx)},${f(y1)} ${f(xb)},${f(y1)}L${f(xb)},${f(y1 + t)}C${f(mx)},${f(y1 + t)} ${f(mx)},${f(y0 + t)} ${f(xa)},${f(y0 + t)}Z`;
}

/** ラベルを上から順に minGap 以上はなす。下にはみ出したら、下から詰め直す */
export function spreadLabels<T extends { y: number }>(labs: T[], minGap: number, lo: number, hi: number): void {
  labs.sort((a, b) => a.y - b.y);
  for (let i = 1; i < labs.length; i++) {
    const cur = labs[i];
    const prev = labs[i - 1];
    if (cur && prev && cur.y - prev.y < minGap) cur.y = prev.y + minGap;
  }
  const last = labs[labs.length - 1];
  if (last && last.y > hi) {
    last.y = hi;
    for (let i = labs.length - 2; i >= 0; i--) {
      const cur = labs[i];
      const next = labs[i + 1];
      if (cur && next && next.y - cur.y < minGap) cur.y = next.y - minGap;
    }
  }
  const first = labs[0];
  if (first && first.y < lo) first.y = lo;
}

interface Pos {
  x: number;
  y: number;
  h: number;
  col: number;
  idx: number;
}

export function layoutFlow(model: FlowModel, containerWidth: number, options: LayoutOptions): FlowLayout {
  const f = options.fmt;
  const tw = options.measure ?? textWidth;
  const W0 = Math.max(Math.round(containerWidth), MIN_WIDTH);
  const outside = W0 >= 560;
  const narrow = W0 < 400;
  const nodeW = W0 < 480 ? 8 : 10;
  const cols = model.cols.filter(c => c.nodes.length > 0);
  const nc = cols.length;
  const base = options.compact ? (W0 < 480 ? 290 : 310) : W0 < 480 ? 400 : 440;
  const maxN = Math.max(1, ...cols.map(c => c.nodes.length));
  const height = Math.max(base, TOP + BOTTOM + maxN * 27);
  const innerH = height - TOP - BOTTOM;

  const firstCol = cols[0];
  const lastCol = cols[nc - 1];
  if (!firstCol || !lastCol) {
    return { width: W0, height, available: W0, need: 0, scrolled: false, outside, narrow, nodeW, scale: 0, nodes: [], ribbons: [], headers: [] };
  }

  const padY = Math.max(6, Math.min(16, (innerH * 0.2) / Math.max(1, maxN - 1)));
  const nm = (nd: FlowNode): string => (narrow && nd.short) || nd.name;
  const val = (nd: FlowNode): string => (narrow ? f(nd.v).replace('兆円', '兆') : f(nd.v));
  const labW = (nd: FlowNode): number => (nd.kind === 'pool' ? 0 : tw(nm(nd)) + 7 + tw(val(nd)));
  const maxLab = (c: { nodes: FlowNode[] }): number => Math.max(0, ...c.nodes.map(labW));

  /* ラベルの置き場所：幅があれば両端は図の外、中の列は右側。狭いときは全部を図の内側に置く */
  const sideOf = (ci: number): Side => (outside ? (ci === 0 && nc > 1 ? 'L' : 'R') : ci === nc - 1 && nc > 1 ? 'L' : 'R');
  const chev = outside && !options.compact && lastCol.nodes.some(n => n.drill);
  const mL = outside ? maxLab(firstCol) + 14 : 1;
  const mR = outside ? maxLab(lastCol) + 14 + (chev ? 16 : 0) : 1;
  const gaps: number[] = [];
  for (let i = 0; i < nc - 1; i++) {
    const ca = cols[i];
    const cb = cols[i + 1];
    const a = ca && sideOf(i) === 'R' ? maxLab(ca) : 0;
    const b = cb && sideOf(i + 1) === 'L' ? maxLab(cb) : 0;
    gaps.push(Math.max(64, (a ? a + 18 : 0) + (b ? b + 18 : 0)));
  }
  const need = Math.ceil(mL + mR + nodeW * nc + gaps.reduce((x, y) => x + y, 0));
  const scrolled = need > W0 + 8;
  const width = scrolled ? need : W0;
  const extra = Math.max(0, width - need) / Math.max(1, nc - 1);
  const xs: number[] = [mL];
  for (let i = 0; i < nc - 1; i++) xs.push((xs[i] ?? mL) + nodeW + (gaps[i] ?? 64) + extra);

  /* 高さの縮尺は、いちばん詰まる列に合わせる */
  let ky = Infinity;
  for (const c of cols) {
    const sum = c.nodes.reduce((a, b) => a + b.v, 0);
    if (sum > 0) ky = Math.min(ky, (innerH - padY * (c.nodes.length - 1)) / sum);
  }
  if (!Number.isFinite(ky) || ky < 0) ky = 0;

  const pos = new Map<string, Pos>();
  cols.forEach((c, i) => {
    const x = xs[i] ?? mL;
    const hs = c.nodes.map(nd => Math.max(nd.v * ky, 2));
    const used = hs.reduce((a, b) => a + b, 0) + padY * (c.nodes.length - 1);
    let y = TOP + (innerH - used) / 2;
    c.nodes.forEach((nd, j) => {
      const h = hs[j] ?? 2;
      pos.set(nd.id, { x, y, h, col: i, idx: j });
      y += h + padY;
    });
  });

  /* 帯：出どころ・行き先それぞれで、相手の並び順に積む */
  interface Band {
    link: FlowLink;
    index: number;
    th: number;
    sy: number;
    ty: number;
  }
  const bands: Band[] = [];
  model.links.forEach((link, index) => {
    if (pos.has(link.s) && pos.has(link.t)) bands.push({ link, index, th: link.v * ky, sy: 0, ty: 0 });
  });
  const out = new Map<string, Band[]>();
  const inn = new Map<string, Band[]>();
  const push = (map: Map<string, Band[]>, key: string, band: Band): void => {
    const list = map.get(key);
    if (list) list.push(band);
    else map.set(key, [band]);
  };
  for (const b of bands) {
    push(out, b.link.s, b);
    push(inn, b.link.t, b);
  }
  const idxOf = (id: string): number => pos.get(id)?.idx ?? 0;
  for (const [id, list] of out) {
    list.sort((a, b) => idxOf(a.link.t) - idxOf(b.link.t));
    let off = 0;
    const y = pos.get(id)?.y ?? 0;
    for (const b of list) {
      b.sy = y + off;
      off += b.th;
    }
  }
  for (const [id, list] of inn) {
    list.sort((a, b) => idxOf(a.link.s) - idxOf(b.link.s));
    let off = 0;
    const y = pos.get(id)?.y ?? 0;
    for (const b of list) {
      b.ty = y + off;
      off += b.th;
    }
  }
  const ribbons: LaidRibbon[] = bands.map(b => {
    const a = pos.get(b.link.s);
    const z = pos.get(b.link.t);
    const d = a && z ? ribbonPath(a.x + nodeW + 1, b.sy, z.x - 1, b.ty, b.th) : '';
    return { link: b.link, index: b.index, th: b.th, sy: b.sy, ty: b.ty, d };
  });

  const headers: LaidHeader[] = [];
  const nodes: LaidNode[] = [];
  cols.forEach((c, ci) => {
    const isFirst = ci === 0;
    const isLast = ci === nc - 1;
    const head = c.nodes[0];
    const p0 = head && pos.get(head.id);
    if (!head || !p0) return;
    let hx: number;
    let anchor: Anchor;
    if (isFirst && nc > 1) {
      hx = outside ? p0.x + nodeW : p0.x;
      anchor = outside ? 'end' : 'start';
    } else if (isLast) {
      hx = outside ? p0.x : p0.x + nodeW;
      anchor = outside ? 'start' : 'end';
    } else {
      hx = p0.x + nodeW / 2;
      anchor = 'middle';
    }
    headers.push({
      col: ci,
      x: hx,
      y: 12,
      anchor,
      text: ((narrow && c.titleShort) || c.title) + (c.showValue ? '　' + val(head) : '')
    });

    const side = sideOf(ci);
    const halo = !outside || (!isFirst && !isLast);
    const labs: { id: string; y: number }[] = [];
    for (const nd of c.nodes) {
      const p = pos.get(nd.id);
      if (p && nd.kind !== 'pool') labs.push({ id: nd.id, y: p.y + p.h / 2 });
    }
    spreadLabels(labs, LABEL_GAP, TOP + 6, height - 6);
    const labelY = new Map(labs.map(l => [l.id, l.y]));

    for (const nd of c.nodes) {
      const p = pos.get(nd.id);
      if (!p) continue;
      const isPool = nd.kind === 'pool';
      const lw = isPool ? 0 : labW(nd);
      const y = labelY.get(nd.id) ?? p.y + p.h / 2;
      const hitH = Math.max(p.h, 22);
      const hitY = Math.min(p.y, y - 11);
      const hitX = side === 'L' ? p.x - lw - 10 : p.x - 6;
      nodes.push({
        node: nd,
        col: ci,
        idx: p.idx,
        x: p.x,
        y: p.y,
        w: nodeW,
        h: p.h,
        side,
        label: isPool
          ? null
          : {
              x: side === 'L' ? p.x - 8 : p.x + nodeW + 8,
              y,
              anchor: side === 'L' ? 'end' : 'start',
              name: nm(nd),
              value: val(nd),
              width: lw,
              halo
            },
        hit: { x: hitX, y: hitY, w: lw + nodeW + 18, h: Math.max(hitH, y + 11 - hitY) },
        chevron: chev && nd.drill && !isPool ? `M${width - 9},${(y - 4).toFixed(1)}l4,4l-4,4` : null
      });
    }
  });

  return { width, height, available: W0, need, scrolled, outside, narrow, nodeW, scale: ky, nodes, ribbons, headers };
}

/** 押した項目と、そこにつながる帯・となりの項目（強調して見せる範囲） */
export function neighborhood(layout: FlowLayout, nodeId: string): { nodes: Set<string>; ribbons: Set<number> } {
  const nodes = new Set<string>([nodeId]);
  const ribbons = new Set<number>();
  for (const r of layout.ribbons) {
    if (r.link.s === nodeId || r.link.t === nodeId) {
      ribbons.add(r.index);
      nodes.add(r.link.s);
      nodes.add(r.link.t);
    }
  }
  return { nodes, ribbons };
}
