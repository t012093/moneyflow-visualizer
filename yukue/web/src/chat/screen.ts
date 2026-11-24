/** 「いま見ている画面」の言い方と、画面に合わせた質問の例。 */
import { AUD, VIEW_NAMES } from '../content.ts';
import type { Model } from '../data/model.ts';
import { applyProgramOf, currentFlow, findModeOf, type UiState } from '../state/store.ts';

/** 例：「お金の流れ › 防衛 › 装備品の購入・開発」 */
export function screenLabel(model: Model, st: UiState): string {
  let t = VIEW_NAMES[st.view];
  if (st.view === 'flow') {
    const open = st.path[0] ? model.useById.get(st.path[0]) : undefined;
    if (open) t += ' › ' + open.name;
    const name = currentFlow(model, st).node?.name;
    if (name && (!open || name !== open.name)) t += ' › ' + name;
  }
  if (st.view === 'updates' && st.openUp) {
    const u = model.upById.get(st.openUp);
    if (u) t += ' › ' + u.title;
  }
  if (st.view === 'find') {
    const mode = findModeOf(st);
    if (mode === 'jgrants') t += ' › 受付中の補助金（Jグランツ）';
    else if (mode === 'match') t += ' › あなたに合う制度';
    else if (st.aud !== 'all') t += ' › ' + AUD[st.aud];
  }
  if (st.view === 'apply') {
    const p = applyProgramOf(model, st);
    if (p) t += ' › ' + p.name;
  }
  return t;
}

/** 入力欄の上に出す質問の例 */
export function suggestions(model: Model, st: UiState): string[] {
  if (st.view === 'flow') {
    const nd = currentFlow(model, st).node;
    if (nd && model.useById.has(nd.id)) {
      return [`${nd.name}は何に使われているの？`, `${nd.name}に関係する最近の動きは？`, 'いちばん大きい支出は？'];
    }
    if (nd && model.srcById.has(nd.id)) return [`${nd.name}は全体のどれくらい？`, '税収はどこから来ている？', 'いちばん大きい支出は？'];
    return ['いちばん大きい支出は？', '国の借金の返済にいくら使っている？', '税収はどこから来ている？'];
  }
  if (st.view === 'updates') return ['きょうの動きをまとめて教えて', '最近、成立した法律は？', '社会保障に関係する動きは？'];
  if (st.view === 'find') {
    return st.pf.kind
      ? ['私に合う制度は？', '中小企業が申請できる補助金は？', 'NPOが使える助成は？']
      : ['子育て世帯が使える制度は？', '中小企業が申請できる補助金は？', 'NPOが使える助成は？'];
  }
  if (st.view === 'me') return ['私に合う制度は？', '入れた情報は何に使われるの？'];
  if (st.view === 'apply') {
    const p = applyProgramOf(model, st);
    return p ? [`「${p.name}」の申請で気をつけることは？`, '私に合う制度は？'] : ['私に合う制度は？'];
  }
  if (st.view === 'connect') return ['防衛費は何に使われているの？', '社会保障の内訳を見せて'];
  return ['きょうの動きをまとめて教えて', '国の借金の返済にいくら使っている？', '子育て世帯が使える制度は？'];
}
