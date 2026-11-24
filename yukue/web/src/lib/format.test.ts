import { describe, expect, it } from 'vitest';
import { fmtCho, fmtYen, makeFormatters, n1, textWidth, yoyOf } from './format.ts';

const fmt = makeFormatters(122.31, 1.2243e8);

describe('金額の書き方', () => {
  it('小数1桁に丸める', () => {
    expect(n1(122.31)).toBe('122.3');
    expect(n1(39.06)).toBe('39.1');
    expect(n1(9)).toBe('9.0');
  });

  it('1兆円以上は兆円、それより小さければ億円', () => {
    expect(fmtCho(122.31)).toBe('122.3兆円');
    expect(fmtCho(1)).toBe('1.0兆円');
    expect(fmtCho(0.88)).toBe('8,800億円');
    expect(fmtCho(0.26)).toBe('2,600億円');
    expect(fmtCho(0.05)).toBe('500億円');
  });

  it('国民1人あたり：1万円以上は万円、それより小さければ100円単位', () => {
    expect(fmt.pc(122.31)).toBe('約99.9万円');
    expect(fmt.pc(39.06)).toBe('約31.9万円');
    expect(fmt.pc(0.05)).toBe('約400円');
    expect(fmt.pc(0.26)).toBe('約2,100円');
  });

  it('1万円のうち：10円以上は整数、それより小さければ0.1円まで', () => {
    expect(fmt.man(122.31)).toBe('10,000円');
    expect(fmt.man(39.06)).toBe('3,194円');
    expect(fmt.man(8.98)).toBe('734円');
    expect(fmt.man(0.05)).toBe('4.1円');
  });

  it('全体に占める割合', () => {
    expect(fmt.pct(39.06)).toBe('31.9%');
    expect(fmt.pct(122.31)).toBe('100.0%');
    expect(fmt.pct(2.24)).toBe('1.8%');
  });

  it('単位の切り替え', () => {
    expect(fmt.by('cho')(8.98)).toBe('9.0兆円');
    expect(fmt.by('pc')(8.98)).toBe(fmt.pc(8.98));
    expect(fmt.by('man')(8.98)).toBe('734円');
  });

  it('前年度からの増減は、最後の2つの値から', () => {
    expect(yoyOf([115.2, 122.3])).toBe('+6.2%');
    expect(yoyOf([97.5, 97.7, 101.5, 102.7, 106.6, 107.6, 114.4, 112.6])).toBe('−1.6%');
    expect(yoyOf([6.1, 6.1])).toBe('+0.0%');
    expect(yoyOf([5])).toBeNull();
    expect(yoyOf(null)).toBeNull();
    expect(yoyOf(undefined)).toBeNull();
  });

  it('文字幅の見積もり：全角は 1.03、半角は 0.6 文字ぶん', () => {
    expect(textWidth('消費税')).toBeCloseTo(3 * 1.03 * 12, 5);
    expect(textWidth('26.7')).toBeCloseTo(4 * 0.6 * 12, 5);
    expect(textWidth('兆', 10)).toBeCloseTo(10.3, 5);
    expect(textWidth('')).toBe(0);
  });
});

describe('円の金額（Jグランツの補助上限額）', () => {
  it('万円と億円で書く', () => {
    expect(fmtYen(2_000_000)).toBe('200万円');
    expect(fmtYen(5_000_000)).toBe('500万円');
    expect(fmtYen(12_345_678)).toBe('1,235万円');
    expect(fmtYen(55_000)).toBe('5.5万円');
    expect(fmtYen(100_000_000)).toBe('1億円');
    expect(fmtYen(25_000_000_000)).toBe('250億円');
    expect(fmtYen(150_000_000)).toBe('1億5,000万円');
    expect(fmtYen(99_999_900)).toBe('1億円');
    expect(fmtYen(9_800)).toBe('9,800円');
  });

  it('分からないとき（null・0・負の数）は null', () => {
    expect(fmtYen(null)).toBeNull();
    expect(fmtYen(undefined)).toBeNull();
    expect(fmtYen(0)).toBeNull();
    expect(fmtYen(-1)).toBeNull();
    expect(fmtYen(Number.NaN)).toBeNull();
  });
});
