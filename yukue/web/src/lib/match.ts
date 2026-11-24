/**
 * 設定と制度の照合。サンプルの規則で、正式な要件ではない。
 * 判定はAIの推測ではなく、制度ごとの規則で行う（規則は制度の id で持つ）。
 */
import { AUD, LV, type MatchLevel } from '../content.ts';
import type { Program } from '../types.ts';
import type { Profile } from './profile.ts';

export interface Match {
  lv: MatchLevel;
  /** そう判定した理由 */
  why: string[];
  /** まだ分からないので、たしかめること */
  ask: string[];
}

export interface ProgramMatch {
  p: Program;
  m: Match;
}

const R = (lv: MatchLevel, why: string[] = [], ask: string[] = []): Match => ({ lv, why, ask });
const num = (v: string): number | null => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));

/** 設定がまだ（立場が未設定）なら null */
export function matchProgram(p: Program, pf: Profile): Match | null {
  const k = pf.kind;
  if (!k) return null;
  const audOk = k === 'person' ? p.aud.includes('person') || p.aud.includes('family') : p.aud.includes(k);
  if (!audOk) return R('no', [`${p.aud.map(a => AUD[a]).join('・')}が対象`]);
  const kids = pf.kids;
  const anyKid = (['pre', 'school', 'high'] as const).some(x => kids.includes(x));
  const noKid = kids.includes('none');
  const staff = num(pf.staff);
  const years = num(pf.years);
  switch (p.id) {
    case 'jidou':
      return anyKid
        ? R('high', ['高校生年代までの子どもがいる'])
        : noKid
          ? R('no', ['高校生年代までの子どもを育てている世帯が対象'])
          : R('maybe', [], ['子どもの年齢']);
    case 'shugaku':
      return kids.includes('high')
        ? R('high', ['高校生年代の子どもがいる'])
        : anyKid
          ? R('later', ['子どもが高校などに入るときに対象になる'])
          : noKid
            ? R('no', ['高校などに通う生徒のいる世帯が対象'])
            : R('maybe', [], ['子どもの年齢']);
    case 'kunren':
      return pf.koyo === 'yes'
        ? R('high', ['雇用保険に入っている（入っていた）'], ['加入していた期間が足りているか'])
        : pf.koyo === 'no'
          ? R('no', ['雇用保険に一定の期間入っていることが条件'])
          : R('maybe', [], ['雇用保険に入っているか']);
    case 'kougaku':
      return R('when', ['医療費の自己負担が高額になった月に使える'].concat(pf.income ? ['上限の額は所得の区分で決まる'] : []));
    case 'jizoku-p': {
      if (pf.bform === 'large') return R('no', ['小規模な事業者が対象']);
      if (staff != null && staff > 20) return R('no', ['従業員20名以下の事業者が対象']);
      if (years != null && years > 3) return R('no', ['創業まもない事業者が対象（サンプルでは3年以内で判定）']);
      const why: string[] = [];
      const ask: string[] = [];
      if (staff != null) why.push('従業員が20名以下');
      else ask.push('従業員の数');
      if (years != null) why.push('創業から3年以内');
      else ask.push('創業からの年数');
      return R(ask.length ? 'maybe' : 'high', why, ask);
    }
    case 'gx-p':
      return pf.aims.includes('gx')
        ? R('maybe', ['脱炭素の投資に取り組みたい'], ['脱炭素電源を使う工場・データセンターへの投資か'])
        : pf.aims.length
          ? R('no', ['脱炭素電源を使う設備投資が対象'])
          : R('maybe', [], ['取り組みたいこと']);
    case 'gyomu':
      return pf.bform === 'large'
        ? R('no', ['中小企業などが対象'])
        : pf.aims.includes('wage')
          ? R('high', ['賃上げに取り組みたい'], ['事業場内の最低賃金が条件に合うか'])
          : R('maybe', [], ['賃上げと設備投資の予定があるか']);
    case 'career':
      return pf.aims.includes('hire')
        ? R('high', ['正社員化に取り組みたい'], ['対象になる有期雇用の人がいるか'])
        : R('maybe', [], ['有期雇用の人を正社員にする予定があるか']);
    case 'kyumin':
      return R('maybe', ['NPOなどの団体が対象'], ['公募中の助成のテーマに活動が合うか']);
    case 'juten':
      return R('high', ['都道府県・市区町村が対象']);
  }
  return R('maybe');
}

/** すべての制度を照合して、合いそうな順に並べる。設定がまだなら空 */
export function matchPrograms(programs: readonly Program[], pf: Profile): ProgramMatch[] {
  if (!pf.kind) return [];
  const out: ProgramMatch[] = [];
  for (const p of programs) {
    const m = matchProgram(p, pf);
    if (m) out.push({ p, m });
  }
  return out.sort((a, b) => LV[a.m.lv].o - LV[b.m.lv].o);
}
