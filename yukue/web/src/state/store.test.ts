import { describe, expect, it } from 'vitest';
import { PAGE_SIZE, type ViewId } from '../content.ts';
import { POOL_ID, recipNodeId } from '../lib/flowModel.ts';
import { makeModel, update } from '../test/fixtures.ts';
import { AppStore, applyProgramOf, currentFlow, findModeOf, viewFromHash, type Env } from './store.ts';

function setup(opts: { hash?: string; overlay?: boolean; updates?: ReturnType<typeof update>[] } = {}) {
  const env = {
    hash: opts.hash ?? '',
    overlay: opts.overlay ?? false,
    readHash(): string {
      return this.hash;
    },
    writeHash(view: ViewId): void {
      this.hash = view;
    },
    isOverlay(): boolean {
      return this.overlay;
    },
    now: () => new Date('2026-11-24T22:06:48.044Z')
  } satisfies Env & { hash: string; overlay: boolean };
  const model = makeModel({ updates: { generatedAt: '', items: opts.updates ?? [] } });
  const store = new AppStore(model, env);
  let changes = 0;
  store.subscribe(() => changes++);
  return { store, env, model, changes: () => changes };
}

describe('画面の切り替え（URL の #）', () => {
  it('知らない名前はホーム。昔の #notes は「このサイトについて」', () => {
    expect(viewFromHash('#flow')).toBe('flow');
    expect(viewFromHash('about')).toBe('about');
    expect(viewFromHash('#notes')).toBe('about');
    expect(viewFromHash('')).toBe('home');
    expect(viewFromHash('#なにか')).toBe('home');
    expect(setup({ hash: 'updates' }).store.getState().view).toBe('updates');
  });

  it('go は画面と # の両方を変える。# が変わったら、その画面にする', () => {
    const { store, env, changes } = setup();
    store.go('find');
    expect(store.getState().view).toBe('find');
    expect(env.hash).toBe('find');
    store.show('#me');
    expect(store.getState().view).toBe('me');
    const before = changes();
    store.show('#me');
    expect(changes()).toBe(before);
  });
});

describe('お金の流れ', () => {
  it('最初は、いちばん上の使いみちをえらんでいる', () => {
    const { store, model } = setup();
    const flow = currentFlow(model, store.getState());
    expect(flow.isRoot).toBe(true);
    expect(flow.node?.id).toBe('social');
  });

  it('えらんである使いみちをもう一度押すと、内訳に進む', () => {
    const { store, model } = setup();
    const defense = model.root.cols[2]!.nodes.find(n => n.id === 'defense')!;
    store.pickNode(defense);
    expect(store.getState()).toMatchObject({ sel: 'defense', path: [] });
    store.pickNode(defense);
    expect(store.getState()).toMatchObject({ sel: 'defense', path: ['defense'] });
    const flow = currentFlow(model, store.getState());
    expect(flow.isRoot).toBe(false);
    expect(flow.model.key).toBe('defense');
    // 内訳のない使いみちは、何度押しても進まない
    const debt = model.root.cols[2]!.nodes.find(n => n.id === 'debt')!;
    store.toRoot();
    store.pickNode(debt);
    store.pickNode(debt);
    expect(store.getState()).toMatchObject({ sel: 'debt', path: [] });
  });

  it('財源や一般会計を押しても、内訳には進まない', () => {
    const { store, model } = setup();
    const pool = model.root.cols[1]!.nodes[0]!;
    store.pickNode(pool);
    store.pickNode(pool);
    expect(store.getState()).toMatchObject({ sel: POOL_ID, path: [] });
  });

  it('「全体」に戻ると、開いていた使いみちをえらび直す', () => {
    const { store, model } = setup();
    store.drill('defense');
    store.selectNode('f-equip');
    expect(currentFlow(model, store.getState()).node?.name).toBe('装備品の購入・開発');
    store.selectNode(recipNodeId('dind'));
    expect(currentFlow(model, store.getState()).node?.kind).toBe('recip');
    store.toRoot();
    expect(store.getState()).toMatchObject({ sel: 'defense', path: [] });
  });

  it('ほかの画面から項目を指して開く（使いみち・財源・内訳の項目）', () => {
    const { store, env } = setup({ hash: 'home' });
    store.setMode('table');
    store.selectFlow('defense', { drill: true });
    expect(store.getState()).toMatchObject({ view: 'flow', sel: 'defense', path: ['defense'], mode: 'flow' });
    expect(env.hash).toBe('flow');
    store.selectFlow('bond');
    expect(store.getState()).toMatchObject({ sel: 'bond', path: [] });
    store.selectFlow('s-care');
    expect(store.getState()).toMatchObject({ sel: 's-care', path: ['social'] });
    // 内訳のない使いみちは、drill を指定しても全体の図のまま
    store.selectFlow('debt', { drill: true });
    expect(store.getState()).toMatchObject({ sel: 'debt', path: [] });
    // 知らないIDでも止まらない
    store.selectFlow('nothing');
    expect(store.getState().view).toBe('flow');
  });

  it('図にないIDをえらんでいたら、最初の項目に読みかえる', () => {
    const { store, model } = setup();
    store.selectNode('zzz');
    expect(currentFlow(model, store.getState()).node?.id).toBe('social');
    store.drill('defense');
    store.selectNode('zzz');
    expect(currentFlow(model, store.getState()).node?.id).toBe('defense');
  });
});

