import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import type { Briefing, JGrant, JGrantsFile, RunReport, SourceStatus, UpdateItem, UpdatesFile } from '../../shared/types.ts';
import { DATASET_HELP, runDatasetCommand } from './commands/datasets.ts';
import { DERIVE_HELP, runDeriveCommand } from './commands/derive.ts';
import { politeClient, type CommandFlags } from './commands/shared.ts';
import { DATA_DIR, ENRICH_LIMIT, env } from './config.ts';
import { compareModels, pickSamples, renderReport } from './compare.ts';
import { createClaudeEnricher, enrichItems } from './enrich.ts';
import { findFeedLinks, parseFeed } from './feeds.ts';
import type { PoliteClient } from './http.ts';
import { extractList } from './sources/list.ts';
import { allSources, classifyDefs } from './sources/registry.ts';
import type { Ctx } from './sources/types.ts';
import { buildBriefing, loadState, mergeReportSources, mergeUpdates, readArchive, readJson, rebuildFromArchive, reclassify, saveState, trackHealth, writeArchive, writeJson, type HealthState } from './store.ts';
import { jstDate } from './text.ts';

const HELP = `ゆくえ 収集システム

  node src/cli.ts collect [--only id,id] [--dry-run] [--no-enrich]
      各情報源から集めて、yukue/data に書き出す
        --only       指定した情報源だけ実行する（例：--only mof,kakugi）
        --dry-run    書き出さずに、結果だけ表示する
        --no-enrich  AIによる整形を行わない（ANTHROPIC_API_KEY があっても）

  node src/cli.ts health [--max-failures 回数]
      前回の実行の記録を見て、続けて失敗している情報源があれば、終了コード1で知らせる（既定は6回）

  node src/cli.ts discover <URL...>
      ページからフィード（RSS・Atom）のURLを探し、読めるかを確かめる
      フィードがないページでは、新着の並び（日付とリンク）を何件読み取れるかも表示する

  node src/cli.ts reclassify [--dry-run]
      分類の規則を直したあと、通信をせずに、手元の一覧（updates/latest.json）へ当て直す

  node src/cli.ts compare [--models a,b] [--limit 件数] [--out ファイル]
      AIによる整形を、同じ項目でモデルを変えて比べ、読み比べ用の報告（Markdown）を作る
      既定は claude-haiku-5-5 と claude-sonnet-5-5、10件、compare-report.md。一覧には書き込まない
      （ANTHROPIC_API_KEY が必要。API の費用がかかる）

  node src/cli.ts rebuild [--dry-run]
      一覧に残す期間や件数の決まりを変えたあと、月ごとの保管用ファイルから一覧を作り直す

  node src/cli.ts sources
      登録してある情報源の一覧を表示する
${DATASET_HELP}${DERIVE_HELP}`;

function newClient(state: Ctx['state']): PoliteClient {
  return politeClient(state.http);
}

