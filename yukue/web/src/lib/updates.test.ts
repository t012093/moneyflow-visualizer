import { describe, expect, it } from 'vitest';
import { update } from '../test/fixtures.ts';
import type { CalendarEntry, JGrant } from '../types.ts';
import { areaLabel, areaParts, filterJGrants, jgrantAreas, jgrantStatus } from './jgrants.ts';
import {
  filterUpdates,
  groupByDay,
  isHttps,
  isPassedLaw,
  matchesQuery,
  pickByTheme,
  resolveBriefing,
  safeLinks,
  sortUpdates,
  stageName,
  upcoming,
  type UpdateFilter
} from './updates.ts';

const ALL: UpdateFilter = { type: 'all', theme: 'all', query: '', showAll: false };
const ids = (xs: { id: string }[]): string[] => xs.map(x => x.id);

const items = [
  update({ id: 'a', date: '2026-11-20', importance: 60, type: 'law', theme: 'social', title: 'B型肝炎の給付金', ministry: '厚生労働省' }),
  update({ id: 'b', date: '2026-11-24', importance: 56, type: 'system', theme: 'other', title: 'AI・デジタル改革推進会議', summary: '専門調査会が初会合' }),
  update({ id: 'c', date: '2026-11-24', importance: 95, type: 'budget', theme: 'whole', title: '第2次補正予算', ministry: '内閣府・財務省' }),
  update({ id: 'd', date: '2026-11-24', importance: 30, type: 'news', theme: 'other', title: '人事異動', noise: true, ministry: '財務省' }),
  update({ id: 'e', date: '2026-11-24', importance: 95, type: 'grant', theme: 'industry', title: 'ＧＸ補助金', deadline: '2026-12-14', ministry: 'Jグランツ掲載' }),
  update({ id: 'f', date: '2026-11-25', importance: 10, type: 'news', theme: 'social', title: '会見の概要' })
];

