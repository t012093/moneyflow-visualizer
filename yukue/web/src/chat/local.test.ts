import { describe, expect, it } from 'vitest';
import { CHAT_MODE_LABEL } from '../content.ts';
import { applyPreset, PF0 } from '../lib/profile.ts';
import { AppStore, type Env } from '../state/store.ts';
import { makeModel, update } from '../test/fixtures.ts';
import { runViewAction } from './actions.ts';
import { ChatController } from './controller.ts';
import { createLocalProvider, localAnswer } from './local.ts';
import { screenLabel, suggestions } from './screen.ts';
import type { ChatContext, ChatProvider } from './types.ts';

const LAW = ['検討', '閣議決定', '国会審議', '成立', '公布', '施行'];
const updates = [
  update({
    id: 'curated:hosei2',
    date: '2026-11-24',
    type: 'budget',
    theme: 'whole',
    importance: 95,
    title: '第2次補正予算、首相が編成を指示',
    summary: '首相が財務相に第2次補正予算の編成を指示した。',
    ministry: '内閣府・財務省',
    stage: { steps: ['概算要求', '政府案', '国会審議', '成立', '執行', '決算'], index: 0, label: '編成を指示' },
    qa: { what: '追加の支出が上乗せされる見通し。', who: 'まだ分からない。', when: '未公表。' },
    links: [{ name: '首相官邸', url: 'https://www.kantei.go.jp/' }]
  }),
  update({
    id: 'curated:bgata',
    date: '2026-11-20',
    type: 'law',
    theme: 'social',
    importance: 60,
    title: 'B型肝炎の給付金、請求できる期限を延ばす改正法が公布',
    stage: { steps: LAW, index: 4, label: '公布' }
  }),
  update({ id: 'mof:1', date: '2026-11-21', type: 'news', theme: 'social', importance: 40, title: '年金の検討会を開催', summary: '検討会を開いた。' }),
  update({ id: 'mof:2', date: '2026-11-22', type: 'news', theme: 'social', importance: 99, title: '人事異動', noise: true })
];
const briefing = {
  date: '2026-11-24',
  generatedAt: '2026-11-24T09:00:00.000Z',
  method: 'curated' as const,
  items: [{ id: 'curated:hosei2', text: '首相が、第2次補正予算を編成するよう指示した。' }]
};

function setup(hash = 'home') {
  const env: Env = { readHash: () => hash, writeHash: v => void (hash = v), isOverlay: () => false, now: () => new Date('2026-11-24T03:00:00Z') };
  const model = makeModel({ updates: { generatedAt: '2026-11-24T09:00:00.000Z', items: updates }, briefing });
  const store = new AppStore(model, env);
  const ctx = (): ChatContext => ({ model, state: store.getState(), screen: screenLabel(model, store.getState()), today: '2026-11-24' });
  return { store, model, ctx, ask: (q: string) => localAnswer(q, ctx()) };
}

