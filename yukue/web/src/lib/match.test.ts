import { describe, expect, it } from 'vitest';
import { program, programs } from '../test/fixtures.ts';
import { matchProgram, matchPrograms, type Match } from './match.ts';
import { applyPreset, cleanProfile, PF0, profileSummary, toggleAim, toggleKid, type Profile } from './profile.ts';

const pf = (over: Partial<Profile>): Profile => ({ ...PF0, kids: [], aims: [], ...over });
const byId = (id: string) => {
  const p = programs.find(x => x.id === id);
  if (!p) throw new Error(id);
  return p;
};
const m = (id: string, over: Partial<Profile>): Match | null => matchProgram(byId(id), pf(over));
const levels = (profile: Profile): Record<string, string> =>
  Object.fromEntries(matchPrograms(programs, profile).map(x => [x.p.id, x.m.lv]));

describe('設定と制度の照合（サンプルの規則）', () => {
  it('立場が未設定なら、判定しない', () => {
    expect(matchProgram(byId('jidou'), PF0)).toBeNull();
    expect(matchPrograms(programs, PF0)).toEqual([]);
  });

  it('立場が合わない制度は「対象外の見込み」。理由に、対象の立場を書く', () => {
    expect(m('jidou', { kind: 'biz' })).toEqual({ lv: 'no', why: ['子育て世帯が対象'], ask: [] });
    expect(m('gyomu', { kind: 'person' })).toEqual({ lv: 'no', why: ['事業者・中小企業・NPO・団体が対象'], ask: [] });
    expect(m('juten', { kind: 'npo' })?.lv).toBe('no');
  });

  it('個人は、個人向けと子育て世帯向けの両方が対象になりうる', () => {
    expect(m('jidou', { kind: 'person' })?.lv).toBe('maybe');
    expect(m('kunren', { kind: 'person' })?.lv).toBe('maybe');
  });

  it('児童手当：子どもの年齢で決まる', () => {
    expect(m('jidou', { kind: 'person', kids: ['pre'] })).toEqual({ lv: 'high', why: ['高校生年代までの子どもがいる'], ask: [] });
    expect(m('jidou', { kind: 'person', kids: ['high'] })?.lv).toBe('high');
    expect(m('jidou', { kind: 'person', kids: ['none'] })).toEqual({
      lv: 'no',
      why: ['高校生年代までの子どもを育てている世帯が対象'],
      ask: []
    });
    expect(m('jidou', { kind: 'person', kids: [] })).toEqual({ lv: 'maybe', why: [], ask: ['子どもの年齢'] });
  });

  it('就学支援金：高校生年代なら対象、それより下なら「これから対象になる」', () => {
    expect(m('shugaku', { kind: 'person', kids: ['high'] })?.lv).toBe('high');
    expect(m('shugaku', { kind: 'person', kids: ['school'] })).toEqual({
      lv: 'later',
      why: ['子どもが高校などに入るときに対象になる'],
      ask: []
    });
    expect(m('shugaku', { kind: 'person', kids: ['none'] })?.lv).toBe('no');
    expect(m('shugaku', { kind: 'person' })?.ask).toEqual(['子どもの年齢']);
  });

  it('教育訓練給付金：雇用保険で決まる', () => {
    expect(m('kunren', { kind: 'person', koyo: 'yes' })).toEqual({
      lv: 'high',
      why: ['雇用保険に入っている（入っていた）'],
      ask: ['加入していた期間が足りているか']
    });
    expect(m('kunren', { kind: 'person', koyo: 'no' })?.lv).toBe('no');
    expect(m('kunren', { kind: 'person', koyo: 'unk' })).toEqual({ lv: 'maybe', why: [], ask: ['雇用保険に入っているか'] });
  });

  it('高額療養費：必要なときに使える。年収を入れると、理由が1つ増える', () => {
    expect(m('kougaku', { kind: 'person' })).toEqual({ lv: 'when', why: ['医療費の自己負担が高額になった月に使える'], ask: [] });
    expect(m('kougaku', { kind: 'person', income: 'b' })?.why).toEqual([
      '医療費の自己負担が高額になった月に使える',
      '上限の額は所得の区分で決まる'
    ]);
  });

  it('持続化補助金：従業員20名以下・創業3年以内。分からない項目は「たしかめること」に回す', () => {
    expect(m('jizoku-p', { kind: 'biz', staff: '3', years: '2' })).toEqual({
      lv: 'high',
      why: ['従業員が20名以下', '創業から3年以内'],
      ask: []
    });
    expect(m('jizoku-p', { kind: 'biz', staff: '20', years: '3' })?.lv).toBe('high');
    expect(m('jizoku-p', { kind: 'biz', staff: '21', years: '1' })).toEqual({ lv: 'no', why: ['従業員20名以下の事業者が対象'], ask: [] });
    expect(m('jizoku-p', { kind: 'biz', staff: '3', years: '4' })?.lv).toBe('no');
    expect(m('jizoku-p', { kind: 'biz', bform: 'large', staff: '3', years: '1' })).toEqual({ lv: 'no', why: ['小規模な事業者が対象'], ask: [] });
    expect(m('jizoku-p', { kind: 'biz', staff: '3' })).toEqual({ lv: 'maybe', why: ['従業員が20名以下'], ask: ['創業からの年数'] });
    expect(m('jizoku-p', { kind: 'biz' })).toEqual({ lv: 'maybe', why: [], ask: ['従業員の数', '創業からの年数'] });
    // 数字として読めない入力は、未入力として扱う
    expect(m('jizoku-p', { kind: 'biz', staff: 'たくさん', years: '2' })?.ask).toEqual(['従業員の数']);
    // 0 は「入力あり」
    expect(m('jizoku-p', { kind: 'biz', staff: '0', years: '0' })?.lv).toBe('high');
  });

  it('GX補助金・業務改善助成金・キャリアアップ助成金：取り組みたいことで決まる', () => {
    expect(m('gx-p', { kind: 'biz', aims: ['gx'] })?.lv).toBe('maybe');
    expect(m('gx-p', { kind: 'biz', aims: ['sales'] })).toEqual({ lv: 'no', why: ['脱炭素電源を使う設備投資が対象'], ask: [] });
    expect(m('gx-p', { kind: 'biz' })).toEqual({ lv: 'maybe', why: [], ask: ['取り組みたいこと'] });
    expect(m('gyomu', { kind: 'biz', aims: ['wage'] })?.lv).toBe('high');
    expect(m('gyomu', { kind: 'biz', aims: ['wage'], bform: 'large' })?.lv).toBe('no');
    expect(m('gyomu', { kind: 'npo' })?.lv).toBe('maybe');
    expect(m('career', { kind: 'biz', aims: ['hire'] })?.lv).toBe('high');
    expect(m('career', { kind: 'biz' })?.ask).toEqual(['有期雇用の人を正社員にする予定があるか']);
  });

  it('NPO・自治体向けの制度', () => {
    expect(m('kyumin', { kind: 'npo' })).toEqual({
      lv: 'maybe',
      why: ['NPOなどの団体が対象'],
      ask: ['公募中の助成のテーマに活動が合うか']
    });
    expect(m('juten', { kind: 'local' })).toEqual({ lv: 'high', why: ['都道府県・市区町村が対象'], ask: [] });
  });

  it('規則のない制度は、立場が合えば「条件しだい」', () => {
    expect(matchProgram(program({ id: 'new-one', aud: ['biz'] }), pf({ kind: 'biz' }))).toEqual({ lv: 'maybe', why: [], ask: [] });
  });

  it('例「子育て中の会社員」：合う制度が上に、対象外が下に並ぶ', () => {
    const profile = applyPreset('person', PF0);
    expect(levels(profile)).toEqual({
      jidou: 'high',
      kunren: 'high',
      kougaku: 'when',
      shugaku: 'later',
      'jizoku-p': 'no',
      'gx-p': 'no',
      gyomu: 'no',
      career: 'no',
      kyumin: 'no',
      juten: 'no'
    });
    const order = matchPrograms(programs, profile).map(x => x.p.id);
    expect(order.slice(0, 4)).toEqual(['jidou', 'kunren', 'kougaku', 'shugaku']);
    // 同じ段階のなかでは、元の並びを保つ
    expect(order.slice(4)).toEqual(['jizoku-p', 'gx-p', 'gyomu', 'career', 'kyumin', 'juten']);
  });

  it('例「創業2年の個人事業主」：例を切り替えると、合う制度が入れ替わる', () => {
    const profile = applyPreset('biz', PF0);
    expect(levels(profile)).toEqual({
      'jizoku-p': 'high',
      gyomu: 'high',
      career: 'maybe',
      'gx-p': 'no',
      jidou: 'no',
      shugaku: 'no',
      kunren: 'no',
      kougaku: 'no',
      kyumin: 'no',
      juten: 'no'
    });
    expect(matchPrograms(programs, profile).filter(x => x.m.lv !== 'no').map(x => x.p.id)).toEqual(['jizoku-p', 'gyomu', 'career']);
  });
});

