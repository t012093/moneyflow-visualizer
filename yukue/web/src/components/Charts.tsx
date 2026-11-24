/** 小さな図：10年の推移（折れ線）と、タイルの中の線。 */
import { useState, type PointerEvent } from 'react';
import { n1 } from '../lib/format.ts';
import { hideTip, showTip } from './tip.ts';

interface TrendProps {
  values: readonly number[];
  years: readonly number[];
  /** CSS の色（var(--t1) など） */
  color: string;
  unit: string;
}

/** 推移の折れ線。ポインターを合わせると、その年度の値を出す */
export function TrendChart({ values, years, color, unit }: TrendProps) {
  const [at, setAt] = useState<number | null>(null);
  const n = values.length;
  const first = values[0];
  const last = values[n - 1];
  if (n < 2 || first == null || last == null) return null;
  const W = 288;
  const H = 96;
  const l = 5;
  const r = 5;
  const t = 22;
  const b = 18;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const lo = min - span * 0.18;
  const hi = max + span * 0.08;
  const X = (i: number): number => l + ((W - l - r) * i) / (n - 1);
  const Y = (v: number): number => t + (H - t - b) * (1 - (v - lo) / (hi - lo));
  const d = values.map((v, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ',' + Y(v).toFixed(1)).join('');
  const yearOf = (i: number): string => (years[i] != null ? `${years[i]}年度` : '');
  const cur = at ?? n - 1;
  const curV = values[cur] ?? last;

  const move = (e: PointerEvent<SVGRectElement>): void => {
    const svg = e.currentTarget.ownerSVGElement;
    if (!svg) return;
    const bb = svg.getBoundingClientRect();
    const i = Math.max(0, Math.min(n - 1, Math.round(((((e.clientX - bb.left) / bb.width) * W - l) / (W - l - r)) * (n - 1))));
    setAt(i);
    showTip(e, n1(values[i] ?? last) + unit, `${yearOf(i)}（当初予算）`);
  };
  const leave = (): void => {
    setAt(null);
    hideTip();
  };

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="trend"
      role="img"
      aria-label={`${yearOf(0)} ${first}${unit} から ${yearOf(n - 1)} ${last}${unit} への推移`}
    >
      <line x1={l} x2={W - r} y1={H - b} y2={H - b} style={{ stroke: 'var(--line-2)' }} strokeWidth={1} />
      <path d={`${d}L${X(n - 1).toFixed(1)},${H - b}L${X(0).toFixed(1)},${H - b}Z`} style={{ fill: color }} fillOpacity={0.1} />
      <path d={d} fill="none" style={{ stroke: color }} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <line
        x1={X(cur)}
        x2={X(cur)}
        y1={t - 4}
        y2={H - b}
        style={{ stroke: 'var(--ink-3)' }}
        strokeWidth={1}
        visibility={at == null ? 'hidden' : 'visible'}
      />
      <text x={l} y={Y(first) - 8} textAnchor="start">
        {n1(first)}
      </text>
      <text className="tv" x={W - r} y={Y(last) - 10} textAnchor="end">
        {n1(last) + unit}
      </text>
      <text x={l} y={H - 4} textAnchor="start">
        {yearOf(0)}
      </text>
      <text x={W - r} y={H - 4} textAnchor="end">
        {yearOf(n - 1)}
      </text>
      <circle r={4} style={{ fill: color, stroke: 'var(--surface)' }} strokeWidth={2} cx={X(cur)} cy={Y(curV)} />
      <rect x={0} y={0} width={W} height={H} fill="transparent" onPointerMove={move} onPointerDown={move} onPointerLeave={leave} />
    </svg>
  );
}

/** タイルの中の小さな線 */
export function Sparkline({ values }: { values: readonly number[] }) {
  const n = values.length;
  const last = values[n - 1];
  if (n < 2 || last == null) return null;
  const W = 200;
  const H = 36;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const X = (i: number): number => 4 + ((W - 8) * i) / (n - 1);
  const Y = (v: number): number => 5 + (H - 10) * (1 - (v - min) / span);
  const d = values.map((v, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ',' + Y(v).toFixed(1)).join('');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="spark" preserveAspectRatio="none" aria-hidden="true">
      <path
        d={d}
        fill="none"
        style={{ stroke: 'var(--ink-3)' }}
        strokeWidth={1.6}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={X(n - 1)} cy={Y(last)} r={3.5} style={{ fill: 'var(--accent)', stroke: 'var(--surface)' }} strokeWidth={1.5} />
    </svg>
  );
}