describe('かんたん応答（手元の規則で答える）', () => {
  it('使いみちを聞かれたら、金額・割合・内訳を答えて、流れ図の内訳を開く', () => {
    const { ask } = setup();
    const a = ask('防衛費は何に使われているの？');
    expect(a.text).toContain('防衛関係費は9.0兆円で、一般会計の7.3%にあたります。');
    expect(a.text).toContain('内訳で大きいのは装備品の購入・開発（3.6兆円）と人件・糧食費（2.3兆円）です。');
    expect(a.text).toContain('2017年度の5.1兆円から、10年で3.9兆円増えています。');
    expect(a.action).toEqual({ label: 'お金の流れ › 防衛 を表示', run: { kind: 'flow', id: 'defense', drill: true } });
    expect(a.figure?.title).toBe('防衛の内訳');
    expect(a.figure?.items.map(i => i.name)).toEqual(['装備品の購入・開発', '人件・糧食費', '維持整備・弾薬・燃料', '施設・基地対策']);
    expect(a.source).toBe('出典：財務省「令和8年度予算」（内訳はサンプル）');
  });

  it('関連する最近の動きは、重要度の高いものをえらぶ。ふだん外している発表（noise）からは選ばない', () => {
    const a = setup().ask('社会保障の内訳を見せて');
    // 新しいだけの「年金の検討会を開催」（重要度40）より、重要度60の法律を出す
    expect(a.text).toContain('関連する最近の動きは「B型肝炎の給付金、請求できる期限を延ばす改正法が公布」（公布）です。');
    expect(a.text).not.toContain('人事異動');
  });

  it('いちばん大きい支出・財源', () => {
    const { ask } = setup();
    const big = ask('いちばん大きい支出は？');
    expect(big.text).toContain('いちばん大きいのは社会保障の39.1兆円で、全体の31.9%です。');
    expect(big.action?.run).toEqual({ kind: 'flow', id: 'social', drill: false });
    expect(big.figure?.items).toHaveLength(8);
    const rev = ask('税収はどこから来ている？');
    expect(rev.text).toContain('財源122.3兆円のうち、税収は83.8兆円（68.5%）です。');
    expect(rev.action?.run).toEqual({ kind: 'flow', id: 'bond', drill: false });
    const one = ask('消費税は全体のどれくらい？');
    expect(one.text).toContain('消費税は26.7兆円で、一般会計の財源の21.8%です。');
    expect(one.action?.run).toEqual({ kind: 'flow', id: 'consumption', drill: false });
    expect(ask('国の借金の返済にいくら使っている？').action?.run).toEqual({ kind: 'flow', id: 'debt', drill: true });
    // 別名でも見つかる
    expect(ask('公債の発行はどれくらい？').action?.run).toEqual({ kind: 'flow', id: 'bond', drill: false });
  });

  it('きょうの動き：briefing.json のまとめを使う', () => {
    const a = setup().ask('きょうの動きをまとめて教えて');
    expect(a.text).toBe('けさ集めた中で、とくに大きな動きは次の1件です。\n・首相が、第2次補正予算を編成するよう指示した。（編成を指示）');
    expect(a.action?.run).toEqual({ kind: 'updates', type: 'all', theme: 'all' });
    expect(a.source).toBe('出典：首相官邸');
  });

  it('最近の動き：分野や「成立した法律」で絞る。段階のない発表は、種類だけ添える', () => {
    const { ask } = setup();
    const laws = ask('最近、成立した法律は？');
    expect(laws.text).toBe('最近、成立・公布された法律です。\n・11/20 B型肝炎の給付金、請求できる期限を延ばす改正法が公布（法律・公布）');
    expect(laws.action?.run).toEqual({ kind: 'updates', type: 'law', theme: 'all' });
    const social = ask('社会保障に関係する最近の動きは？');
    expect(social.text).toBe(
      '社会保障に関係する動きです。\n・11/21 年金の検討会を開催（発表）\n・11/20 B型肝炎の給付金、請求できる期限を延ばす改正法が公布（法律・公布）'
    );
    expect(social.action?.run).toEqual({ kind: 'updates', type: 'all', theme: 'social' });
    expect(ask('防衛に関係する最近の動きは？').text).toBe('その条件に合う動きは、この試作版のデータには含まれていません。');
  });

  it('「題」で聞かれたら、その動きを説明して開く。要点（qa）や段階がなければ、要約だけ', () => {
    const { ask } = setup();
    const full = ask('「第2次補正予算、首相が編成を指示」をわかりやすく説明して');
    expect(full.text).toBe(
      '首相が財務相に第2次補正予算の編成を指示した。\n・何が変わる：追加の支出が上乗せされる見通し。\n・だれに関係：まだ分からない。\n・いつから：未公表。\nいまの段階は「編成を指示」です。'
    );
    expect(full.action).toEqual({ label: 'この動きを開く', run: { kind: 'update', id: 'curated:hosei2' } });
    expect(full.source).toBe('出典：首相官邸');
    const bare = ask('「年金の検討会を開催」をわかりやすく説明して');
    expect(bare.text).toBe('検討会を開いた。');
    expect(bare.source).toBeUndefined();
  });

  it('制度：立場で絞る。「題」で聞かれたら、その制度を答える', () => {
    const { ask } = setup();
    const family = ask('子育て世帯が使える制度は？');
    expect(family.text).toContain('子育て世帯が使える制度は3件あります。');
    expect(family.action?.run).toEqual({ kind: 'programs', aud: 'family' });
    expect(ask('中小企業が申請できる補助金は？').action?.run).toEqual({ kind: 'programs', aud: 'biz' });
    expect(ask('NPOが使える助成は？').action?.run).toEqual({ kind: 'programs', aud: 'npo' });
    const one = ask('「児童手当」の対象になる条件を教えて');
    expect(one.text).toContain('児童手当は、');
    expect(one.action?.run).toEqual({ kind: 'programs', aud: 'family' });
    const apply = ask('「児童手当」の申請で気をつけることは？');
    expect(apply.text).toContain('児童手当の提出先は、市区町村です。');
    expect(apply.action).toEqual({ label: '申請の準備を開く', run: { kind: 'apply', id: 'jidou' } });
  });

  it('私に合う制度：設定がなければマイページへ。あれば、合う制度を理由つきで', () => {
    const { ask, store } = setup();
    expect(ask('私に合う制度は？').action).toEqual({ label: 'マイページを開く', run: { kind: 'view', view: 'me' } });
    store.usePreset('person');
    const a = ask('私に合う制度は？');
    expect(a.text).toContain('いまの設定（個人 ・ 東京都 ・ 子ども：小・中学生 ・ 会社員・公務員）に合いそうな制度は4件です。');
    expect(a.text).toContain('・児童手当：対象の可能性が高い（高校生年代までの子どもがいる）');
    expect(a.action).toEqual({ label: 'あなたに合う制度を表示', run: { kind: 'programs', aud: 'all', matched: true } });
  });

  it('情報の扱い、答えられない質問', () => {
    const { ask } = setup();
    expect(ask('入れた情報は何に使われるの？').action?.run).toEqual({ kind: 'view', view: 'me' });
    const other = ask('こんにちは');
    expect(other.text).toContain('令和8年度一般会計の流れ、最近の政策の動き、制度の一覧について答えられます。');
    expect(other.action).toBeUndefined();
  });

  it('申請の準備の画面では、その制度のそろえるものを答える', () => {
    const { ask, store } = setup();
    store.startApply('jidou');
    const a = ask('提出のしかたは？');
    expect(a.text).toContain('・本人確認書類');
    expect(a.action?.run).toEqual({ kind: 'apply', id: 'jidou' });
  });

  it('画面ごとの質問の例は、どれも答えと画面の動きが返る', () => {
    const { store, model, ask } = setup();
    const views = ['home', 'flow', 'updates', 'find', 'me', 'apply', 'connect', 'about'] as const;
    for (const v of views) {
      store.go(v);
      const qs = suggestions(model, store.getState());
      expect(qs.length).toBeGreaterThan(0);
      for (const q of qs) {
        const a = ask(q);
        expect(a.text.length, q).toBeGreaterThan(10);
        expect(a.action, q).toBeDefined();
      }
    }
    store.selectFlow('bond');
    expect(suggestions(model, store.getState())[0]).toBe('国債（借金）は全体のどれくらい？');
    store.usePreset('biz');
    store.go('find');
    expect(suggestions(model, store.getState())[0]).toBe('私に合う制度は？');
  });
});