async function collect(opts: { only?: string[]; dryRun: boolean; enrich: boolean }): Promise<number> {
  const now = new Date();
  const state = loadState(DATA_DIR);
  const http = newClient(state);
  const ctx: Ctx = { http, now, state, log: msg => console.log(`    ${msg}`) };
  const registered = allSources();
  const sources = registered.filter(s => !opts.only || opts.only.includes(s.id));
  if (!sources.length) { console.error('実行する情報源がありません。`sources` で一覧を確認してください。'); return 2; }
  const healthFile = join(DATA_DIR, 'state/health.json');
  const health = readJson<HealthState>(healthFile, {});

  const incoming: UpdateItem[] = [];
  const statuses: SourceStatus[] = [];
  let grants: JGrant[] | null = null;
  for (const s of sources) {
    const t0 = Date.now();
    const base = { id: s.id, name: s.name, kind: s.kind, url: s.url, checkedAt: now.toISOString() };
    try {
      const r = await s.run(ctx);
      incoming.push(...r.items);
      if (r.grants) grants = r.grants;
      statuses.push({ ...base, ok: true, fetched: r.fetched, added: 0, ...(r.unchanged ? { unchanged: true } : {}), ms: Date.now() - t0, ...trackHealth(health, s.id, true, now) });
      console.log(r.unchanged ? `  ○ ${s.name}: 前回から変化なし` : `  ○ ${s.name}: ${r.fetched}件を取得、${r.items.length}件を候補に`);
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      const h = trackHealth(health, s.id, false, now);
      statuses.push({ ...base, ok: false, fetched: 0, added: 0, error, ms: Date.now() - t0, ...h });
      console.log(`  × ${s.name}: ${error}${h.failures > 1 ? `（${h.failures}回続けて失敗）` : ''}`);
    }
  }

  const latestFile = join(DATA_DIR, 'updates/latest.json');
  const prev = readJson<UpdatesFile>(latestFile, { generatedAt: '', items: [] });
  const curated = readJson<UpdatesFile>(join(DATA_DIR, 'updates/curated.json'), { generatedAt: '', items: [] }).items;
  const merged = mergeUpdates(prev.items, curated, incoming, now);
  let items = merged.items;
  for (const st of statuses) st.added = merged.addedIds.filter(id => items.find(i => i.id === id)?.sourceId === st.id).length;

  let enriched = 0;
  if (opts.enrich && ENRICH_LIMIT > 0 && env('ANTHROPIC_API_KEY')) {
    const r = await enrichItems(items, createClaudeEnricher(), http, { limit: ENRICH_LIMIT, minImportance: 50, log: ctx.log });
    items = r.items;
    enriched = r.done;
  }

  const briefing = buildBriefing(items, readJson<Briefing | null>(join(DATA_DIR, 'briefing.json'), null), now);
  const reportFile = join(DATA_DIR, 'runs/latest.json');
  const report: RunReport = {
    startedAt: now.toISOString(),
    finishedAt: new Date().toISOString(),
    sources: mergeReportSources(readJson<RunReport | null>(reportFile, null), registered.map(s => s.id), statuses),
    totals: { fetched: statuses.reduce((n, s) => n + s.fetched, 0), added: merged.addedIds.length, items: items.length }
  };

  console.log(`\n  取得 ${report.totals.fetched}件 ／ 新しく加わったもの ${report.totals.added}件 ／ 一覧 ${items.length}件` + (enriched ? ` ／ AIで整形 ${enriched}件` : '') + ` ／ 通信 ${http.requests}回`);
  const fresh = items.filter(i => merged.addedIds.includes(i.id) && !i.noise).sort((a, b) => b.importance - a.importance).slice(0, 12);
  if (fresh.length) {
    console.log('\n  新しく加わったもの（重要度の高い順）');
    for (const i of fresh) console.log(`    ${String(i.importance).padStart(3)}  ${i.date}  [${i.type}/${i.theme}] ${i.title.slice(0, 60)}${i.stage ? `（${i.stage.label}）` : ''}`);
  }

  const allFailed = statuses.every(s => !s.ok);
  ciSummary(statuses, `取得 ${report.totals.fetched}件 ／ 新しく加わったもの ${report.totals.added}件 ／ 一覧 ${items.length}件` + (enriched ? ` ／ AIで整形 ${enriched}件` : '') + (opts.dryRun ? ' ／ 試運転（書き出しなし）' : ''), now);
  if (opts.dryRun) { console.log('\n  --dry-run のため、書き出していません。'); return allFailed ? 1 : 0; }
  if (!allFailed) {
    writeJson(latestFile, { generatedAt: now.toISOString(), items } satisfies UpdatesFile);
    const enrichedById = new Map(items.map(i => [i.id, i] as const));
    writeArchive(DATA_DIR, merged.touched.map(t => enrichedById.get(t.id) ?? t), now);
    writeJson(join(DATA_DIR, 'briefing.json'), briefing);
    if (grants) writeJson(join(DATA_DIR, 'programs/jgrants.json'), { generatedAt: now.toISOString(), items: grants } satisfies JGrantsFile);
    saveState(DATA_DIR, state, now);
  }
  writeJson(healthFile, Object.fromEntries(registered.filter(s => health[s.id]).map(s => [s.id, health[s.id]])));
  writeJson(reportFile, report);
  console.log(`\n  ${DATA_DIR} に書き出しました（${jstDate(now)}）。`);
  return allFailed ? 1 : 0;
}

