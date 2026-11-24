/** テスト用の小さなデータ。数字は令和8年度当初予算の画面用データと同じ並び。 */
import { buildModel, type Model } from '../data/model.ts';
import type { AppData } from '../data/load.ts';
import type { BudgetFile, Program, UpdateItem } from '../types.ts';

export const budget: BudgetFile = {
  fy: {
    label: '令和8年度',
    west: '2026年度',
    kind: '一般会計・当初予算',
    total: 122.31,
    pop: 1.2243e8,
    popNote: '総人口 約1億2,243万人',
    years: [2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026],
    trend: [97.5, 97.7, 101.5, 102.7, 106.6, 107.6, 114.4, 112.6, 115.2, 122.3],
    poolDesc: '国の基本的な財布です。',
    lifeNote: '',
    capRoot: '出典：財務省「令和8年度予算」',
    capDrill: '内訳の一部と、届け先ごとの金額は画面確認用のサンプルです。',
    srcShort: '出典：財務省「令和8年度予算」（当初）',
    srcDrill: '内訳の一部と届け先はサンプル',
    srcChip: '財務省「令和8年度予算」',
    sampleNote: '内訳の一部、届け先はサンプル。'
  },
  themes: {
    social: { name: '社会保障', c: '--t1' },
    debt: { name: '国債', c: '--t2' },
    local: { name: '地方', c: '--t3' },
    defense: { name: '防衛', c: '--t4' },
    infra: { name: '公共事業・防災', c: '--t5' },
    edu: { name: '教育・科学', c: '--t6' },
    industry: { name: '産業・エネルギー', c: '--t7' },
    other: { name: 'その他', c: '--t0' },
    whole: { name: '予算全体・税', c: '--flow-neutral' }
  },
  src: [
    { id: 'consumption', name: '消費税', v: 26.69, tax: true, desc: '買い物のときに払う税。' },
    { id: 'income', name: '所得税', v: 25.33, tax: true, desc: '給料や事業のもうけにかかる税。' },
    { id: 'corp', name: '法人税', v: 20.7, tax: true, desc: '会社のもうけにかかる税。' },
    { id: 'othertax', name: 'その他の税', v: 11.03, tax: true, desc: '相続税など。' },
    { id: 'bond', name: '国債（借金）', short: '国債', v: 29.58, alias: ['国債', '借金', '公債'], desc: '足りない分を借りる。' },
    { id: 'otherrev', name: 'その他収入', v: 8.99, desc: '税以外の収入。' }
  ],
  recips: {
    elder: '年金の受給者',
    insurer: '医療保険（病院への支払い）',
    family: '子育て世帯',
    person: '個人・世帯',
    muni: '自治体',
    sdf: '自衛隊員（給与など）',
    dind: '国内の防衛関連企業',
    fms: '海外からの調達',
    build: '建設事業者',
    biz: '事業者'
  },
  use: [
    {
      id: 'social',
      name: '社会保障',
      long: '社会保障関係費',
      v: 39.06,
      theme: 'social',
      desc: '年金・医療・介護・子育てなど。',
      trend: [32.5, 33.0, 34.1, 35.9, 35.8, 36.3, 36.9, 37.7, 38.3, 39.1],
      drill: {
        items: [
          { id: 's-pension', name: '年金', v: 13.9, desc: '', to: { elder: 13.9 } },
          { id: 's-medical', name: '医療', v: 12.7, desc: '', to: { insurer: 12.7 } },
          { id: 's-welfare', name: '生活保護・福祉', v: 4.4, desc: '', to: { muni: 3.1, person: 1.3 } },
          { id: 's-care', name: '介護', v: 3.8, desc: '', to: { muni: 3.8 } },
          { id: 's-child', name: '子ども・子育て', v: 3.5, desc: '', to: { family: 2.6, muni: 0.9 } },
          { id: 's-health', name: '保健・衛生', v: 0.5, desc: '', to: { muni: 0.3, biz: 0.2 } },
          { id: 's-work', name: '雇用・労災', v: 0.26, desc: '', to: { person: 0.26 } }
        ]
      }
    },
    { id: 'debt', name: '国債費', long: '国債費', v: 31.28, theme: 'debt', desc: '国債の返済と利子。' },
    { id: 'local', name: '地方交付税', long: '地方交付税交付金など', v: 20.88, theme: 'local', desc: '自治体へ配るお金。' },
    {
      id: 'defense',
      name: '防衛',
      long: '防衛関係費',
      v: 8.98,
      theme: 'defense',
      desc: '自衛隊の人件費、装備品など。',
      trend: [5.1, 5.2, 5.3, 5.3, 5.3, 5.4, 6.8, 7.9, 8.7, 9.0],
      drill: {
        items: [
          { id: 'f-equip', name: '装備品の購入・開発', v: 3.6, desc: '', to: { dind: 2.6, fms: 1.0 } },
          { id: 'f-staff', name: '人件・糧食費', v: 2.3, desc: '', to: { sdf: 2.3 } },
          { id: 'f-maint', name: '維持整備・弾薬・燃料', v: 2.2, desc: '', to: { dind: 1.9, fms: 0.3 } },
          { id: 'f-base', name: '施設・基地対策', v: 0.88, desc: '', to: { build: 0.48, muni: 0.4 } }
        ]
      }
    },
    { id: 'infra', name: '公共事業', long: '公共事業関係費', v: 6.11, theme: 'infra', desc: 'インフラの整備と維持。' },
    { id: 'edu', name: '教育・科学', long: '文教及び科学振興費', v: 6.04, theme: 'edu', desc: '教育と研究。' },
    { id: 'industry', name: '産業・エネルギー', short: '産業・エネ', long: '産業・エネルギー', v: 2.24, theme: 'industry', desc: '食料・エネルギー・中小企業。' },
    { id: 'other', name: 'その他', long: 'その他', v: 7.72, theme: 'other', desc: '行政の運営など。' }
  ],
  life: [{ k: '執行', d: 'いまここ', s: 'now' }],
  tiles: [{ label: '税収', value: '83.7', unit: '兆円', delta: '', series: [77.8, 83.7] }]
};

