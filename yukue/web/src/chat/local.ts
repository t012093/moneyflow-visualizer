/**
 * かんたん応答：AIを使わず、手元の規則だけで答える。
 * プロトタイプの localAnswer とその仲間（ansTheme など）を、読み込んだデータに合わせて移したもの。
 * 答えの根拠は、画面に出しているデータだけ。
 */
import { AUD, CHAT_FOOTNOTE, CHAT_MODE_LABEL, LV, typeInfo, type AudId } from '../content.ts';
import { slashDate } from '../lib/dates.ts';
import { fmtCho } from '../lib/format.ts';
import { matchPrograms } from '../lib/match.ts';
import { profileSummary } from '../lib/profile.ts';
import { isPassedLaw, pickByTheme, resolveBriefing, stageName } from '../lib/updates.ts';
import { applyProgramOf } from '../state/store.ts';
import type { Program, ThemeId, UpdateItem } from '../types.ts';
import type { ChatContext, ChatProvider, ChatReply } from './types.ts';

/** 質問のことばから分野を当てる（上から順に見る） */
const THEME_RE: readonly (readonly [ThemeId, RegExp])[] = [
  ['debt', /借金|返済|利払|国債費/],
  ['social', /社会保障|年金|医療|介護|子育て|こども|子ども|児童|福祉/],
  ['defense', /防衛|自衛隊/],
  ['local', /地方|交付税|自治体/],
  ['infra', /公共事業|道路|防災|インフラ/],
  ['edu', /教育|科学|大学|高校|学校|研究/],
  ['industry', /産業|エネルギー|農業|中小企業|半導体/]
];

const matchTheme = (q: string, ctx: ChatContext): ThemeId | undefined =>
  THEME_RE.find(([id, re]) => re.test(q) && ctx.model.useById.has(id))?.[0];

const matchAud = (q: string): AudId =>
  /子育て|こども|子ども|家庭|出産/.test(q)
    ? 'family'
    : /中小|事業|企業|会社|店|フリーランス/.test(q)
      ? 'biz'
      : /NPO|ＮＰＯ|団体|法人/i.test(q)
        ? 'npo'
        : /自治体|市町村/.test(q)
          ? 'local'
          : /個人|自分|学び|医療費/.test(q)
            ? 'person'
            : 'all';

/** 「（国会審議）」のように段階を添える。段階のない発表には何も付けない */
const stageNote = (u: UpdateItem): string => {
  const s = stageName(u);
  return s ? `（${s}）` : '';
};

const NOT_IN_DATA = 'その条件に合う動きは、この試作版のデータには含まれていません。';

export function localAnswer(question: string, ctx: ChatContext): ChatReply {
  const q = question;
  const { model, state } = ctx;
  const quoted = (/「(.+?)」/.exec(q) ?? [])[1];
  if (quoted) {
    const u = model.updates.find(x => x.title === quoted);
    if (u) return ansUpdate(u);
    const p = model.programs.find(x => x.name === quoted);
    if (p) return p.apply && /申請|書類|提出/.test(q) ? ansApply(p) : ansProgram(p);
  }
  if (state.view === 'apply' && /申請|書類|そろえ|提出/.test(q)) {
    const p = applyProgramOf(model, state);
    if (p) return ansApply(p);
  }
  if (/私|わたし|自分|うち/.test(q) && /制度|補助金|助成|給付|使える|もらえる|合う/.test(q)) return ansMatched(ctx);
  if (/情報|プライバシー|設定/.test(q) && /使われ|扱|保存|渡/.test(q)) return ansPrivacy();
  const theme = matchTheme(q, ctx);
  if (/補助金|助成|給付|制度|支援|もらえる|使える|申請/.test(q)) return ansPrograms(matchAud(q), ctx);
  if (/きょう|今日|けさ|今朝|まとめ/.test(q)) return ansBrief(ctx);
  if (/最近|動き|ニュース|法律|法案|成立|決定/.test(q)) return ansUpdates(theme, /成立|公布|法律/.test(q), ctx);
  if (/一番|いちばん|最大|大きい|多い|順/.test(q)) return ansBiggest(ctx);
  if (/税収|財源|どこから|消費税|所得税|法人税|発行|全体のどれくらい/.test(q)) return ansRevenue(q, ctx);
  if (theme) return ansTheme(theme, ctx);
  return {
    text: `この試作版では、${model.fy.label}一般会計の流れ、最近の政策の動き、制度の一覧について答えられます。下の質問例から試してみてください。`
  };
}