/** GitHub Actions で動いているときは、実行のまとめのページに結果の表を出し、失敗を注意として目立たせる。 */
function ciSummary(statuses: SourceStatus[], totals: string, now: Date): void {
  const file = env('GITHUB_STEP_SUMMARY');
  if (!file) return;
  const cell = (v: string) => v.replace(/\|/g, '\\|').replace(/\s+/g, ' ');
  const rows = statuses.map(s => `| ${cell(s.name)} | ${s.ok ? (s.unchanged ? '○ 変化なし' : '○') : `× ${cell(s.error ?? '')}`} | ${s.fetched} | ${s.added} | ${(s.ms / 1000).toFixed(1)}秒 |`);
  try {
    appendFileSync(file, [`### ゆくえ 収集の結果（${jstDate(now)}）`, '', totals, '', '| 情報源 | 結果 | 取得 | 追加 | 時間 |', '|---|---|---:|---:|---:|', ...rows, ''].join('\n'));
  } catch { /* まとめが書けなくても、収集そのものは続ける */ }
  for (const s of statuses) if (!s.ok) console.log(`::warning title=取得できなかった情報源::${s.name}: ${(s.error ?? '').replace(/\r?\n/g, ' ')}`);
}

/** 続けて失敗している情報源があれば、終了コード1で知らせる。毎日の自動実行の最後に呼ぶ。 */
function checkHealth(maxFailures: number): number {
  const report = readJson<RunReport | null>(join(DATA_DIR, 'runs/latest.json'), null);
  if (!report) { console.error('実行の記録（runs/latest.json）がありません。先に collect を実行してください。'); return 1; }
  const failing = report.sources.filter(s => !s.ok);
  for (const s of failing) console.log(`  × ${s.name}: ${s.failures ?? 1}回続けて失敗（${s.error ?? '理由不明'}）${s.lastOk ? `／最後に成功したのは ${jstDate(new Date(s.lastOk))}` : ''}`);
  const bad = failing.filter(s => (s.failures ?? 1) >= maxFailures);
  if (!bad.length) { console.log(failing.length ? `  ${maxFailures}回以上続けて失敗している情報源はありません。` : '  すべての情報源が、前回の実行で取得できています。'); return 0; }
  console.error(`\n  ${bad.map(s => s.name).join('、')} が、${maxFailures}回以上続けて失敗しています。フィードやページの場所が変わっていないか、確かめてください。`);
  return 1;
}