export function update(over: Partial<UpdateItem> & { id: string }): UpdateItem {
  return {
    date: '2026-11-24',
    type: 'news',
    theme: 'other',
    title: over.id,
    summary: '',
    ministry: '',
    links: [],
    sourceId: 'test',
    firstSeen: '2026-11-24T00:00:00.000Z',
    importance: 50,
    enriched: 'rules',
    ...over
  };
}

export function program(over: Partial<Program> & { id: string }): Program {
  return {
    name: over.id,
    kind: '給付',
    aud: ['person'],
    theme: 'social',
    amt: '',
    amtNote: '',
    who: '',
    by: '',
    status: 'always',
    statusText: '通年',
    link: { name: '', url: '' },
    ...over
  };
}

/** プロトタイプと同じ id の制度（規則は id で決まる） */
export const programs: Program[] = [
  program({ id: 'jidou', name: '児童手当', aud: ['family'], apply: { where: '市区町村', whereNote: '', url: 'https://myna.go.jp/', needs: [{ id: 'id', name: '本人確認書類', note: '' }], draft: null } }),
  program({ id: 'shugaku', name: '高等学校等就学支援金', aud: ['family'], theme: 'edu' }),
  program({ id: 'kunren', name: '教育訓練給付金', aud: ['person'] }),
  program({ id: 'kougaku', name: '高額療養費制度', aud: ['person', 'family'] }),
  program({ id: 'jizoku-p', name: '小規模事業者持続化補助金（創業型）第4回', kind: '補助金', aud: ['biz'], theme: 'industry' }),
  program({ id: 'gx-p', name: 'GX地域共創補助金2026（2次公募）', kind: '補助金', aud: ['biz'], theme: 'industry' }),
  program({ id: 'gyomu', name: '業務改善助成金', kind: '助成金', aud: ['biz', 'npo'], theme: 'industry' }),
  program({ id: 'career', name: 'キャリアアップ助成金（正社員化コース）', kind: '助成金', aud: ['biz', 'npo'] }),
  program({ id: 'kyumin', name: '休眠預金等活用事業', kind: '助成', aud: ['npo'], theme: 'other' }),
  program({ id: 'juten', name: '重点支援地方交付金', kind: '交付金', aud: ['local'], theme: 'local' })
];

export function appData(over: Partial<AppData> = {}): AppData {
  return {
    budget,
    updates: { generatedAt: '2026-11-24T09:00:00.000Z', items: [] },
    programs,
    briefing: null,
    calendar: [],
    jgrants: { generatedAt: '', items: [] },
    run: null,
    missing: [],
    ...over
  };
}

export const makeModel = (over: Partial<AppData> = {}): Model => buildModel(appData(over));
