/**
 * 流れ図。配置は lib/flowLayout.ts が計算し、ここでは SVG として描く。
 * 色は CSS の変数で決まるので、SVG の属性ではなく style で指定する（属性では変数が効かない）。
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { layoutFlow, neighborhood } from '../lib/flowLayout.ts';
import type { FlowModel, FlowNode } from '../lib/flowModel.ts';
import type { ThemeId } from '../types.ts';
import { hideTip, showTip } from './Tip.tsx';

export interface FlowDiagramProps {
  model: FlowModel;
  /** 金額の書き方（単位の切り替えで変わる） */
  fmt: (v: number) => string;
  /** 全体に占める割合 */
  pct: (v: number) => string;
  themeVar: (theme: ThemeId) => string;
  /** 図の説明（読み上げ用） */
  label: string;
  /** ホームや会話の中に置く、低めの図 */
  compact?: boolean;
  /** えらんでいる項目 */
  sel?: string | null;
  onSelect?: (node: FlowNode) => void;
  /** 入りきらずに横スクロールになったかどうかを知らせる */
  onScrolledChange?: (scrolled: boolean) => void;
}

type Highlight = { kind: 'node'; id: string } | { kind: 'ribbon'; index: number } | null;

/** 入れ物の幅をはかる。3px を超えて変わったときだけ、図を配置し直す */
function useBoxWidth(ref: RefObject<HTMLDivElement | null>): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let frame = 0;
    const measure = (): void => {
      const w = el.clientWidth;
      if (w > 0) setWidth(old => (Math.abs(w - old) > 3 ? w : old));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [ref]);
  return width;
}

export function FlowDiagram({ model, fmt, pct, themeVar, label, compact, sel, onSelect, onScrolledChange }: FlowDiagramProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const width = useBoxWidth(boxRef);
  const layout = useMemo(() => (width > 0 ? layoutFlow(model, width, { fmt, compact }) : null), [model, width, fmt, compact]);
  const [hi, setHi] = useState<Highlight>(null);

  // 図の中身が入れ替わったら、もう無い項目の強調は外す
  useEffect(() => {
    setHi(h => (h && h.kind === 'node' && model.cols.some(c => c.nodes.some(n => n.id === h.id)) ? h : null));
  }, [model]);

  const scrolled = !!layout?.scrolled;
  useEffect(() => {
    onScrolledChange?.(scrolled);
  }, [scrolled, onScrolledChange]);

  const lit = useMemo(() => {
    if (!layout || !hi) return null;
    if (hi.kind === 'node') return neighborhood(layout, hi.id);
    const r = layout.ribbons.find(x => x.index === hi.index);
    return r ? { nodes: new Set([r.link.s, r.link.t]), ribbons: new Set([r.index]) } : null;
  }, [layout, hi]);

  const nameOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of model.cols) for (const n of c.nodes) m.set(n.id, n.name);
    return (id: string): string => m.get(id) ?? id;
  }, [model]);

  // ポインターが乗っているあいだは強調する（図が入れ替わった直後は enter が来ないので、move でも確かめる）
  const lightNode = (id: string): void => setHi(h => (h && h.kind === 'node' && h.id === id ? h : { kind: 'node', id }));
  const lightRibbon = (index: number): void => setHi(h => (h && h.kind === 'ribbon' && h.index === index ? h : { kind: 'ribbon', index }));

  const pick = (node: FlowNode): void => {
    hideTip();
    onSelect?.(node);
  };
  const onKey = (e: KeyboardEvent, node: FlowNode): void => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      pick(node);
    }
  };

  return (
    <div className="flow-box" ref={boxRef}>
      {layout && (
        // 入りきらないときは、図だけを必要な幅で描く（外側の .flow-scroll が横スクロールになる）
        <div style={layout.scrolled ? { minWidth: layout.width } : undefined}>
          <svg
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            className={'fl' + (lit ? ' has-hi' : '')}
            role="group"
            aria-label={label}
          >
            <g>
              {layout.ribbons.map(r => (
                <path
                  key={r.index}
                  d={r.d}
                  className={
                    'rib' +
                    (r.link.c ? '' : ' n') +
                    (sel && (r.link.s === sel || r.link.t === sel) ? ' sel' : '') +
                    (lit?.ribbons.has(r.index) ? ' hi' : '')
                  }
                  style={{ fill: r.link.c ? themeVar(r.link.c) : 'var(--flow-neutral)' }}
                  onPointerEnter={() => lightRibbon(r.index)}
                  onPointerMove={e => {
                    lightRibbon(r.index);
                    showTip(e, fmt(r.link.v), `${nameOf(r.link.s)} → ${nameOf(r.link.t)}`);
                  }}
                  onPointerLeave={() => {
                    setHi(null);
                    hideTip();
                  }}
                />
              ))}
            </g>
            <g>
              {layout.headers.map(h => (
                <text key={`h${h.col}`} className="colh" x={h.x.toFixed(1)} y={h.y} textAnchor={h.anchor}>
                  {h.text}
                </text>
              ))}
              {layout.nodes.map(n => {
                const nd = n.node;
                const isPool = nd.kind === 'pool';
                const fill = isPool ? 'var(--flow-pool)' : nd.theme ? themeVar(nd.theme) : 'var(--flow-neutral)';
                const tipSub = isPool ? `${nd.name}（財源の合計）` : `${nd.name} ・ 全体の${pct(nd.v)}`;
                return (
                  <g
                    key={nd.id}
                    className={'nd' + (sel === nd.id ? ' sel' : '') + (lit?.nodes.has(nd.id) ? ' hi' : '')}
                    tabIndex={0}
                    role={onSelect ? 'button' : 'img'}
                    aria-label={`${nd.name} ${fmt(nd.v)}（全体の${pct(nd.v)}）`}
                    onPointerEnter={() => lightNode(nd.id)}
                    onPointerMove={e => {
                      lightNode(nd.id);
                      showTip(e, fmt(nd.v), tipSub);
                    }}
                    onPointerLeave={() => {
                      setHi(null);
                      hideTip();
                    }}
                    onFocus={() => lightNode(nd.id)}
                    onBlur={() => setHi(null)}
                    onClick={() => pick(nd)}
                    onKeyDown={e => onKey(e, nd)}
                  >
                    <rect
                      className="hit"
                      x={n.hit.x.toFixed(1)}
                      y={n.hit.y.toFixed(1)}
                      width={n.hit.w.toFixed(1)}
                      height={n.hit.h.toFixed(1)}
                    />
                    <rect className="bar" x={n.x.toFixed(1)} y={n.y.toFixed(1)} width={n.w} height={n.h.toFixed(1)} rx={2} style={{ fill }} />
                    {n.label && (
                      <text
                        className={'lab' + (n.label.halo ? ' halo' : '')}
                        x={n.label.x.toFixed(1)}
                        y={(n.label.y + 4).toFixed(1)}
                        textAnchor={n.label.anchor}
                      >
                        <tspan className="ln">{n.label.name}</tspan>
                        <tspan className="lv" dx={7}>
                          {n.label.value}
                        </tspan>
                      </text>
                    )}
                    {n.chevron && <path className="more" d={n.chevron} />}
                  </g>
                );
              })}
            </g>
          </svg>
        </div>
      )}
    </div>
  );
}