async function discover(urls: string[]): Promise<number> {
  if (!urls.length) { console.error('URLを指定してください。例：node src/cli.ts discover https://www.mof.go.jp/'); return 2; }
  const http = newClient({ http: {}, seen: {}, gian: {} });
  for (const pageUrl of urls) {
    console.log(`\n${pageUrl}`);
    let candidates: string[] = [];
    try {
      const page = await http.get(pageUrl, { conditional: false });
      const body = page.text;
      // 渡されたURLそのものがフィードなら、それを確かめて終わる
      if (/^\s*(<\?xml|<rss|<rdf:RDF|<feed)/i.test(body)) candidates = [pageUrl];
      else {
        candidates = findFeedLinks(body, pageUrl);
        const list = extractList(body, page.url, new Date());
        if (list.length) {
          const dates = list.map(e => e.date).sort();
          console.log(`  新着の並びとして、日付つきのリンクを${list.length}件読み取れます（${dates[0]} 〜 ${dates[dates.length - 1]}）`);
          for (const e of list.slice(0, 3)) console.log(`      ${e.date}  ${e.title.slice(0, 50)}`);
          console.log('      → フィードがなければ、sources/registry.ts の LIST_PAGES に足せます');
        } else console.log('  新着の並び（日付とリンク）は読み取れませんでした');
      }
    } catch (e) {
      // ページそのものが取れないときは、同じサイトをそれ以上たたかない
      console.log(`  ページを取得できませんでした: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    if (!candidates.length) {
      console.log('  <link rel="alternate"> が見つからないので、よくある場所を試します');
      candidates = ['/rss.xml', '/news.rss', '/news.rdf', '/index.rdf', '/rss/news.xml', '/feed'].map(p => new URL(p, pageUrl).toString());
    }
    for (const c of candidates) {
      try {
        const got = await http.get(c, { conditional: false });
        const feed = parseFeed(got.text, got.url);
        const newest = feed.entries.map(e => e.date).filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0];
        console.log(`  ○ ${c}\n      「${feed.title}」 ${feed.entries.length}件、最新 ${newest ? jstDate(newest) : '日付なし'}`);
      } catch (e) {
        console.log(`  × ${c}  ${e instanceof Error ? e.message.slice(0, 80) : String(e)}`);
      }
    }
  }
  return 0;
}

/** 分類の規則を、手元の一覧に当て直す。通信はしない。 */
function reclassifyLatest(dryRun: boolean): number {
  const file = join(DATA_DIR, 'updates/latest.json');
  const latest = readJson<UpdatesFile | null>(file, null);
  if (!latest) { console.error('一覧（updates/latest.json）がありません。先に collect を実行してください。'); return 1; }
  const r = reclassify(latest.items, classifyDefs());
  const before = new Map(latest.items.map(i => [i.id, i] as const));
  for (const i of r.changed.slice(0, 40)) {
    const old = before.get(i.id)!;
    const show = (x: UpdateItem) => `${x.type}/${x.theme}${x.stage ? `/${x.stage.label}` : ''} ${x.importance}${x.noise ? ' 定型' : ''}`;
    console.log(`  ${show(old)}  →  ${show(i)}   ${i.title.slice(0, 44)}`);
  }
  console.log(`\n  ${r.changed.length}件の分類が変わりました（全${latest.items.length}件）。`);
  if (dryRun) { console.log('  --dry-run のため、書き出していません。'); return 0; }
  if (r.changed.length) {
    const now = new Date();
    writeJson(file, { generatedAt: latest.generatedAt, items: r.items } satisfies UpdatesFile);
    writeArchive(DATA_DIR, r.changed, now);
    writeJson(join(DATA_DIR, 'briefing.json'), buildBriefing(r.items, readJson<Briefing | null>(join(DATA_DIR, 'briefing.json'), null), now));
  }
  return 0;
}

/** モデルを変えて整形を比べる。一覧には書き込まない。 */
async function compare(models: string[], limit: number, out: string): Promise<number> {
  if (!env('ANTHROPIC_API_KEY')) { console.error('ANTHROPIC_API_KEY が設定されていません。比較には API の利用（費用がかかります）が必要です。'); return 2; }
  const latest = readJson<UpdatesFile | null>(join(DATA_DIR, 'updates/latest.json'), null);
  if (!latest) { console.error('一覧（updates/latest.json）がありません。先に collect を実行してください。'); return 1; }
  const samples = pickSamples(latest.items, limit);
  if (!samples.length) { console.error('比べられる項目（定型でなく、重要度の高いもの）がありません。'); return 1; }
  console.log(`  ${samples.length}件を、${models.join(' と ')} で整形します`);
  const http = newClient({ http: {}, seen: {}, gian: {} });
  const results = await compareModels(samples, http, { models, makeEnricher: (model, onUsage) => createClaudeEnricher(undefined, model, onUsage), log: msg => console.log(`    ${msg}`) });
  const report = renderReport(results, models, new Date().toISOString());
  writeFileSync(out, report + '\n');
  const summary = env('GITHUB_STEP_SUMMARY');
  if (summary) { try { appendFileSync(summary, report + '\n'); } catch { /* まとめが書けなくても続ける */ } }
  console.log(`\n${report.split('## 項目ごとの結果')[0]}\n  報告を ${out} に書き出しました。`);
  return results.some(c => c.results.some(r => r.fields)) ? 0 : 1;
}

/** 保管用ファイルから一覧を作り直す。通信はしない。 */
function rebuildLatest(dryRun: boolean): number {
  const file = join(DATA_DIR, 'updates/latest.json');
  const latest = readJson<UpdatesFile>(file, { generatedAt: '', items: [] });
  const curated = readJson<UpdatesFile>(join(DATA_DIR, 'updates/curated.json'), { generatedAt: '', items: [] }).items;
  const now = new Date();
  const r = rebuildFromArchive(latest.items, curated, readArchive(DATA_DIR), now);
  const before = new Set(latest.items.map(i => i.id));
  const after = new Set(r.items.map(i => i.id));
  const back = r.items.filter(i => !before.has(i.id));
  for (const i of [...back].sort((a, b) => b.importance - a.importance).slice(0, 15)) console.log(`  ＋ ${String(i.importance).padStart(3)}  ${i.date}  ${i.title.slice(0, 50)}`);
  console.log(`\n  一覧 ${latest.items.length}件 → ${r.items.length}件（戻したもの ${back.length}件、外したもの ${latest.items.filter(i => !after.has(i.id)).length}件）`);
  if (dryRun) { console.log('  --dry-run のため、書き出していません。'); return 0; }
  writeJson(file, { generatedAt: latest.generatedAt || now.toISOString(), items: r.items } satisfies UpdatesFile);
  writeJson(join(DATA_DIR, 'briefing.json'), buildBriefing(r.items, readJson<Briefing | null>(join(DATA_DIR, 'briefing.json'), null), now));
  return 0;
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    only: { type: 'string' }, 'dry-run': { type: 'boolean', default: false }, 'no-enrich': { type: 'boolean', default: false }, 'max-failures': { type: 'string' },
    models: { type: 'string' }, limit: { type: 'string' }, out: { type: 'string' },
    force: { type: 'boolean', default: false }, full: { type: 'boolean', default: false }, year: { type: 'string' }, model: { type: 'string' },
    help: { type: 'boolean', short: 'h', default: false }
  }
});
const flags: CommandFlags = { dryRun: values['dry-run'], force: values.force, full: values.full, only: values.only, limit: values.limit, year: values.year, model: values.model, out: values.out };
const [command, ...rest] = positionals;
let code = 0;
if (values.help || !command) console.log(HELP);
else if (command === 'collect') code = await collect({ only: values.only?.split(',').map(s => s.trim()).filter(Boolean), dryRun: values['dry-run'], enrich: !values['no-enrich'] });
else if (command === 'health') {
  const max = Number(values['max-failures'] ?? 6);
  if (!Number.isInteger(max) || max < 1) { console.error('--max-failures は1以上の整数で指定してください。'); code = 2; }
  else code = checkHealth(max);
}
else if (command === 'reclassify') code = reclassifyLatest(values['dry-run']);
else if (command === 'rebuild') code = rebuildLatest(values['dry-run']);
else if (command === 'compare') {
  const models = (values.models ?? 'claude-haiku-5-5,claude-sonnet-5-5').split(',').map(m => m.trim()).filter(Boolean);
  const limit = Number(values.limit ?? 10);
  if (models.length < 1 || !Number.isInteger(limit) || limit < 1 || limit > 50) { console.error('--models はカンマ区切り、--limit は1〜50の整数で指定してください。'); code = 2; }
  else code = await compare(models, limit, values.out ?? 'compare-report.md');
}
else if (command === 'discover') code = await discover(rest);
else if (command === 'sources') for (const s of allSources()) console.log(`${s.id.padEnd(12)} ${s.kind.padEnd(5)} ${s.name}  ${s.url}`);
else {
  const ext = (await runDatasetCommand(command, rest, flags)) ?? (await runDeriveCommand(command, rest, flags));
  if (ext === undefined) { console.error(`知らないコマンドです: ${command}\n\n${HELP}`); code = 2; }
  else code = ext;
}
process.exitCode = code;
