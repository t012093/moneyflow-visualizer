/**
 * 画面の状態と、それを動かす操作。React からは useSyncExternalStore で読む。
 * プロトタイプの st（画面の状態）、pf（設定）、login、apps（申請の記録）と、それを書きかえる関数をまとめたもの。
 * 設定・ログインの再現・申請の記録は、プロトタイプと同じキー（yukue.profile / yukue.login / yukue.apps / yukue.dock）で
 * この端末に保存する。
 */
import { PAGE_SIZE, VIEWS, isAudId, isThemeId, isUpdateType, type AudId, type ViewId } from '../content.ts';
import type { Model } from '../data/model.ts';
import { cleanAppRecords, localDraft, newAppRecord, type AppRecord, type AppRecords } from '../lib/apply.ts';
import { monthDay, todayJst } from '../lib/dates.ts';
import { findNode, parentUseOf, POOL_ID, type FlowModel, type FlowNode } from '../lib/flowModel.ts';
import type { Unit } from '../lib/format.ts';
import {
  applyPreset,
  cleanProfile,
  toggleAim,
  toggleKid,
  type AimId,
  type KidsId,
  type KindId,
  type PresetId,
  type Profile
} from '../lib/profile.ts';
import { storage } from '../lib/storage.ts';
import { filterUpdates } from '../lib/updates.ts';
import type { Program, ThemeId, UpdateType } from '../types.ts';

export type FindMode = 'match' | 'all' | 'jgrants';
export type FlowMode = 'flow' | 'table';

export interface Reveal {
  kind: 'up' | 'prog';
  id: string;
  /** 同じ相手をもう一度指したときにも動くように、毎回ふやす */
  n: number;
}

export interface UiState {
  view: ViewId;
  /* お金の流れ */
  unit: Unit;
  mode: FlowMode;
  /** 内訳を開いている使いみち（0〜1件） */
  path: string[];
  /** えらんでいる項目 */
  sel: string;
  /* 政策の動き */
  upType: UpdateType | 'all';
  upTheme: ThemeId | 'all';
  upQuery: string;
  /** 人事・入札・会見なども出す */
  upAll: boolean;
  upLimit: number;
  openUp: string | null;
  /* 制度をさがす */
  aud: AudId;
  findMode: FindMode;
  jgQuery: string;
  jgArea: string;
  jgLimit: number;
  /* 申請の準備 */
  applyId: string | null;
  /* AIに聞く */
  dock: boolean;
  /** ふえたら、質問の入力欄にフォーカスを移す */
  focusAsk: number;
  /* この端末に保存するもの */
  pf: Profile;
  login: boolean;
  apps: AppRecords;
  /** 画面を切り替えたあと、見える位置まで動かす相手 */
  reveal: Reveal | null;
}

/** ブラウザーとのやりとり（テストでは差し替える） */
export interface Env {
  readHash(): string;
  writeHash(view: ViewId): void;
  /** 「AIに聞く」が本文にかぶさる幅か（1180px 未満） */
  isOverlay(): boolean;
  now(): Date;
}

export const OVERLAY_QUERY = '(max-width:1179.98px)';

export const browserEnv: Env = {
  readHash: () => location.hash.slice(1),
  writeHash: view => {
    location.hash = view;
  },
  isOverlay: () => matchMedia(OVERLAY_QUERY).matches,
  now: () => new Date()
};