describe('プロフィール', () => {
  it('例を当てはめても、「AIの回答に使う」の設定は引き継ぐ', () => {
    expect(applyPreset('person', { ...PF0, useInAi: false }).useInAi).toBe(false);
    expect(applyPreset('biz', PF0)).toMatchObject({ kind: 'biz', pref: '大阪府', staff: '3', years: '2', aims: ['sales', 'wage'], useInAi: true });
  });

  it('設定をひとことで', () => {
    expect(profileSummary(PF0)).toBe('');
    expect(profileSummary(applyPreset('person', PF0))).toBe('個人 ・ 東京都 ・ 子ども：小・中学生 ・ 会社員・公務員');
    expect(profileSummary(applyPreset('biz', PF0))).toBe('事業者 ・ 大阪府 ・ 個人事業主 ・ 小売・飲食 ・ 従業員3名 ・ 創業2年');
    expect(profileSummary(pf({ kind: 'npo', oform: 'npo', staff: '5' }))).toBe('NPO・団体 ・ NPO法人 ・ 職員5名');
    expect(profileSummary(pf({ kind: 'local', pref: '北海道' }))).toBe('自治体 ・ 北海道');
  });

  it('保存されていた値は、知っているものだけを読む', () => {
    expect(cleanProfile(null)).toEqual(PF0);
    expect(cleanProfile('こわれた値')).toEqual(PF0);
    expect(cleanProfile({ kind: 'alien', kids: ['pre', 'x', 'pre'], aims: 'gx', staff: 3, useInAi: false })).toEqual({
      ...PF0,
      kids: ['pre'],
      staff: '3',
      useInAi: false
    });
    // 読み直した値は、既定値の配列と同じものを共有しない
    expect(cleanProfile(null).kids).not.toBe(PF0.kids);
  });

  it('子ども：「いない」と年齢は、どちらかだけ', () => {
    expect(toggleKid([], 'pre')).toEqual(['pre']);
    expect(toggleKid(['pre'], 'high')).toEqual(['pre', 'high']);
    expect(toggleKid(['pre', 'high'], 'pre')).toEqual(['high']);
    expect(toggleKid(['pre', 'high'], 'none')).toEqual(['none']);
    expect(toggleKid(['none'], 'school')).toEqual(['school']);
    expect(toggleKid(['none'], 'none')).toEqual([]);
    expect(toggleAim(['sales'], 'wage')).toEqual(['sales', 'wage']);
    expect(toggleAim(['sales', 'wage'], 'sales')).toEqual(['wage']);
  });
});