function ansTheme(id: ThemeId, ctx: ChatContext): ChatReply {
  const { model } = ctx;
  const { fmt, fy } = model;
  const u = model.useById.get(id);
  if (!u) return { text: NOT_IN_DATA };
  const items = u.drill ? [...u.drill.items].sort((a, b) => b.v - a.v) : [];
  const rel = pickByTheme(model.updates, u.theme, 1, ctx.today)[0];
  let text = `${u.long || u.name}は${fmtCho(u.v)}で、一般会計の${fmt.pct(u.v)}にあたります。国民1人あたりにすると${fmt.pc(u.v)}です。`;
  const [i0, i1] = items;
  if (i0 && i1) text += `\n内訳で大きいのは${i0.name}（${fmtCho(i0.v)}）と${i1.name}（${fmtCho(i1.v)}）です。`;
  const a = u.trend?.[0];
  const b = u.trend?.[u.trend.length - 1];
  const y0 = fy.years[0];
  if (u.trend && u.trend.length > 1 && a != null && b != null && y0 != null) {
    text += `\n${y0}年度の${fmtCho(a)}から、${u.trend.length}年で${b > a ? `${fmtCho(b - a)}増えて` : b < a ? `${fmtCho(a - b)}減って` : '横ばいで'}います。`;
  }
  if (rel) text += `\n関連する最近の動きは「${rel.title}」${stageNote(rel)}です。`;
  return {
    text,
    action: { label: `お金の流れ › ${u.name} を表示`, run: { kind: 'flow', id, drill: true } },
    figure: items.length ? { title: `${u.name}の内訳`, items: items.map(i => ({ name: i.name, v: i.v, theme: u.theme })) } : undefined,
    source: `出典：${fy.srcChip}（内訳はサンプル）`
  };
}

function ansBiggest(ctx: ChatContext): ChatReply {
  const { model } = ctx;
  const { fmt } = model;
  const items = [...model.budget.use].sort((a, b) => b.v - a.v);
  const [a, b, c] = items;
  if (!a) return { text: NOT_IN_DATA };
  let text = `いちばん大きいのは${a.name}の${fmtCho(a.v)}で、全体の${fmt.pct(a.v)}です。`;
  if (b && c) {
    text += `次が${b.name}（${fmtCho(b.v)}）、${c.name}（${fmtCho(c.v)}）で、この3つで全体の${fmt.pct(a.v + b.v + c.v)}を占めます。`;
  }
  return {
    text,
    action: { label: 'お金の流れを表示', run: { kind: 'flow', id: a.id, drill: false } },
    figure: { title: '使いみち（大きい順）', items: items.map(i => ({ name: i.name, v: i.v, theme: i.theme })) },
    source: `出典：${model.fy.srcChip}`
  };
}

function ansRevenue(q: string, ctx: ChatContext): ChatReply {
  const { model } = ctx;
  const { fmt, fy } = model;
  const src = model.budget.src;
  const one = src.find(s => q.includes(s.name) || (s.alias ?? []).some(a => q.includes(a)));
  if (one) {
    return {
      text: `${one.name}は${fmtCho(one.v)}で、一般会計の財源の${fmt.pct(one.v)}です。${one.desc}`,
      action: { label: `お金の流れ › ${one.name} を表示`, run: { kind: 'flow', id: one.id, drill: false } },
      source: `出典：${fy.srcChip}`
    };
  }
  const items = [...src].sort((a, b) => b.v - a.v);
  const first = items[0];
  if (!first) return { text: NOT_IN_DATA };
  const tax = src.filter(s => s.tax).reduce((a, s) => a + s.v, 0);
  return {
    text: `財源${fmtCho(fy.total)}のうち、税収は${fmtCho(tax)}（${fmt.pct(tax)}）です。大きい順に${items
      .slice(0, 3)
      .map(s => `${s.name}（${fmtCho(s.v)}）`)
      .join('、')}。税で足りない分は国債の発行でまかなっています。`,
    action: { label: 'お金の流れを表示', run: { kind: 'flow', id: first.id, drill: false } },
    figure: { title: '財源（大きい順）', items: items.map(s => ({ name: s.name, v: s.v })) },
    source: `出典：${fy.srcChip}`
  };
}

function ansBrief(ctx: ChatContext): ChatReply {
  const { model } = ctx;
  const tops = resolveBriefing(model.data.briefing, model.updates).slice(0, 3);
  if (!tops.length) return ansUpdates(undefined, false, ctx);
  const names = [...new Set(tops.flatMap(t => t.update.links.map(l => l.name)))].slice(0, 4);
  return {
    text: `けさ集めた中で、とくに大きな動きは次の${tops.length}件です。\n${tops.map(t => `・${t.text}${stageNote(t.update)}`).join('\n')}`,
    action: { label: '政策の動きを表示', run: { kind: 'updates', type: 'all', theme: 'all' } },
    source: names.length ? `出典：${names.join('、')}` : undefined
  };
}

