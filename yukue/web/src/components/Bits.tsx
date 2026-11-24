/** あちこちで使う小さな部品。 */
import type { ReactNode } from 'react';
import { isHttps } from '../lib/updates.ts';
import type { SourceLink, Stage } from '../types.ts';
import { Ic } from './Icons.tsx';

/** 分野の色の丸 */
export function Dot({ color }: { color: string }) {
  return <span className="dot" style={{ background: color }} />;
}

/** 外のページへのリンク。https:// で始まるものだけを出す（#:~:text= の付いたURLも、そのまま使う） */
export function SrcLink({ link }: { link: SourceLink }) {
  if (!isHttps(link.url)) return null;
  return (
    <a className="srcl" href={link.url} target="_blank" rel="noopener">
      {link.name}
      <Ic name="ext" />
    </a>
  );
}

/** 一次情報などのリンクの並び。出せるリンクが無ければ何も出さない */
export function SrcLinks({ links }: { links: readonly SourceLink[] }) {
  const ok = links.filter(l => isHttps(l.url));
  if (!ok.length) return null;
  return (
    <>
      {ok.map((l, i) => (
        <SrcLink key={`${i}:${l.url}`} link={l} />
      ))}
    </>
  );
}

/** 段階の小さな目盛り（過ぎた段階・いまの段階・これから） */
export function Steps({ stage }: { stage: Stage }) {
  return (
    <span className="steps" aria-hidden="true">
      {stage.steps.map((_, i) => (
        <i key={i} className={i < stage.index ? 'on' : i === stage.index ? 'cur' : undefined} />
      ))}
    </span>
  );
}

/** 押すと切り替わる丸いボタン（絞り込み・選択肢） */
export function Chip(props: { pressed?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button className="chip" type="button" aria-pressed={props.pressed} onClick={props.onClick}>
      {props.children}
    </button>
  );
}

/** 横に並んだ切り替え（単位、表示、制度の一覧） */
export function Seg<T extends string>(props: {
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (v: T) => void;
  labelledBy?: string;
  label?: string;
  /** 狭い画面で入りきらないときに、折り返してよいか */
  wrap?: boolean;
}) {
  return (
    <div className={props.wrap ? 'seg wrap' : 'seg'} role="group" aria-labelledby={props.labelledBy} aria-label={props.label}>
      {props.options.map(([v, text]) => (
        <button key={v} type="button" aria-pressed={props.value === v} onClick={() => props.onChange(v)}>
          {text}
        </button>
      ))}
    </div>
  );
}
