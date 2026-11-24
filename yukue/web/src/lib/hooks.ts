import { useMemo, useSyncExternalStore } from 'react';

/** メディアクエリに合っているか。変わったら描き直す */
export function useMediaQuery(query: string): boolean {
  const mq = useMemo(() => window.matchMedia(query), [query]);
  return useSyncExternalStore(
    onChange => {
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    },
    () => mq.matches
  );
}

/** 動きを減らす設定にしているか（呼んだ時点の値） */
export const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
