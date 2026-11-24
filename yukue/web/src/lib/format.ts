/** 金額の書き方。金額の単位は、どれも「兆円」で受け取る。 */

export type Unit = 'cho' | 'pc' | 'man';

/** 小数1桁（四捨五入） */
export const n1 = (v: number): string => (Math.round(v * 10) / 10).toFixed(1);

const group = (n: number): string => n.toLocaleString('ja-JP');

/** 兆円。1兆円に満たないときは億円にする */
export const fmtCho = (v: number): string => (v >= 1 ? n1(v) + '兆円' : group(Math.round(v * 10000)) + '億円');

export interface Formatters {
  /** 兆円（または億円） */
  cho: (v: number) => string;
  /** 国民1人あたり */
  pc: (v: number) => string;
  /** 総額を1万円としたときの金額 */
  man: (v: number) => string;
  /** 総額に占める割合 */
  pct: (v: number) => string;
  /** 画面でえらんだ単位で書く */
  by: (unit: Unit) => (v: number) => string;
}

/** total：一般会計の総額（兆円）、pop：人口（人） */
export function makeFormatters(total: number, pop: number): Formatters {
  const pc = (v: number): string => {
    const yen = (v * 1e12) / pop;
    return yen >= 1e4 ? '約' + n1(yen / 1e4) + '万円' : '約' + group(Math.round(yen / 100) * 100) + '円';
  };
  const man = (v: number): string => {
    const y = (v / total) * 1e4;
    return group(y >= 10 ? Math.round(y) : Math.round(y * 10) / 10) + '円';
  };
  const pct = (v: number): string => ((v / total) * 100).toFixed(1) + '%';
  return { cho: fmtCho, pc, man, pct, by: unit => (unit === 'pc' ? pc : unit === 'man' ? man : fmtCho) };
}

/** 前年度からの増減（最後の2つの値から）。値が足りなければ null */
export function yoyOf(trend: readonly number[] | null | undefined): string | null {
  if (!trend || trend.length < 2) return null;
  const a = trend[trend.length - 2];
  const b = trend[trend.length - 1];
  if (a == null || b == null || a === 0) return null;
  const p = ((b - a) / a) * 100;
  return (p >= 0 ? '+' : '−') + Math.abs(p).toFixed(1) + '%';
}

/** 図のラベルの幅のめやす（px）。全角は 1.03 文字、半角は 0.6 文字ぶんとして数える */
export function textWidth(s: string, fontSize = 12): number {
  let w = 0;
  for (const ch of String(s)) w += (ch.charCodeAt(0) > 255 ? 1.03 : 0.6) * fontSize;
  return w;
}

/** 円の金額を「万円」「億円」で書く（Jグランツの補助上限額など）。分からないときは null */
export function fmtYen(yen: number | null | undefined): string | null {
  if (yen == null || !Number.isFinite(yen) || yen <= 0) return null;
  if (yen < 1e4) return group(Math.round(yen)) + '円';
  const man = yen / 1e4;
  // 100万円からは万円の単位に丸める。それより小さいときは 0.1万円まで
  const rounded = man >= 100 ? Math.round(man) : Math.round(man * 10) / 10;
  if (rounded < 10000) return group(rounded) + '万円';
  const oku = Math.floor(rounded / 10000);
  const rest = rounded - oku * 10000;
  return group(oku) + '億' + (rest > 0 ? group(rest) + '万' : '') + '円';
}
