import { describe, expect, it } from 'vitest';
import {
  calendarWhen,
  dateLabel,
  dateTimeLabel,
  dayLabel,
  daysBetween,
  daysLeft,
  deadlineLabel,
  monthDay,
  parseYmd,
  shortDate,
  slashDate,
  stampJst,
  todayJst,
  untilLabel
} from './dates.ts';

describe('日付は日本時間で扱う', () => {
  it('UTC では前の日でも、日本時間の日付にする', () => {
    // 収集の時刻 2026-11-24T22:06Z は、日本では 11月25日 7:06
    expect(todayJst(new Date('2026-11-24T22:06:48.044Z'))).toBe('2026-11-25');
    expect(todayJst(new Date('2026-11-24T14:59:59Z'))).toBe('2026-11-24');
    expect(todayJst(new Date('2026-11-24T15:00:00Z'))).toBe('2026-11-25');
    expect(todayJst(new Date('2026-12-31T15:00:00Z'))).toBe('2027-01-01');
  });

  it('更新の日時を、日本時間の日付・曜日・時刻にする', () => {
    expect(stampJst('2026-11-24T09:00:00.000Z')).toEqual({ ymd: '2026-11-24', date: '2026.11.24', dow: '火', time: '18:00' });
    expect(stampJst('2026-11-24T22:06:48.044Z')).toEqual({ ymd: '2026-11-25', date: '2026.11.25', dow: '水', time: '07:06' });
    expect(stampJst('2026-11-25T07:06:48+09:00')?.time).toBe('07:06');
    expect(stampJst('')).toBeNull();
    expect(stampJst('いつか')).toBeNull();
    expect(dateTimeLabel('2026-11-24T22:08:39.861Z')).toBe('2026年11月25日 07:08');
    expect(dateTimeLabel(undefined)).toBeNull();
  });

  it('日付の書き方', () => {
    expect(dateLabel('2026-11-24')).toBe('11月24日（火）');
    expect(dateLabel('2026-11-02')).toBe('11月2日（月）');
    expect(monthDay('2026-12-14')).toBe('12月14日');
    expect(shortDate('2026-11-06')).toBe('11.06');
    expect(slashDate('2026-11-06')).toBe('11/06');
    expect(calendarWhen('2026-12-14')).toBe('12.14 月');
    expect(dateLabel('未定')).toBe('未定');
  });

  it('読めない日付は null', () => {
    expect(parseYmd('2026-13-01')).toBeNull();
    expect(parseYmd('2026/11/24')).toBeNull();
    expect(parseYmd(null)).toBeNull();
    expect(parseYmd('2026-11-24')).toEqual({ y: 2026, m: 11, d: 24 });
  });

  it('日数を数える（月や年をまたいでも）', () => {
    expect(daysBetween('2026-11-24', '2026-12-14')).toBe(20);
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1);
    expect(daysBetween('2026-11-24', '2026-11-20')).toBe(-4);
    expect(daysBetween('2026-11-24', 'x')).toBeNull();
  });

  it('締切は、これからのものだけ「あとN日」で出す', () => {
    expect(deadlineLabel('2026-12-14', '2026-11-24')).toBe('締切 12月14日（あと20日）');
    expect(deadlineLabel('2026-11-25', '2026-11-24')).toBe('締切 11月25日（あと1日）');
    expect(deadlineLabel('2026-11-24', '2026-11-24')).toBe('締切 11月24日（きょうまで）');
    expect(deadlineLabel('2026-11-23', '2026-11-24')).toBeNull();
    expect(deadlineLabel(undefined, '2026-11-24')).toBeNull();
    expect(deadlineLabel('12月中', '2026-11-24')).toBeNull();
    expect(daysLeft('2026-11-23', '2026-11-24')).toBeNull();
    expect(daysLeft('2026-11-24', '2026-11-24')).toBe(0);
  });

  it('年をまたぐ締切は、年も書く', () => {
    expect(deadlineLabel('2027-01-29', '2026-11-25')).toBe('締切 2027年1月29日（あと65日）');
    expect(deadlineLabel('2031-01-21', '2026-11-25')).toBe('締切 2031年1月21日（あと1518日）');
    expect(untilLabel('2026-12-31', '2026-11-25')).toBe('12月31日（あと36日）');
    expect(dayLabel('2026-12-14', '2026-11-25')).toBe('12月14日');
    expect(dayLabel('2027-03-31', '2026-11-25')).toBe('2027年3月31日');
    expect(dayLabel('未定', '2026-11-25')).toBe('未定');
  });
});