function ansUpdates(theme: ThemeId | undefined, lawsOnly: boolean, ctx: ChatContext): ChatReply {
  const { model } = ctx;
  const list = model.visibleUpdates.filter(u => (!theme || u.theme === theme) && (!lawsOnly || isPassedLaw(u))).slice(0, 4);
  if (!list.length) return { text: NOT_IN_DATA };
  const head = lawsOnly ? '最近、成立・公布された法律です。' : `${theme ? model.themeName(theme) + 'に関係する' : '最近の'}動きです。`;
  return {
    text: `${head}\n${list
      .map(u => {
        const s = stageName(u);
        return `・${slashDate(u.date)} ${u.title}（${typeInfo(u.type).n}${s ? '・' + s : ''}）`;
      })
      .join('\n')}`,
    action: { label: '政策の動きを表示', run: { kind: 'updates', type: lawsOnly ? 'law' : 'all', theme: theme ?? 'all' } },
    source: 'それぞれの一次情報は、一覧の各項目から開けます。'
  };
}

function ansUpdate(u: UpdateItem): ChatReply {
  const lines: string[] = [u.summary || u.title];
  if (u.qa) lines.push(`・何が変わる：${u.qa.what}`, `・だれに関係：${u.qa.who}`, `・いつから：${u.qa.when}`);
  const s = stageName(u);
  if (s) lines.push(`いまの段階は「${s}」です。`);
  return {
    text: lines.join('\n'),
    action: { label: 'この動きを開く', run: { kind: 'update', id: u.id } },
    source: u.links.length ? `出典：${u.links.map(l => l.name).join('、')}` : undefined
  };
}

function ansPrograms(aud: AudId, ctx: ChatContext): ChatReply {
  const list = ctx.model.programs.filter(p => aud === 'all' || p.aud.includes(aud));
  if (!list.length) return { text: 'その立場に合う制度は、このサンプルのデータには含まれていません。' };
  return {
    text: `${aud === 'all' ? 'サンプルに入っている' : AUD[aud] + 'が使える'}制度は${list.length}件あります。\n${list
      .slice(0, 5)
      .map(p => `・${p.name}：${p.amt}（${p.statusText}）`)
      .join('\n')}\n金額や締切はサンプルです。申請の前に、担当省庁のページで最新の条件を確認してください。`,
    action: { label: '制度をさがす を表示', run: { kind: 'programs', aud } }
  };
}

function ansProgram(p: Program): ChatReply {
  return {
    text: `${p.name}は、${p.who}が対象の${p.kind}です。金額の目安は${p.amt}（${p.amtNote}）、担当は${p.by}、いまの状態は「${p.statusText}」です。\n金額や締切はサンプルです。くわしい条件は担当省庁のページで確認してください。`,
    action: { label: '制度をさがす を表示', run: { kind: 'programs', aud: p.aud[0] ?? 'all' } }
  };
}

function ansMatched(ctx: ChatContext): ChatReply {
  const { model, state } = ctx;
  const pf = state.pf;
  if (!pf.kind) {
    return {
      text: 'まだ設定がありません。マイページで立場や家族のことを入れると、合う制度をお答えできます。入力は任意で、この端末に保存されます。',
      action: { label: 'マイページを開く', run: { kind: 'view', view: 'me' } }
    };
  }
  const ms = matchPrograms(model.programs, pf).filter(x => x.m.lv !== 'no');
  const summary = profileSummary(pf);
  if (!ms.length) {
    return {
      text: `いまの設定（${summary}）に合いそうな制度は、このサンプルのデータには含まれていません。`,
      action: { label: '制度をさがす を表示', run: { kind: 'programs', aud: 'all', matched: true } }
    };
  }
  return {
    text: `いまの設定（${summary}）に合いそうな制度は${ms.length}件です。\n${ms
      .slice(0, 5)
      .map(x => `・${x.p.name}：${LV[x.m.lv].n}${x.m.why[0] ? '（' + x.m.why[0] + '）' : ''}`)
      .join('\n')}\n判定はめやすです。正式な条件は、それぞれの募集要領で確認してください。`,
    action: { label: 'あなたに合う制度を表示', run: { kind: 'programs', aud: 'all', matched: true } }
  };
}

function ansApply(p: Program): ChatReply {
  const ap = p.apply;
  if (!ap) return ansProgram(p);
  return {
    text: `${p.name}の提出先は、${ap.where}です。${ap.whereNote}\nそろえるもの（サンプル）は次のとおりです。\n${ap.needs
      .map(n => `・${n.name}`)
      .join('\n')}\n提出はご本人が行います。正式に必要なものは、公募要領や窓口で確認してください。`,
    action: { label: '申請の準備を開く', run: { kind: 'apply', id: p.id } }
  };
}

function ansPrivacy(): ChatReply {
  return {
    text: '入れた設定は、この端末に保存されます。合う制度の判定と、申請の下書きにだけ使います。AIに質問するときは、設定の要約がAIに渡ります。渡したくないときは、マイページの「情報の扱い」でオフにできます。',
    action: { label: 'マイページを開く', run: { kind: 'view', view: 'me' } }
  };
}

/** 手元の規則で答える provider。答えはすぐに決まるので、逐次の表示（onText）は使わない */
export function createLocalProvider(): ChatProvider {
  return {
    modeLabel: CHAT_MODE_LABEL,
    footnote: CHAT_FOOTNOTE,
    ask: (question, context) => Promise.resolve(localAnswer(question, context))
  };
}
