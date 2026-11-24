/** 図にポインターを合わせたときの小さな吹き出し。ページに1つだけ置く（出し入れは components/tip.ts）。 */
import { useEffect, useRef } from 'react';
import { hideTip, registerTip } from './tip.ts';

export function TipLayer() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    registerTip(ref.current);
    window.addEventListener('scroll', hideTip, { passive: true });
    return () => {
      window.removeEventListener('scroll', hideTip);
      registerTip(null);
    };
  }, []);
  return (
    <div className="tip" ref={ref} hidden>
      <b />
      <span />
    </div>
  );
}
