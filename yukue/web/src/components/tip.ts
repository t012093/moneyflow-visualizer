/**
 * 図にポインターを合わせたときの小さな吹き出しを、出したり消したりする。
 * 吹き出しはページに1つだけ（components/Tip.tsx の TipLayer）。位置と中身を直接書きかえる。
 */
let tipEl: HTMLDivElement | null = null;

/** TipLayer が、自分の要素を知らせる（外すときは null） */
export function registerTip(el: HTMLDivElement | null): void {
  tipEl = el;
}

export function showTip(e: { clientX: number; clientY: number }, strong: string, sub: string): void {
  const el = tipEl;
  if (!el) return;
  const [b, s] = [el.children[0], el.children[1]];
  if (b) b.textContent = strong;
  if (s) s.textContent = sub;
  el.hidden = false;
  const r = el.getBoundingClientRect();
  let x = e.clientX + 14;
  let y = e.clientY + 16;
  if (x + r.width > window.innerWidth - 8) x = e.clientX - r.width - 14;
  if (y + r.height > window.innerHeight - 8) y = e.clientY - r.height - 14;
  el.style.left = Math.max(8, x) + 'px';
  el.style.top = Math.max(8, y) + 'px';
}

export function hideTip(): void {
  if (tipEl) tipEl.hidden = true;
}