describe('答えに付いた操作で、画面を動かす', () => {
  it('流れ図・動き・制度・申請の準備を開く', () => {
    const { store } = setup();
    runViewAction(store, { kind: 'flow', id: 'defense', drill: true });
    expect(store.getState()).toMatchObject({ view: 'flow', path: ['defense'], sel: 'defense' });
    runViewAction(store, { kind: 'updates', type: 'law', theme: 'social' });
    expect(store.getState()).toMatchObject({ view: 'updates', upType: 'law', upTheme: 'social' });
    runViewAction(store, { kind: 'update', id: 'curated:bgata' });
    expect(store.getState()).toMatchObject({ view: 'updates', upType: 'all', openUp: 'curated:bgata' });
    runViewAction(store, { kind: 'programs', aud: 'biz' });
    expect(store.getState()).toMatchObject({ view: 'find', aud: 'biz', findMode: 'all' });
    runViewAction(store, { kind: 'view', view: 'me' });
    expect(store.getState().view).toBe('me');
    runViewAction(store, { kind: 'apply', id: 'jidou' });
    expect(store.getState()).toMatchObject({ view: 'apply', applyId: 'jidou' });
  });

  it('「いま見ている画面」の言い方', () => {
    const { store, model } = setup();
    const label = (): string => screenLabel(model, store.getState());
    expect(label()).toBe('ホーム');
    store.selectFlow('defense');
    expect(label()).toBe('お金の流れ › 防衛');
    store.drill('defense');
    expect(label()).toBe('お金の流れ › 防衛');
    store.selectNode('f-equip');
    expect(label()).toBe('お金の流れ › 防衛 › 装備品の購入・開発');
    store.openUpdate('curated:bgata');
    expect(label()).toBe('政策の動き › B型肝炎の給付金、請求できる期限を延ばす改正法が公布');
    store.showPrograms('biz');
    expect(label()).toBe('制度をさがす › 事業者・中小企業');
    store.setFindMode('jgrants');
    expect(label()).toBe('制度をさがす › 受付中の補助金（Jグランツ）');
    store.usePreset('person');
    expect(label()).toBe('制度をさがす › あなたに合う制度');
    store.startApply('jidou');
    expect(label()).toBe('申請の準備 › 児童手当');
    store.go('about');
    expect(label()).toBe('このサイトについて');
  });
});