/** URL の # 以下から画面をえらぶ。知らない名前はホーム。昔の #notes は「このサイトについて」へ */
export function viewFromHash(hash: string): ViewId {
  const v = hash.replace(/^#/, '');
  if (v === 'notes') return 'about';
  return (VIEWS as readonly string[]).includes(v) ? (v as ViewId) : 'home';
}

export interface CurrentFlow {
  model: FlowModel;
  isRoot: boolean;
  /** えらんでいる項目（図にないIDなら、最初の項目に読みかえる） */
  node: FlowNode | null;
}

export function currentFlow(model: Model, st: Pick<UiState, 'path' | 'sel'>): CurrentFlow {
  const open = st.path[0];
  const fm = (open ? model.drill(open) : null) ?? model.root;
  const isRoot = fm.key === 'root';
  const node = findNode(fm, st.sel) ?? findNode(fm, isRoot ? model.firstUseId : fm.key);
  return { model: fm, isRoot, node };
}

/** いま準備している制度。指定がなければ、申請の準備ができる最初の制度 */
export function applyProgramOf(model: Model, st: Pick<UiState, 'applyId'>): Program | null {
  return model.programs.find(p => p.id === st.applyId && p.apply) ?? model.programs.find(p => p.apply) ?? null;
}

/** 「制度をさがす」で実際に出す一覧。設定がまだなら「あなたに合う制度」は出せないので「すべて」にする */
export function findModeOf(st: Pick<UiState, 'findMode' | 'pf'>): FindMode {
  if (st.findMode === 'jgrants') return 'jgrants';
  return st.pf.kind ? st.findMode : 'all';
}

export class AppStore {
  readonly model: Model;
  private readonly env: Env;
  private state: UiState;
  private readonly listeners = new Set<() => void>();

  constructor(model: Model, env: Env = browserEnv) {
    this.model = model;
    this.env = env;
    this.state = {
      view: viewFromHash(env.readHash()),
      unit: 'cho',
      mode: 'flow',
      path: [],
      sel: model.firstUseId,
      upType: 'all',
      upTheme: 'all',
      upQuery: '',
      upAll: false,
      upLimit: PAGE_SIZE,
      openUp: null,
      aud: 'all',
      findMode: 'match',
      jgQuery: '',
      jgArea: '',
      jgLimit: PAGE_SIZE,
      applyId: null,
      dock: !env.isOverlay() && storage.getRaw('dock') !== '0',
      focusAsk: 0,
      pf: cleanProfile(storage.get('profile')),
      login: storage.get('login') === true,
      apps: cleanAppRecords(storage.get('apps')),
      reveal: null
    };
  }

  getState = (): UiState => this.state;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  private set(patch: Partial<UiState>): void {
    this.state = { ...this.state, ...patch };
    for (const fn of [...this.listeners]) fn();
  }

  /* ---------- 画面の切り替え ---------- */

  /** URL の # が変わったとき */
  show = (hash: string): void => {
    const view = viewFromHash(hash);
    if (view !== this.state.view) this.set({ view });
  };

  go = (view: ViewId, patch: Partial<UiState> = {}): void => {
    this.set({ ...patch, view });
    if (this.env.readHash() !== view) this.env.writeHash(view);
  };

  /* ---------- お金の流れ ---------- */

  /** どの画面からでも、流れ図の項目をえらんで「お金の流れ」を開く */
  selectFlow = (id: string, opt: { drill?: boolean } = {}): void => {
    const { model } = this;
    let patch: Partial<UiState> = {};
    if (model.useById.has(id)) patch = { path: opt.drill && model.drill(id) ? [id] : [], sel: id };
    else if (model.srcById.has(id) || id === POOL_ID) patch = { path: [], sel: id };
    else {
      const parent = parentUseOf(model.budget, id);
      if (parent) patch = { path: [parent.id], sel: id };
    }
    this.go('flow', { ...patch, mode: 'flow' });
  };

  /** 使いみちの内訳に進む */
  drill = (id: string): void => {
    if (!this.model.drill(id)) return;
    this.set({ path: [id], sel: id, mode: 'flow' });
  };

  /** 図の項目を押したとき。えらんである使いみちをもう一度押すと、内訳に進む */
  pickNode = (node: FlowNode): void => {
    const cur = currentFlow(this.model, this.state).node;
    if (cur && cur.id === node.id && node.drill) this.drill(node.id);
    else this.set({ sel: node.id });
  };

  selectNode = (id: string): void => this.set({ sel: id });

  /** 「全体」に戻る。内訳の中の項目をえらんでいたら、開いていた使いみちをえらび直す */
  toRoot = (): void => {
    const open = this.state.path[0];
    const keep = findNode(this.model.root, this.state.sel) != null;
    this.set({ path: [], sel: keep ? this.state.sel : (open ?? this.model.firstUseId) });
  };

  setUnit = (unit: Unit): void => this.set({ unit });
  setMode = (mode: FlowMode): void => this.set({ mode });

  /* ---------- 政策の動き ---------- */

  setUpType = (upType: UpdateType | 'all'): void => this.set({ upType, openUp: null, upLimit: PAGE_SIZE });
  setUpTheme = (upTheme: ThemeId | 'all'): void => this.set({ upTheme, openUp: null, upLimit: PAGE_SIZE });
  setUpQuery = (upQuery: string): void => this.set({ upQuery, upLimit: PAGE_SIZE });
  setUpAll = (upAll: boolean): void => this.set({ upAll, upLimit: PAGE_SIZE });
  toggleUp = (id: string): void => this.set({ openUp: this.state.openUp === id ? null : id });
  moreUpdates = (): void => this.set({ upLimit: this.state.upLimit + PAGE_SIZE });

  /** 絞り込みを決めて「政策の動き」を開く（チャットや、ホームのテーマから） */
  showUpdates = (type: string, theme: string): void => {
    this.go('updates', {
      upType: isUpdateType(type) ? type : 'all',
      upTheme: isThemeId(theme) ? theme : 'all',
      upQuery: '',
      openUp: null,
      upLimit: PAGE_SIZE
    });
  };

  /** 1件の動きを開いて、見える位置まで動かす。絞り込みは外す */
  openUpdate = (id: string): void => {
    const item = this.model.upById.get(id);
    const upAll = this.state.upAll || !!item?.noise;
    const list = filterUpdates(this.model.updates, { type: 'all', theme: 'all', query: '', showAll: upAll });
    const at = list.findIndex(u => u.id === id);
    const upLimit = Math.max(PAGE_SIZE, Math.ceil((at + 1) / PAGE_SIZE) * PAGE_SIZE);
    this.go('updates', {
      upType: 'all',
      upTheme: 'all',
      upQuery: '',
      upAll,
      upLimit,
      openUp: id,
      reveal: { kind: 'up', id, n: (this.state.reveal?.n ?? 0) + 1 }
    });
  };

  /* ---------- 制度をさがす ---------- */

  setAud = (aud: AudId): void => this.set({ aud });

  setFindMode = (findMode: FindMode): void => {
    if (this.state.view === 'find') this.set({ findMode });
    else this.go('find', { findMode });
  };

  /** 立場で絞って「制度をさがす」を開く。matched なら「あなたに合う制度」 */
  showPrograms = (aud: string, matched = false): void => {
    this.go('find', { aud: isAudId(aud) ? aud : 'all', findMode: matched ? 'match' : 'all' });
  };

  /** 1つの制度を、すべての制度の一覧の中で見せる */
  showProgram = (id: string): void => {
    this.go('find', { aud: 'all', findMode: 'all', reveal: { kind: 'prog', id, n: (this.state.reveal?.n ?? 0) + 1 } });
  };

  setJgQuery = (jgQuery: string): void => this.set({ jgQuery, jgLimit: PAGE_SIZE });
  setJgArea = (jgArea: string): void => this.set({ jgArea, jgLimit: PAGE_SIZE });
  moreJGrants = (): void => this.set({ jgLimit: this.state.jgLimit + PAGE_SIZE });

  /* ---------- 設定・ログインの再現 ---------- */

  private savePf(pf: Profile, patch: Partial<UiState> = {}): void {
    storage.set('profile', pf);
    this.set({ ...patch, pf });
  }

  /** 1つの項目を書きかえる。値が変わったときだけ保存して、true を返す */
  setProfileField = <K extends keyof Profile>(key: K, value: Profile[K]): boolean => {
    if (this.state.pf[key] === value) return false;
    this.savePf({ ...this.state.pf, [key]: value });
    return true;
  };

  toggleKind = (kind: KindId): void => this.savePf({ ...this.state.pf, kind: this.state.pf.kind === kind ? '' : kind });
  toggleKid = (v: KidsId): void => this.savePf({ ...this.state.pf, kids: toggleKid(this.state.pf.kids, v) });
  toggleAim = (v: AimId): void => this.savePf({ ...this.state.pf, aims: toggleAim(this.state.pf.aims, v) });

  /** 「例でためす」 */
  usePreset = (id: PresetId): void => this.savePf(applyPreset(id, this.state.pf), { findMode: 'match' });

  setUseInAi = (useInAi: boolean): void => this.savePf({ ...this.state.pf, useInAi });

  /** ログインは画面の再現だけで、認証は行わない */
  setLogin = (login: boolean): void => {
    storage.set('login', login);
    storage.set('profile', this.state.pf);
    this.set({ login });
  };

  /** この端末の設定と申請の記録を消す */
  wipe = (): void => {
    storage.del('profile');
    storage.del('apps');
    this.set({ pf: cleanProfile(null), apps: {} });
  };

  /* ---------- 申請の準備 ---------- */

  private updateApp(id: string, change: (rec: AppRecord) => AppRecord, patch: Partial<UiState> = {}): void {
    const apps = { ...this.state.apps, [id]: change(this.state.apps[id] ?? newAppRecord()) };
    storage.set('apps', apps);
    this.set({ ...patch, apps });
  }

  startApply = (id: string): void => {
    const apps = this.state.apps[id] ? this.state.apps : { ...this.state.apps, [id]: newAppRecord() };
    storage.set('apps', apps);
    this.go('apply', { applyId: id, apps });
  };

  /** 「申請の準備」を直接開いたときも、記録を作っておく */
  ensureApp = (id: string): void => {
    if (this.state.applyId === id && this.state.apps[id]) return;
    if (this.state.apps[id]) this.set({ applyId: id });
    else this.updateApp(id, rec => rec, { applyId: id });
  };

  setStep = (id: string, step: number): void => this.updateApp(id, rec => ({ ...rec, step: Math.min(3, Math.max(0, step)) }));

  setCheck = (id: string, needId: string, on: boolean): void =>
    this.updateApp(id, rec => ({ ...rec, checks: { ...rec.checks, [needId]: on } }));

  setAnswer = (id: string, key: 'q1' | 'q2', text: string): void => this.updateApp(id, rec => ({ ...rec, [key]: text }));

  setDraftPart = (id: string, partId: string, text: string): void =>
    this.updateApp(id, rec => ({ ...rec, draft: { ...rec.draft, [partId]: text } }));

  /** 下書きのひな形を作る。2つの質問に答えていなければ作らない */
  makeDraft = (id: string): 'need-answers' | 'made' | 'none' => {
    const spec = this.model.programs.find(p => p.id === id)?.apply?.draft;
    if (!spec) return 'none';
    const rec = this.state.apps[id] ?? newAppRecord();
    if (!rec.q1.trim() || !rec.q2.trim()) return 'need-answers';
    this.updateApp(id, r => ({ ...r, draft: localDraft(spec, r.q1, r.q2) }));
    return 'made';
  };

  /** 「提出した」の印。日付（日本時間）を記録する */
  setDone = (id: string, done: boolean): void =>
    this.updateApp(id, rec => ({ ...rec, done: done ? monthDay(todayJst(this.env.now())) : '' }));

  /* ---------- AIに聞く ---------- */

  setDock = (open: boolean, focus = false): void => {
    storage.setRaw('dock', open ? '1' : '0');
    this.set({ dock: open, focusAsk: open && focus ? this.state.focusAsk + 1 : this.state.focusAsk });
  };

  isOverlay = (): boolean => this.env.isOverlay();
  now = (): Date => this.env.now();
}
