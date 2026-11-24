import { describe, expect, it } from 'vitest';
import { budget } from '../test/fixtures.ts';
import { cleanBriefing, cleanCalendar, cleanJGrants, cleanPrograms, cleanRun, cleanUpdates, isBudget } from './load.ts';

describe('読み込んだデータの形を確かめる', () => {
  it('収集の記録：情報源ごとの新しい項目（変化なし・確認の日時・続けて失敗した回数・最後の成功）を残す', () => {
    const run = cleanRun({
      startedAt: '2026-11-24T22:38:54.219Z',
      finishedAt: '2026-11-24T22:38:55.789Z',
      sources: [
        { id: 'mof', name: '財務省 新着情報', kind: 'rss', url: 'https://www.mof.go.jp/news.rss', ok: true, fetched: 0, added: 0, unchanged: true, ms: 1724, checkedAt: '2026-11-24T22:35:43.761Z', failures: 0, lastOk: '2026-11-24T22:35:43.761Z' },
        { id: 'env', name: '環境省 報道発表', kind: 'html', url: 'https://www.env.go.jp/press/index.html', ok: false, fetched: 0, added: 0, error: 'HTTP 503', ms: 30000, checkedAt: '2026-11-24T22:35:43.761Z', failures: 3, lastOk: '2026-11-23T09:17:00.000Z' },
        { id: 'jgrants', name: 'Jグランツ', kind: 'api', url: '', ok: true, fetched: 624, added: 0, ms: 7243 },
        { name: 'IDのない情報源', kind: 'なにか', ok: 'yes', fetched: '3' },
        'こわれた行'
      ],
      totals: { fetched: 145, added: 27, items: 466 }
    });
    expect(run?.sources).toHaveLength(4);
    expect(run?.sources[0]).toMatchObject({ id: 'mof', ok: true, unchanged: true, checkedAt: '2026-11-24T22:35:43.761Z', lastOk: '2026-11-24T22:35:43.761Z' });
    expect(run?.sources[0]?.failures).toBeUndefined();
    expect(run?.sources[1]).toMatchObject({ id: 'env', ok: false, error: 'HTTP 503', failures: 3, lastOk: '2026-11-23T09:17:00.000Z' });
    expect(run?.sources[1]?.unchanged).toBeUndefined();
    expect(run?.sources[2]).toMatchObject({ id: 'jgrants', kind: 'api', fetched: 624 });
    expect(run?.sources[2]?.checkedAt).toBeUndefined();
    // 形のおかしい値は、無難な値に読みかえる
    expect(run?.sources[3]).toMatchObject({ id: 'IDのない情報源', kind: 'html', ok: false, fetched: 0, added: 0, url: '', ms: 0 });
    expect(run?.totals).toEqual({ fetched: 145, added: 27, items: 466 });
    expect(cleanRun({ sources: [] })).toEqual({ startedAt: '', finishedAt: '', sources: [], totals: { fetched: 0, added: 0, items: 0 } });
    expect(cleanRun(null)).toBeNull();
    expect(cleanRun({ totals: {} })).toBeNull();
  });

  it('政策の動き：こわれた項目は捨て、知らない種類は「発表」、知らない分野は「その他」にする', () => {
    const file = cleanUpdates({
      generatedAt: '2026-11-24T22:06:48.044Z',
      items: [
        { id: 'a', date: '2026-11-24', type: 'law', theme: 'social', title: '題', originalTitle: '正式な名前', summary: '要約', ministry: '省', deadline: '2026-12-14', stage: { steps: ['提出', '成立'], index: 1, label: '成立' }, qa: { what: 'w', who: 'h', when: 'n' }, links: [{ name: 'x', url: 'https://example.go.jp/#:~:text=a' }, { name: 1 }], sourceId: 's', firstSeen: 't', importance: 70, noise: false, enriched: 'ai' },
        { id: 'b', date: '2026-11-24', type: 'mystery', theme: 'unknown', title: '最小の項目' },
        { id: 'a', date: '2026-11-24', type: 'news', theme: 'other', title: '同じIDの2つめ' },
        { id: 'c', date: 'きのう', type: 'news', theme: 'other', title: '日付が読めない' },
        { id: 'd', date: '2026-11-24', type: 'news', theme: 'other', title: '形のおかしい項目', stage: { steps: [], index: 0 }, qa: { what: 'だけ' }, deadline: '12月中', amount: '', links: 'なし', importance: '高い', enriched: 'なにか' },
        { title: 'IDがない' },
        null
      ]
    });
    expect(file?.items.map(u => u.id)).toEqual(['a', 'b', 'd']);
    expect(file?.items[0]).toMatchObject({ type: 'law', theme: 'social', originalTitle: '正式な名前', deadline: '2026-12-14', enriched: 'ai', noise: false });
    // リンクは形の合うものだけ。URLは書きかえない
    expect(file?.items[0]?.links).toEqual([{ name: 'x', url: 'https://example.go.jp/#:~:text=a' }]);
    expect(file?.items[1]).toEqual({
      id: 'b',
      date: '2026-11-24',
      type: 'news',
      theme: 'other',
      title: '最小の項目',
      originalTitle: undefined,
      summary: '',
      ministry: '',
      amount: undefined,
      stage: undefined,
      deadline: undefined,
      qa: undefined,
      links: [],
      sourceId: '',
      firstSeen: '',
      importance: 0,
      noise: false,
      enriched: 'rules'
    });
    expect(file?.items[2]).toMatchObject({ stage: undefined, qa: undefined, deadline: undefined, amount: undefined, links: [], importance: 0, enriched: 'rules' });
    expect(cleanUpdates({ items: 'ない' })).toBeNull();
  });

  it('制度・補助金・きょうの動き・予定も、形の合う項目だけを通す', () => {
    const programs = cleanPrograms([
      { id: 'p1', name: '制度', kind: '給付', aud: ['family', 'だれか'], theme: 'social', amt: '月1万円', amtNote: '', who: '', by: '', status: 'open', statusText: '受付中', link: { name: '省', url: 'https://example.go.jp/' }, apply: { where: '窓口', whereNote: '', url: 'https://example.go.jp/a', needs: [{ id: 'n', name: '書類', note: '' }, { name: 'IDなし' }], draft: { q1: 'Q1', q1ph: '', q2: 'Q2', q2ph: '', parts: [{ id: 'x', name: '概要' }] } } },
      { id: 'p2', name: '最小の制度' },
      { name: 'IDなし' }
    ]);
    expect(programs?.map(p => p.id)).toEqual(['p1', 'p2']);
    expect(programs?.[0]).toMatchObject({ aud: ['family'], status: 'open', theme: 'social' });
    expect(programs?.[0]?.apply?.needs).toEqual([{ id: 'n', name: '書類', note: '' }]);
    expect(programs?.[0]?.apply?.draft?.parts).toEqual([{ id: 'x', name: '概要' }]);
    expect(programs?.[1]).toMatchObject({ aud: [], theme: 'other', status: 'always', link: { name: '', url: '' }, apply: undefined });
    expect(cleanPrograms({})).toBeNull();

    const grants = cleanJGrants({ generatedAt: 't', items: [{ id: 'g', title: '補助金', area: '全国', maxAmount: 2000000, start: '2026-11-01', end: '2026-12-14', employees: '20名以下', url: 'https://www.jgrants-portal.go.jp/subsidy/g' }, { id: 'h', title: '最小' }, { title: 'IDなし' }] });
    expect(grants?.items).toEqual([
      { id: 'g', title: '補助金', area: '全国', maxAmount: 2000000, start: '2026-11-01', end: '2026-12-14', employees: '20名以下', url: 'https://www.jgrants-portal.go.jp/subsidy/g' },
      { id: 'h', title: '最小', area: '', maxAmount: null, start: null, end: null, employees: null, url: '' }
    ]);

    expect(cleanBriefing({ date: '2026-11-25', method: 'ai', items: [{ id: 'a', text: 'まとめ' }, { text: 'IDなし' }] })).toEqual({ date: '2026-11-25', generatedAt: '', method: 'ai', items: [{ id: 'a', text: 'まとめ' }] });
    expect(cleanBriefing({ items: [] })?.method).toBe('rules');
    expect(cleanCalendar([{ date: '2026-12-14', when: '12.14 月', title: '締切', note: 'n', updateId: 'u' }, { title: '日付なし' }])).toEqual([{ date: '2026-12-14', when: '12.14 月', title: '締切', note: 'n', updateId: 'u' }]);
    expect(cleanCalendar('x')).toBeNull();
  });

  it('予算：人が整えるファイルなので、形がちがえば全体を通さない', () => {
    expect(isBudget(budget)).toBe(true);
    expect(isBudget({ ...budget, use: [] })).toBe(false);
    expect(isBudget({ ...budget, fy: { ...budget.fy, total: 0 } })).toBe(false);
    expect(isBudget({ ...budget, src: [{ id: 'x', name: '名前だけ' }] })).toBe(false);
    expect(isBudget({ ...budget, use: [{ ...budget.use[0], drill: { items: [{ id: 'i', name: '内訳', v: 1, desc: '' }] } }] })).toBe(false);
    expect(isBudget(null)).toBe(false);
  });
});