describe('会話の進行', () => {
  it('質問すると、画面を動かしてから答えを出す。入力欄は空にする', async () => {
    const { store } = setup();
    const chat = new ChatController(store, createLocalProvider(), () => true);
    expect(chat.provider.modeLabel).toBe(CHAT_MODE_LABEL);
    expect(chat.getState().messages).toHaveLength(1);
    chat.setInput('防衛費は何に使われているの？');
    await chat.ask(chat.getState().input);
    const st = chat.getState();
    expect(st.busy).toBe(false);
    expect(st.input).toBe('');
    expect(st.messages.map(m => m.role)).toEqual(['ai', 'user', 'ai']);
    const last = st.messages[2]!;
    expect(last.thinking).toBe(false);
    expect(last.text).toContain('防衛関係費は9.0兆円');
    expect(last.action?.label).toBe('お金の流れ › 防衛 を表示');
    expect(last.figure?.items).toHaveLength(4);
    expect(store.getState()).toMatchObject({ view: 'flow', path: ['defense'], dock: true });
  });

  it('空の質問や、答えている途中の質問は受け付けない', async () => {
    const { store } = setup();
    const chat = new ChatController(store, createLocalProvider(), () => true);
    await chat.ask('   ');
    expect(chat.getState().messages).toHaveLength(1);
    const first = chat.ask('いちばん大きい支出は？');
    await chat.ask('税収はどこから来ている？');
    await first;
    expect(chat.getState().messages).toHaveLength(3);
  });

  it('少しずつ届く答え（サーバーの provider を想定）は、届いたところまで表示する。止めたら、そこで終える', async () => {
    const { store } = setup();
    let release: (() => void) | undefined;
    const slow: ChatProvider = {
      modeLabel: 'テスト',
      footnote: '',
      ask: (_q, _ctx, options) =>
        new Promise((_resolve, reject) => {
          options?.onText?.('途中まで');
          release = () => reject(new Error('aborted'));
          options?.signal?.addEventListener('abort', () => release?.());
        })
    };
    const chat = new ChatController(store, slow, () => true);
    const done = chat.ask('なにか');
    await Promise.resolve();
    expect(chat.getState().busy).toBe(true);
    expect(chat.getState().messages[2]).toMatchObject({ text: '途中まで', thinking: false });
    chat.stop();
    await done;
    expect(chat.getState().busy).toBe(false);
    expect(chat.getState().messages[2]?.text).toBe('途中まで\n（止めました）');
  });

  it('答えを取得できなかったときは、そのことを伝える', async () => {
    const { store } = setup();
    const broken: ChatProvider = { modeLabel: '', footnote: '', ask: () => Promise.reject(new Error('down')) };
    const chat = new ChatController(store, broken, () => true);
    await chat.ask('なにか');
    expect(chat.getState().messages[2]?.text).toBe('うまく答えを取得できませんでした。もう一度お試しください。');
    expect(chat.getState().busy).toBe(false);
  });

  it('provider には、画面の状態・いま見ている画面・きょうの日付を渡す（設定を外へ送ってよいかは useInAi で分かる）', async () => {
    const { store } = setup();
    store.usePreset('person');
    store.setUseInAi(false);
    let seen: ChatContext | null = null;
    const spy: ChatProvider = {
      modeLabel: '',
      footnote: '',
      ask: (_q, ctx) => {
        seen = ctx;
        return Promise.resolve({ text: 'はい' });
      }
    };
    await new ChatController(store, spy, () => true).ask('なにか');
    const ctx = seen as ChatContext | null;
    expect(ctx?.state.pf.useInAi).toBe(false);
    expect(ctx?.screen).toBe('ホーム');
    expect(ctx?.today).toBe('2026-11-24');
    expect(applyPreset('person', PF0).useInAi).toBe(true);
  });
});