describe('政策の動き', () => {
  const many = [
    ...Array.from({ length: 150 }, (_, i) => update({ id: `u${i}`, date: '2026-11-24', importance: 200 - i })),
    update({ id: 'noise', date: '2026-11-23', noise: true })
  ];

  it('1件を開くと、絞り込みを外し、その件が出るところまで件数をふやす', () => {
    const { store } = setup({ updates: many });
    store.setUpType('law');
    store.setUpQuery('なにか');
    expect(store.getState().upLimit).toBe(PAGE_SIZE);
    store.openUpdate('u130');
    expect(store.getState()).toMatchObject({
      view: 'updates',
      upType: 'all',
      upTheme: 'all',
      upQuery: '',
      upAll: false,
      openUp: 'u130',
      upLimit: PAGE_SIZE * 3
    });
    expect(store.getState().reveal).toMatchObject({ kind: 'up', id: 'u130' });
    const n = store.getState().reveal!.n;
    store.openUpdate('u130');
    expect(store.getState().reveal!.n).toBe(n + 1);
  });

  it('ふだん外している発表を開くときは、「すべての発表を表示」にする', () => {
    const { store } = setup({ updates: many });
    store.openUpdate('noise');
    expect(store.getState()).toMatchObject({ upAll: true, openUp: 'noise', upLimit: PAGE_SIZE * 3 });
  });

  it('絞り込みを変えると、件数は最初の60件に戻る', () => {
    const { store } = setup({ updates: many });
    store.moreUpdates();
    expect(store.getState().upLimit).toBe(PAGE_SIZE * 2);
    store.setUpTheme('social');
    expect(store.getState()).toMatchObject({ upTheme: 'social', upLimit: PAGE_SIZE, openUp: null });
    store.showUpdates('law', 'なにか');
    expect(store.getState()).toMatchObject({ view: 'updates', upType: 'law', upTheme: 'all' });
    store.toggleUp('u1');
    store.toggleUp('u1');
    expect(store.getState().openUp).toBeNull();
  });
});

describe('制度をさがす・申請の準備', () => {
  it('設定がまだなら「すべての制度」。Jグランツは設定がなくても出せる', () => {
    const { store } = setup();
    expect(findModeOf(store.getState())).toBe('all');
    store.setFindMode('jgrants');
    expect(store.getState().view).toBe('find');
    expect(findModeOf(store.getState())).toBe('jgrants');
    store.usePreset('person');
    expect(store.getState().findMode).toBe('match');
    expect(findModeOf(store.getState())).toBe('match');
    store.showPrograms('biz');
    expect(store.getState()).toMatchObject({ aud: 'biz', findMode: 'all' });
    store.showPrograms('だれか', true);
    expect(store.getState()).toMatchObject({ aud: 'all', findMode: 'match' });
  });

  it('申請の準備：記録を作り、段階と入力を残す', () => {
    const { store, model } = setup();
    expect(applyProgramOf(model, store.getState())?.id).toBe('jidou');
    store.startApply('jidou');
    expect(store.getState()).toMatchObject({ view: 'apply', applyId: 'jidou' });
    expect(store.getState().apps.jidou).toEqual({ step: 0, checks: {}, q1: '', q2: '', draft: {}, done: '' });
    store.setStep('jidou', 1);
    store.setCheck('jidou', 'id', true);
    store.setStep('jidou', 9);
    expect(store.getState().apps.jidou).toMatchObject({ step: 3, checks: { id: true } });
    // 提出した日は、日本時間の日付（UTC では 11月24日 22時）
    store.setDone('jidou', true);
    expect(store.getState().apps.jidou?.done).toBe('11月25日');
    store.setDone('jidou', false);
    expect(store.getState().apps.jidou?.done).toBe('');
    // 下書きの質問がない制度では、下書きは作らない
    expect(store.makeDraft('jidou')).toBe('none');
  });

  it('設定を消すと、申請の記録も消える', () => {
    const { store } = setup();
    store.usePreset('biz');
    store.startApply('jidou');
    store.wipe();
    expect(store.getState().pf.kind).toBe('');
    expect(store.getState().apps).toEqual({});
  });

  it('項目は、値が変わったときだけ保存する', () => {
    const { store, changes } = setup();
    expect(store.setProfileField('pref', '東京都')).toBe(true);
    const before = changes();
    expect(store.setProfileField('pref', '東京都')).toBe(false);
    expect(changes()).toBe(before);
    store.toggleKind('person');
    store.toggleKid('pre');
    store.toggleKid('none');
    expect(store.getState().pf).toMatchObject({ kind: 'person', pref: '東京都', kids: ['none'] });
    store.toggleKind('person');
    expect(store.getState().pf.kind).toBe('');
  });
});

describe('AIに聞く の開閉', () => {
  it('広い画面では最初から開く。狭い画面では閉じておく', () => {
    expect(setup({ overlay: false }).store.getState().dock).toBe(true);
    expect(setup({ overlay: true }).store.getState().dock).toBe(false);
  });

  it('ボタンで開いたときだけ、入力欄にフォーカスを移す', () => {
    const { store } = setup({ overlay: true });
    store.setDock(true);
    expect(store.getState()).toMatchObject({ dock: true, focusAsk: 0 });
    store.setDock(false);
    store.setDock(true, true);
    expect(store.getState()).toMatchObject({ dock: true, focusAsk: 1 });
  });
});
