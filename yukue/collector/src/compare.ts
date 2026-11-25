import type { UpdateItem } from '../../shared/types.ts';
import { isReadablePage, mainText, ungroundedNumbers, type Enricher, type EnrichedFields, type Usage } from './enrich.ts';
import type { PoliteClient } from './http.ts';

/**
 * AIによる整形を、同じ項目・同じ本文で、モデルを変えて比べる。
 * 一覧には書き込まず、人が読み比べるための報告（Markdown）だけを作る。
 */

/** 100万トークンあたりの料金（米ドル、2026年11月時点）。ここにないモデルは金額を出さない。 */
export const PRICES: Record<string, { input: number; output: number }> = {
  'claude-opus-5-5': { input: 4, output: 20 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5 }
};

export function costOf(model: string, usage: Usage): number | null {
  const p = PRICES[model];
  return p ? (usage.input * p.input + usage.output * p.output) / 1_000_000 : null;
}

/** 比べる項目をえらぶ。ふだんの整形と同じ条件（定型でない・重要度が高い）で、情報源がかたよらないように順に取る。 */
export function pickSamples(items: UpdateItem[], limit: number, minImportance = 50): UpdateItem[] {
  const pool = items
    .filter(i => i.sourceId !== 'curated' && !i.noise && i.importance >= minImportance)
    .sort((a, b) => b.importance - a.importance || b.date.localeCompare(a.date));
  const bySource = new Map<string, UpdateItem[]>();
  for (const i of pool) bySource.set(i.sourceId, [...(bySource.get(i.sourceId) ?? []), i]);
  const out: UpdateItem[] = [];
  while (out.length < limit && [...bySource.values()].some(q => q.length)) {
    for (const q of bySource.values()) {
      const next = q.shift();
      if (next && out.length < limit) out.push(next);
    }
  }
  return out;
}

export interface ModelResult {
  model: string;
  fields: EnrichedFields | null;
  error?: string;
  usage: Usage;
  ms: number;
  /** もとの題・本文に見当たらない数字 */
  ungrounded: string[];
}

export interface Comparison {
  item: UpdateItem;
  /** モデルに渡した本文（先頭の抜粋）。空なら、題だけで判断させた */
  pageText: string;
  results: ModelResult[];
}

export interface CompareOptions {
  models: string[];
  /** モデル名から、使用量を報告する整形役を作る */
  makeEnricher: (model: string, onUsage: (u: Usage) => void) => Enricher;
  log: (msg: string) => void;
}

export async function compareModels(samples: UpdateItem[], http: PoliteClient, opts: CompareOptions): Promise<Comparison[]> {
  const out: Comparison[] = [];
  for (const item of samples) {
    const base: UpdateItem = { ...item, title: item.originalTitle ?? item.title };
    const url = item.links[0]?.url ?? '';
    let pageText = '';
    if (isReadablePage(url)) {
      try { pageText = mainText((await http.get(url, { accept: 'text/html', conditional: false })).text); } catch { pageText = ''; }
    }
    const source = `${base.title}\n${item.ministry}\n${item.date}\n${item.stage?.label ?? ''}\n${pageText}`;
    const results: ModelResult[] = [];
    for (const model of opts.models) {
      const usage: Usage = { input: 0, output: 0 };
      const t0 = Date.now();
      try {
        const fields = await opts.makeEnricher(model, u => { usage.input += u.input; usage.output += u.output; }).enrich(base, pageText);
        results.push({ model, fields, usage, ms: Date.now() - t0, ungrounded: fields ? ungroundedNumbers(fields, source) : [] });
      } catch (e) {
        results.push({ model, fields: null, error: e instanceof Error ? e.message : String(e), usage, ms: Date.now() - t0, ungrounded: [] });
      }
    }
    opts.log(`${base.title.slice(0, 40)}  ${results.map(r => `${r.model}: ${r.fields ? 'ok' : r.error ? '失敗' : '回答なし'}`).join(' / ')}`);
    out.push({ item: base, pageText, results });
  }
  return out;
}

const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
const usd = (n: number | null) => (n == null ? '—' : `$${n.toFixed(n < 0.1 ? 4 : 2)}`);

/** 読み比べるための報告。上にモデルごとの集計、下に項目ごとの結果を並べる。 */
export function renderReport(comparisons: Comparison[], models: string[], generatedAt: string): string {
  const lines: string[] = ['# AIによる整形の比較', '', `作成：${generatedAt} ／ 項目：${comparisons.length}件 ／ モデル：${models.join('、')}`, ''];
  lines.push('## モデルごとの集計', '', '| モデル | 答えた件数 | 本文にない数字が出た件数 | 定型と判定 | 入力トークン | 出力トークン | 費用 | 1件あたり | 平均の時間 |', '|---|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const model of models) {
    const rs = comparisons.map(c => c.results.find(r => r.model === model)).filter((r): r is ModelResult => !!r);
    const ok = rs.filter(r => r.fields);
    const usage = rs.reduce((u, r) => ({ input: u.input + r.usage.input, output: u.output + r.usage.output }), { input: 0, output: 0 });
    const cost = costOf(model, usage);
    lines.push(`| ${model} | ${ok.length}/${rs.length} | ${ok.filter(r => r.ungrounded.length).length} | ${ok.filter(r => r.fields?.noise).length} | ${usage.input.toLocaleString('en-US')} | ${usage.output.toLocaleString('en-US')} | ${usd(cost)} | ${usd(cost != null && rs.length ? cost / rs.length : null)} | ${rs.length ? (rs.reduce((n, r) => n + r.ms, 0) / rs.length / 1000).toFixed(1) : '—'}秒 |`);
  }
  lines.push('', '「本文にない数字」は、整形した文に出てくる2桁以上の数字が、もとの題と本文に見当たらないものです。和暦と西暦の言いかえなどでも出るので、目安として、下の項目ごとの結果で中身を確かめてください。', '', '## 項目ごとの結果', '');
  comparisons.forEach((c, n) => {
    lines.push(`### ${n + 1}. ${c.item.title}`, '', `${c.item.date} ／ ${c.item.ministry} ／ 規則による分類：${c.item.type}・${c.item.theme}${c.item.stage ? `・${c.item.stage.label}` : ''} ／ 重要度 ${c.item.importance}`, '', c.item.links[0] ? `一次情報：${c.item.links[0].url}` : '', '', c.pageText ? `渡した本文：${c.pageText.length}字` : '渡した本文：なし（題だけで判断）', '');
    lines.push(`| | ${c.results.map(r => r.model).join(' | ')} |`, `|---|${c.results.map(() => '---').join('|')}|`);
    const row = (label: string, pick: (f: EnrichedFields, r: ModelResult) => string) =>
      lines.push(`| ${label} | ${c.results.map(r => (r.fields ? cell(pick(r.fields, r)) : r.error ? `失敗：${cell(r.error).slice(0, 80)}` : '回答なし')).join(' | ')} |`);
    row('題', f => f.title);
    row('要約', f => f.summary);
    row('何が変わる', f => f.what);
    row('だれに関係', f => f.who);
    row('いつから', f => f.when);
    row('分類', f => `${f.type}・${f.theme} ／ 重要度 ${Math.round(f.importance)}${f.noise ? ' ／ 定型' : ''}`);
    row('本文にない数字', (_f, r) => (r.ungrounded.length ? r.ungrounded.join('、') : 'なし'));
    lines.push('');
  });
  return lines.join('\n');
}
