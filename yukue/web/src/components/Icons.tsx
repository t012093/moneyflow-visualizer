/** 線のアイコン。プロトタイプと同じ形を、ページに1つ置いた <symbol> から <use> で使う。 */
import type { ReactElement } from 'react';

const PATHS = {
  home: <path d="M4 11.2 12 4.5l8 6.7v8.3h-5.5V14h-5v5.5H4z" />,
  flow: <path d="M3 6.5h3.5c4.5 0 4.5 5.5 9 5.5H21M3 17.5h3.5c4.5 0 4.5-5.5 9-5.5M3 12h5" />,
  pulse: <path d="M3 12h4l2.5-6 4 12 2.5-6H21" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4.5 4.5" />
    </>
  ),
  plug: <path d="M9 3v5M15 3v5M7 8h10v3a5 5 0 0 1-10 0zM12 16v5" />,
  note: <path d="M6 3.5h9l4 4v13H6zM14.5 3.5V8H19M9 12.5h7M9 16h5" />,
  spark: (
    <path d="M11 3.5l1.9 5.1 5.1 1.9-5.1 1.9L11 17.5l-1.9-5.1L4 10.5l5.1-1.9zM18.5 15l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" />
  ),
  send: <path d="M12 19V5.5M6 11l6-6 6 6" />,
  stop: <rect x="7" y="7" width="10" height="10" rx="1.5" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  chev: <path d="M9 5.5 15.5 12 9 18.5" />,
  ext: <path d="M14 4.5h5.5V10M19.5 4.5 11 13M17.5 13.5v6h-13v-13h6" />,
  copy: (
    <>
      <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
      <path d="M5 15.5V5.5a1 1 0 0 1 1-1h9.5" />
    </>
  ),
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  law: <path d="M6 3.5h12v17H6zM9 8h6M9 12h6M9 16h4" />,
  yen: <path d="M7 4.5l5 7 5-7M12 11.5V20M8 12.5h8M8 16h8" />,
  gift: (
    <path d="M4 9.5h16v4H4zM5.5 13.5v7h13v-7M12 9.5v11M12 9.5c-2-4.5-6-3.5-5-1 .6 1.4 3 1 5 1zM12 9.5c2-4.5 6-3.5 5-1-.6 1.4-3 1-5 1z" />
  ),
  flag: <path d="M6 21V4M6 4.5h11l-2 4 2 4H6" />,
  pct: (
    <>
      <path d="M18 5 6 19" />
      <circle cx="7.5" cy="7.5" r="2.5" />
      <circle cx="16.5" cy="16.5" r="2.5" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8.5" r="3.7" />
      <path d="M4.5 20c.9-3.9 3.9-5.6 7.5-5.6s6.6 1.7 7.5 5.6" />
    </>
  ),
  layers: <path d="M12 4 3.5 8.5 12 13l8.5-4.5zM3.5 12.5 12 17l8.5-4.5M3.5 16.5 12 21l8.5-4.5" />,
  /* 追加：「発表」（どの種類にも当てはまらない動き）。ほかのアイコンと同じ線の太さで描いた拡声器 */
  news: <path d="M4 10v4h3l7 4.5v-13L7 10zM7 14l1.2 5.5h2.6l-1-4M17.5 9.5a4 4 0 0 1 0 5" />
} satisfies Record<string, ReactElement>;

export type IconName = keyof typeof PATHS;

/** ページのいちばん上に1つだけ置く */
export function IconSprite() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true" focusable="false">
      <defs>
        {(Object.keys(PATHS) as IconName[]).map(name => (
          <symbol key={name} id={`i-${name}`} viewBox="0 0 24 24">
            {PATHS[name]}
          </symbol>
        ))}
      </defs>
    </svg>
  );
}

export function Ic({ name }: { name: IconName }) {
  return (
    <svg className="ic" aria-hidden="true">
      <use href={`#i-${name}`} />
    </svg>
  );
}

/** 朱色の印（ロゴ） */
export function Seal({ size }: { size?: number }) {
  return (
    <svg
      className="brand-seal"
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={size ? { width: size, height: size } : undefined}
    >
      <rect width="24" height="24" rx="6" style={{ fill: 'var(--seal)' }} />
      <path d="M5 9.5c3.2 0 3.6 5 7 5s3.8-5 7-5" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}
