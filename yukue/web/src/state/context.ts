/** 画面のどこからでも、状態（store）・会話（chat）・データ（model）を使えるようにする。 */
import { createContext, useContext, useSyncExternalStore } from 'react';
import type { ChatController, ChatState } from '../chat/controller.ts';
import type { Model } from '../data/model.ts';
import type { AppStore, UiState } from './store.ts';

export interface AppServices {
  store: AppStore;
  chat: ChatController;
  model: Model;
}

/** App.tsx が、データを読み込んだあとに値を入れる */
export const AppContext = createContext<AppServices | null>(null);

export function useApp(): AppServices {
  const v = useContext(AppContext);
  if (!v) throw new Error('AppContext の外では使えません');
  return v;
}

/** 画面の状態。変わるたびに描き直す */
export function useUi(): UiState {
  const { store } = useApp();
  return useSyncExternalStore(store.subscribe, store.getState);
}

/** 会話の状態（「AIに聞く」の中だけで使う） */
export function useChatState(): ChatState {
  const { chat } = useApp();
  return useSyncExternalStore(chat.subscribe, chat.getState);
}
