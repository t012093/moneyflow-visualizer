import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { parse } from 'node-html-parser';
import { z } from 'zod';
import type { UpdateItem } from '../../shared/types.ts';
import { importanceOf, STAGES, type StagedType } from './classify.ts';
import { ENRICH_MODEL } from './config.ts';
import type { PoliteClient } from './http.ts';
import { squash, truncate } from './text.ts';

/**
 * AIによる整形（任意）。ANTHROPIC_API_KEY があるときだけ動く。
 * 重要度の高い項目について、発表ページの本文を読み、分かりやすい題・要約・
 * 「何が変わる／だれに関係／いつから」を作る。規則による分類の取りこぼしも直す。
 */

const Enriched = z.object({
  title: z.string().describe('何が起きたかが分かる題。40字以内。発表にない評価の言葉は入れない'),
  summary: z.string().describe('1〜2文の要約。数字や日付は本文にあるものだけ'),
  what: z.string().describe('何が変わるか。本文から分からなければ「発表からは分かりません」'),
  who: z.string().describe('だれに関係するか'),
  when: z.string().describe('いつからか、いつまでか'),
  type: z.enum(['law', 'budget', 'tax', 'system', 'grant', 'news']),
  theme: z.enum(['social', 'debt', 'local', 'defense', 'infra', 'edu', 'industry', 'other', 'whole']),
  importance: z.number().describe('0〜100。暮らしやお金の流れへの影響が大きいほど高く'),
  noise: z.boolean().describe('人事・入札・会議資料の掲載など、多くの人に関係しない定型の発表なら true')
});
export type EnrichedFields = z.infer<typeof Enriched>;

const SYSTEM = [
  'あなたは、日本の国の発表を、ふつうの人に分かる言葉で整理する編集者です。',
  '与えられた題と本文だけを根拠にしてください。本文にない数字、日付、評価を足してはいけません。',
  '政策への賛否や、良い・悪いの判断は書きません。事実と仕組みだけを書きます。',
  '役所の言い回しは、意味を変えずに、短い日常の言葉に直します。',
  '分類の意味：law=法律、budget=予算・決算・予備費、tax=税、system=制度・計画・政令・意見募集、grant=補助金などの公募、news=それ以外。',
  '分野の意味：social=年金・医療・介護・子育て、debt=国債、local=地方、defense=防衛、infra=公共事業・防災、edu=教育・科学、industry=産業・エネルギー・農業、whole=予算全体・税、other=その他。'
].join('\n');

export interface Enricher {
  enrich(item: UpdateItem, pageText: string): Promise<EnrichedFields | null>;
}

export function createClaudeEnricher(client: Anthropic = new Anthropic(), model = ENRICH_MODEL): Enricher {
  return {
    async enrich(item, pageText) {
      const res = await client.beta.messages.parse({
        model,
        max_tokens: 4000,
        // 安全上の理由でモデルが答えを控えたとき、API側で別のモデルに引き継ぐ
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: SYSTEM,
        output_config: { effort: 'low', format: betaZodOutputFormat(Enriched) },
        messages: [{
          role: 'user',
          content: [
            `発表元：${item.ministry}`,
            `日付：${item.date}`,
            `題：${item.originalTitle ?? item.title}`,
            item.stage ? `いまの段階（規則による判定）：${item.stage.label}` : '',
            `本文（先頭の抜粋）：\n${pageText || '（本文は取得できませんでした。題だけで判断してください）'}`
          ].filter(Boolean).join('\n')
        }]
      });
      if (res.stop_reason === 'refusal') return null;
      return res.parsed_output ?? null;
    }
  };
}

/** ページの本文らしい部分を、文字だけにして返す。 */
export function mainText(html: string, max = 6000): string {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, nav, header, footer, noscript, form, aside')) el.remove();
  const main = root.querySelector('main') ?? root.querySelector('article') ?? root.querySelector('#main') ?? root.querySelector('#contents') ?? root.querySelector('body') ?? root;
  return truncate(squash(main.structuredText), max);
}

export function applyEnrichment(item: UpdateItem, r: EnrichedFields): UpdateItem {
  const typeChanged = r.type !== item.type;
  // 種類が変わったときは、段階の並びが合わなくなるので、合うものだけ残す
  const stage = !typeChanged ? item.stage : r.type !== 'news' && item.stage && STAGES[r.type as StagedType].includes(item.stage.label)
    ? { steps: STAGES[r.type as StagedType], index: STAGES[r.type as StagedType].indexOf(item.stage.label), label: item.stage.label }
    : undefined;
  const importance = Math.max(0, Math.min(100, Math.round(r.importance)));
  const next: UpdateItem = {
    ...item,
    title: truncate(r.title.trim(), 60) || item.title,
    originalTitle: item.originalTitle ?? item.title,
    summary: r.summary.trim(),
    qa: { what: r.what.trim(), who: r.who.trim(), when: r.when.trim() },
    type: r.type,
    theme: r.theme,
    importance: r.noise ? Math.min(importance, importanceOf(r.type, stage, '', undefined, true)) : importance,
    enriched: 'ai'
  };
  if (stage) next.stage = stage; else delete next.stage;
  if (r.noise) next.noise = true; else delete next.noise;
  return next;
}

/**
 * 本文を取りに行ってよいページか。
 * リンクはフィードに書かれていたもの（外から来た値）なので、国の機関のサイト（go.jp）の、PDFでないページだけに限る。
 * フィードが書きかえられても、手元のネットワークの中や関係のないサイトへは取りに行かない。
 */
export function isReadablePage(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && !u.username && !u.port && /(^|\.)go\.jp$/.test(u.hostname) && !/\.pdf$/i.test(u.pathname);
  } catch {
    return false;
  }
}

export interface EnrichOptions {
  limit: number;
  minImportance: number;
  log: (msg: string) => void;
}

/** 重要度の高い順に、まだ規則のままの項目をAIで整える。失敗した項目はそのまま残す。 */
export async function enrichItems(items: UpdateItem[], enricher: Enricher, http: PoliteClient, opts: EnrichOptions): Promise<{ items: UpdateItem[]; done: number }> {
  const targets = items
    .filter(i => i.enriched === 'rules' && !i.noise && i.importance >= opts.minImportance)
    .sort((a, b) => b.date.localeCompare(a.date) || b.importance - a.importance)
    .slice(0, opts.limit);
  const out = new Map(items.map(i => [i.id, i] as const));
  let done = 0;
  for (const item of targets) {
    try {
      const url = item.links[0]?.url ?? '';
      let text = '';
      if (isReadablePage(url)) {
        try { text = mainText((await http.get(url, { accept: 'text/html', conditional: false })).text); } catch { text = ''; }
      }
      const r = await enricher.enrich(item, text);
      if (r) { out.set(item.id, applyEnrichment(item, r)); done++; }
    } catch (e) {
      opts.log(`AIによる整形に失敗（そのまま残します）: ${item.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { items: items.map(i => out.get(i.id) ?? i), done };
}
