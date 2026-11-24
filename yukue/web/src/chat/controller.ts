/**
 * 「AIに聞く」の会話の進行。質問を provider に渡し、答えを少しずつ表示して、画面も動かす。
 * 画面（Dock）からは useSyncExternalStore で読む。
 */
import { CHAT_GREETING } from '../content.ts';
import { todayJst } from '../lib/dates.ts';
import type { AppStore } from '../state/store.ts';
import { runViewAction } from './actions.ts';
import { screenLabel } from './screen.ts';
import type { ChatProvider, ChatReply, ViewAction } from './types.ts';

export interface ChatMessage {
  id: number;
  role: 'user' | 'ai';
  text: string;
  /** 答えを待っているあいだ */
  thinking?: boolean;
  figure?: ChatReply['figure'];
  action?: ChatReply['action'];
  source?: string;
}

export interface ChatState {
  messages: ChatMessage[];
  busy: boolean;
  /** 入力欄の文字 */
  input: string;
}

const FAILED = 'うまく答えを取得できませんでした。もう一度お試しください。';
const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));

export class ChatController {
  readonly provider: ChatProvider;
  private readonly store: AppStore;
  private readonly reducedMotion: () => boolean;
  private state: ChatState;
  private readonly listeners = new Set<() => void>();
  private nextId = 1;
  private ctl: AbortController | null = null;

  constructor(store: AppStore, provider: ChatProvider, reducedMotion: () => boolean = () => false) {
    this.store = store;
    this.provider = provider;
    this.reducedMotion = reducedMotion;
    this.state = { messages: [{ id: 0, role: 'ai', text: CHAT_GREETING }], busy: false, input: '' };
  }

  getState = (): ChatState => this.state;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  private set(patch: Partial<ChatState>): void {
    this.state = { ...this.state, ...patch };
    for (const fn of [...this.listeners]) fn();
  }

  private patchMessage(id: number, patch: Partial<ChatMessage>): void {
    this.set({ messages: this.state.messages.map(m => (m.id === id ? { ...m, ...patch } : m)) });
  }

  setInput = (input: string): void => this.set({ input });

  /** 答えを待つのをやめる（表示の途中なら、残りをすぐに出す） */
  stop = (): void => {
    this.ctl?.abort();
  };

  /** 答えに付いたボタンを押したとき */
  runAction = (action: ViewAction): void => {
    runViewAction(this.store, action);
    if (this.store.isOverlay()) this.store.setDock(false);
  };

  ask = async (question: string): Promise<void> => {
    const q = String(question ?? '').trim();
    if (!q || this.state.busy) return;
    const store = this.store;
    if (!store.getState().dock) store.setDock(true);

    const userId = this.nextId++;
    const aiId = this.nextId++;
    this.set({
      input: '',
      busy: true,
      messages: [
        ...this.state.messages,
        { id: userId, role: 'user', text: q },
        { id: aiId, role: 'ai', text: '', thinking: true }
      ]
    });

    const ctl = new AbortController();
    this.ctl = ctl;
    let streamed = '';
    try {
      const st = store.getState();
      const reply = await this.provider.ask(
        q,
        { model: store.model, state: st, screen: screenLabel(store.model, st), today: todayJst(store.now()) },
        {
          signal: ctl.signal,
          onText: text => {
            streamed = text;
            this.patchMessage(aiId, { text, thinking: false });
          }
        }
      );
      // 画面は、答えを表示しはじめる前に動かす
      if (reply.action) runViewAction(store, reply.action.run);
      if (!streamed && !this.reducedMotion()) {
        for (let i = 0; i <= reply.text.length && !ctl.signal.aborted; i += 3) {
          this.patchMessage(aiId, { text: reply.text.slice(0, i), thinking: false });
          await sleep(12);
        }
      }
      this.patchMessage(aiId, {
        text: reply.text,
        thinking: false,
        figure: reply.figure,
        action: reply.action,
        source: reply.source
      });
    } catch {
      this.patchMessage(aiId, {
        text: ctl.signal.aborted ? (streamed ? streamed + '\n' : '') + '（止めました）' : FAILED,
        thinking: false
      });
    } finally {
      if (this.ctl === ctl) this.ctl = null;
      this.set({ busy: false });
    }
  };
}