describe('政策の動き：並べ方と絞り込み', () => {
  it('新しい日付が先。同じ日のなかでは重要度の高い順（同じなら元の順）', () => {
    expect(ids(sortUpdates(items))).toEqual(['f', 'c', 'e', 'b', 'd', 'a']);
    // 元の配列は並べ替えない
    expect(ids(items)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });

  it('人事・入札・会見など（noise）は、「すべての発表を表示」のときだけ出す', () => {
    expect(ids(filterUpdates(sortUpdates(items), ALL))).toEqual(['f', 'c', 'e', 'b', 'a']);
    expect(ids(filterUpdates(sortUpdates(items), { ...ALL, showAll: true }))).toEqual(['f', 'c', 'e', 'b', 'd', 'a']);
  });

  it('種類と分野で絞る', () => {
    expect(ids(filterUpdates(items, { ...ALL, type: 'news' }))).toEqual(['f']);
    expect(ids(filterUpdates(items, { ...ALL, type: 'news', showAll: true }))).toEqual(['d', 'f']);
    expect(ids(filterUpdates(items, { ...ALL, theme: 'social' }))).toEqual(['a', 'f']);
    expect(ids(filterUpdates(items, { ...ALL, type: 'law', theme: 'other' }))).toEqual([]);
  });

  it('キーワードは、題・要約・発表元を見る。全角と半角、大文字と小文字は区別しない', () => {
    expect(ids(filterUpdates(items, { ...ALL, query: '肝炎' }))).toEqual(['a']);
    expect(ids(filterUpdates(items, { ...ALL, query: '初会合' }))).toEqual(['b']);
    expect(ids(filterUpdates(items, { ...ALL, query: '財務省' }))).toEqual(['c']);
    expect(ids(filterUpdates(items, { ...ALL, query: '財務省', showAll: true }))).toEqual(['c', 'd']);
    expect(ids(filterUpdates(items, { ...ALL, query: 'gx' }))).toEqual(['e']);
    expect(ids(filterUpdates(items, { ...ALL, query: 'ＡＩ　会議' }))).toEqual(['b']);
    expect(ids(filterUpdates(items, { ...ALL, query: 'ai 肝炎' }))).toEqual([]);
    expect(ids(filterUpdates(items, { ...ALL, query: '   ' }))).toEqual(['a', 'b', 'c', 'e', 'f']);
    expect(matchesQuery(update({ id: 'x', title: '題', originalTitle: '正式な名前' }), '正式')).toBe(false);
  });

  it('日付ごとにまとめる', () => {
    const groups = groupByDay(filterUpdates(sortUpdates(items), ALL));
    expect(groups.map(g => [g.date, ids(g.items)])).toEqual([
      ['2026-11-25', ['f']],
      ['2026-11-24', ['c', 'e', 'b']],
      ['2026-11-20', ['a']]
    ]);
    expect(groupByDay([])).toEqual([]);
  });

  it('段階の呼び名。段階のない発表は null', () => {
    const steps = ['検討', '閣議決定', '国会審議', '成立', '公布', '施行'];
    expect(stageName(update({ id: 'x' }))).toBeNull();
    expect(stageName(update({ id: 'x', stage: { steps, index: 4, label: '公布' } }))).toBe('公布');
    expect(stageName(update({ id: 'x', stage: { steps, index: 2, label: '' } }))).toBe('国会審議');
    expect(stageName(update({ id: 'x', stage: { steps, index: 9, label: '' } }))).toBeNull();
  });

  it('成立まで進んだ法律かどうか', () => {
    const steps = ['検討', '閣議決定', '国会審議', '成立', '公布', '施行'];
    expect(isPassedLaw(update({ id: 'x', type: 'law', stage: { steps, index: 4, label: '公布' } }))).toBe(true);
    expect(isPassedLaw(update({ id: 'x', type: 'law', stage: { steps, index: 2, label: '国会審議' } }))).toBe(false);
    expect(isPassedLaw(update({ id: 'x', type: 'law', stage: { steps: ['提出', '審議', '成立'], index: 2, label: '成立' } }))).toBe(true);
    expect(isPassedLaw(update({ id: 'x', type: 'law' }))).toBe(false);
    expect(isPassedLaw(update({ id: 'x', type: 'budget', stage: { steps, index: 5, label: '' } }))).toBe(false);
  });

  it('リンクは https:// で始まるものだけ。#:~:text= の付いたURLは、そのまま通す', () => {
    const fragment = 'https://www.mof.go.jp/policy/budget/index.html#:~:text=%E4%BB%A4%E5%92%8C8%E5%B9%B4%E5%BA%A6';
    expect(isHttps(fragment)).toBe(true);
    expect(isHttps('http://example.go.jp/')).toBe(false);
    expect(isHttps('javascript:alert(1)')).toBe(false);
    expect(isHttps(' https://example.go.jp/')).toBe(false);
    expect(isHttps('')).toBe(false);
    expect(isHttps(undefined)).toBe(false);
    const links = [
      { name: 'A', url: fragment },
      { name: 'B', url: 'http://example.go.jp/' },
      { name: 'C', url: '/relative' }
    ];
    expect(safeLinks(links)).toEqual([{ name: 'A', url: fragment }]);
    expect(safeLinks(null)).toEqual([]);
  });
});

describe('ホームに出す分', () => {
  it('きょうの動き：briefing.json の id を突き合わせ、見つからない id は飛ばす', () => {
    const briefing = {
      date: '2026-11-25',
      generatedAt: '2026-11-24T22:06:48.044Z',
      method: 'rules' as const,
      items: [
        { id: 'c', text: '補正予算の編成を指示。' },
        { id: 'もう無い', text: '消えた動き' },
        { id: 'a', text: '' },
        { id: 'c', text: '同じ id の2つめ' }
      ]
    };
    expect(resolveBriefing(briefing, items).map(x => [x.update.id, x.text])).toEqual([
      ['c', '補正予算の編成を指示。'],
      ['a', 'B型肝炎の給付金']
    ]);
  });

  it('きょうの動き：1件も残らないときは、直近1週間で重要度の高い動きを3件（noise は除く）', () => {
    const stale = { date: '', generatedAt: '', method: 'ai' as const, items: [{ id: 'x', text: 'x' }] };
    const more = [...items, update({ id: 'old', date: '2026-11-01', importance: 100, title: '古いが重要' })];
    expect(resolveBriefing(stale, more).map(x => [x.update.id, x.text])).toEqual([
      ['c', '第2次補正予算'],
      ['e', 'ＧＸ補助金'],
      ['a', 'B型肝炎の給付金']
    ]);
    expect(resolveBriefing(null, more).map(x => x.update.id)).toEqual(['c', 'e', 'a']);
    expect(resolveBriefing(null, [])).toEqual([]);
    expect(resolveBriefing(null, [update({ id: 'n', noise: true })])).toEqual([]);
  });

  it('これからの予定：calendar.json と締切を合わせて、近い順に6件まで', () => {
    const calendar: CalendarEntry[] = [
      { date: '2026-12-25', when: '12月下旬', title: '政府案', note: '例年の時期' },
      { date: '2026-11-20', when: '11.20 金', title: 'もう過ぎた予定', note: '' },
      { date: '2026-12-14', when: '12.14 月', title: 'GX補助金の締切', note: 'Jグランツ ・ 正午まで', updateId: 'e' },
      { date: '2026-11-25', when: '11.25 水', title: '検討会', note: '厚生労働省', updateId: 'もう無い' }
    ];
    const ups = [
      ...items,
      update({ id: 'g', title: '意見募集', ministry: 'こども家庭庁', deadline: '2026-12-18' }),
      update({ id: 'h', title: '過ぎた締切', deadline: '2026-11-23' }),
      update({ id: 'i', title: 'きょうが締切', ministry: '総務省', deadline: '2026-11-24' }),
      update({ id: 'j', title: '入札', deadline: '2026-12-01', noise: true }),
      update({ id: 'k', title: '日付が読めない', deadline: '12月中' })
    ];
    expect(upcoming(calendar, ups, '2026-11-24')).toEqual([
      { date: '2026-11-24', when: '11.24 火', title: 'きょうが締切', note: '締切 ・ 総務省', updateId: 'i' },
      { date: '2026-11-25', when: '11.25 水', title: '検討会', note: '厚生労働省', updateId: undefined },
      // 同じ動きが両方にあるときは、calendar.json の書き方を使う（重ねて出さない）
      { date: '2026-12-14', when: '12.14 月', title: 'GX補助金の締切', note: 'Jグランツ ・ 正午まで', updateId: 'e' },
      { date: '2026-12-18', when: '12.18 金', title: '意見募集', note: '締切 ・ こども家庭庁', updateId: 'g' },
      { date: '2026-12-25', when: '12月下旬', title: '政府案', note: '例年の時期', updateId: undefined }
    ]);
    const many = Array.from({ length: 9 }, (_, n) => update({ id: `m${n}`, deadline: `2026-12-0${n + 1}` }));
    expect(upcoming([], many, '2026-11-24').map(r => r.date)).toEqual([
      '2026-12-01',
      '2026-12-02',
      '2026-12-03',
      '2026-12-04',
      '2026-12-05',
      '2026-12-06'
    ]);
    expect(upcoming([], [], '2026-11-24')).toEqual([]);
  });

  it('分野ごとに目立たせる動き：直近14日の中で、重要度の高い順（同じなら新しい順）', () => {
    const list = [
      update({ id: 'visit', date: '2026-11-24', theme: 'social', importance: 20, title: '視察に参加しました' }),
      update({ id: 'law', date: '2026-11-13', theme: 'social', importance: 80, title: '改正法が成立' }),
      update({ id: 'bill', date: '2026-11-20', theme: 'social', importance: 80, title: '法案を提出' }),
      update({ id: 'opinion', date: '2026-11-22', theme: 'social', importance: 45, title: '意見募集' }),
      update({ id: 'old', date: '2026-10-01', theme: 'social', importance: 99, title: '前の月の大きな動き' }),
      update({ id: 'jinji', date: '2026-11-24', theme: 'social', importance: 100, noise: true, title: '人事異動' }),
      update({ id: 'other', date: '2026-11-24', theme: 'industry', importance: 90, title: 'ほかの分野' })
    ];
    // 新しいだけの軽い発表（視察）や、人事などは選ばない
    expect(ids(pickByTheme(list, 'social', 2, '2026-11-25'))).toEqual(['bill', 'law']);
    expect(ids(pickByTheme(list, 'social', 1, '2026-11-25'))).toEqual(['bill']);
    // 14日より前のものは、足りないときだけ足す（足すときも重要度の高い順）
    expect(ids(pickByTheme(list, 'social', 5, '2026-11-25'))).toEqual(['bill', 'law', 'opinion', 'visit', 'old']);
    expect(ids(pickByTheme(list, 'social', 2, '2026-12-20'))).toEqual(['old', 'bill']);
    expect(ids(pickByTheme(list, 'social', 2, '2026-11-25', 3))).toEqual(['opinion', 'visit']);
    expect(ids(pickByTheme(list, 'industry', 2, '2026-11-25'))).toEqual(['other']);
    expect(pickByTheme(list, 'defense', 2, '2026-11-25')).toEqual([]);
    // 元の配列は並べ替えない
    expect(ids(list)).toEqual(['visit', 'law', 'bill', 'opinion', 'old', 'jinji', 'other']);
  });
});

describe('Jグランツの受付中の補助金', () => {
  const g = (over: Partial<JGrant> & { id: string }): JGrant => ({
    title: over.id,
    area: '全国',
    maxAmount: null,
    start: null,
    end: null,
    employees: null,
    url: `https://www.jgrants-portal.go.jp/subsidy/${over.id}`,
    ...over
  });
  const list = [
    g({ id: 'tokyo', title: '東京都の省エネ補助金', area: '東京都', end: '2026-12-20' }),
    g({ id: 'all', title: 'ＩＴ導入補助金', area: '全国', end: '2026-11-30' }),
    g({ id: 'two', title: '北国の雪対策', area: '北海道 / 青森県', end: null }),
    g({ id: 'done', title: '終わった公募', area: '全国', end: '2026-11-23' }),
    g({ id: 'today', title: 'きょうまでの公募', area: '大阪府', end: '2026-11-24' }),
    g({ id: 'soon', title: 'これから始まる公募', area: 'その他の地域', start: '2026-12-01', end: '2027-01-31' })
  ];

  it('対象地域を1つずつに分ける', () => {
    expect(areaParts('北海道 / 青森県')).toEqual(['北海道', '青森県']);
    expect(areaParts('東京都、神奈川県')).toEqual(['東京都', '神奈川県']);
    expect(areaParts('全国')).toEqual(['全国']);
    expect(areaParts('')).toEqual([]);
    expect(areaParts(null)).toEqual([]);
  });

  it('対象地域を短く書く（たくさん並ぶときは「ほかN地域」）', () => {
    expect(areaLabel('東京都')).toBe('東京都');
    expect(areaLabel('北海道 / 青森県')).toBe('北海道、青森県');
    expect(areaLabel('茨城県 / 栃木県 / 群馬県 / 埼玉県 / 千葉県 / 東京都 / 神奈川県 / 山梨県')).toBe('茨城県、栃木県、ほか6地域');
    expect(areaLabel('茨城県 / 栃木県 / 群馬県 / 埼玉県 / 千葉県 / 東京都 / 神奈川県 / 山梨県', 8)).toBe(
      '茨城県、栃木県、群馬県、埼玉県、千葉県、東京都、神奈川県、山梨県'
    );
    expect(areaLabel('全国 / 北海道 / 青森県 / 岩手県')).toBe('全国');
    expect(areaLabel('関東・甲信越地方')).toBe('関東・甲信越地方');
    expect(areaLabel('')).toBe('');
    expect(areaLabel(null)).toBe('');
  });

  it('地域の選択肢：「全国」、都道府県（北から）、それ以外の順', () => {
    expect(jgrantAreas(list)).toEqual(['全国', '北海道', '青森県', '東京都', '大阪府', 'その他の地域']);
    expect(jgrantAreas([])).toEqual([]);
  });

  it('受付が終わったものは外し、締切の近い順に並べる（締切のないものは最後）', () => {
    expect(ids(filterJGrants(list, { query: '', area: '' }, '2026-11-24'))).toEqual(['today', 'all', 'tokyo', 'soon', 'two']);
  });

  it('キーワード（名前・地域）と地域で絞る', () => {
    expect(ids(filterJGrants(list, { query: 'it', area: '' }, '2026-11-24'))).toEqual(['all']);
    expect(ids(filterJGrants(list, { query: '補助金', area: '' }, '2026-11-24'))).toEqual(['all', 'tokyo']);
    expect(ids(filterJGrants(list, { query: '青森', area: '' }, '2026-11-24'))).toEqual(['two']);
    expect(ids(filterJGrants(list, { query: '', area: '青森県' }, '2026-11-24'))).toEqual(['two']);
    expect(ids(filterJGrants(list, { query: '', area: '全国' }, '2026-11-24'))).toEqual(['all']);
    expect(ids(filterJGrants(list, { query: '補助金', area: '大阪府' }, '2026-11-24'))).toEqual([]);
  });

  it('受付の状態', () => {
    expect(jgrantStatus(list[0]!, '2026-11-24')).toEqual({ cls: 'open', text: '受付中 ・ 12月20日まで' });
    expect(jgrantStatus(list[2]!, '2026-11-24')).toEqual({ cls: 'open', text: '受付中' });
    expect(jgrantStatus(list[5]!, '2026-11-24')).toEqual({ cls: 'soon', text: '受付前 ・ 12月1日から' });
    expect(jgrantStatus(g({ id: 'far', end: '2027-01-31' }), '2026-11-24')).toEqual({ cls: 'open', text: '受付中 ・ 2027年1月31日まで' });
  });
});
