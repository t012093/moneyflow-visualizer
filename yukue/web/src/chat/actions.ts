/** 答えに付いてきた操作（ViewAction）で、画面を動かす。 */
import type { AppStore } from '../state/store.ts';
import type { ViewAction } from './types.ts';

export function runViewAction(store: AppStore, action: ViewAction): void {
  switch (action.kind) {
    case 'flow':
      store.selectFlow(action.id, { drill: action.drill });
      break;
    case 'updates':
      store.showUpdates(action.type, action.theme);
      break;
    case 'update':
      store.openUpdate(action.id);
      break;
    case 'programs':
      store.showPrograms(action.aud, !!action.matched);
      break;
    case 'view':
      store.go(action.view);
      break;
    case 'apply':
      store.startApply(action.id);
      break;
  }
}
