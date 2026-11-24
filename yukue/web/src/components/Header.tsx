/** 上のナビと、スマホの下のタブ。 */
import type { ViewId } from '../content.ts';
import { Ic, Seal } from './Icons.tsx';

interface NavProps {
  view: ViewId;
  /** ログイン（の再現）をしているか */
  login: boolean;
  /** 「AIに聞く」を開いているか */
  dock: boolean;
  /** データの読み込みが済むまでは undefined（ボタンは押せない） */
  onToggleDock?: () => void;
  onOpenDock?: () => void;
}

const NAV: readonly (readonly [ViewId, string])[] = [
  ['home', 'ホーム'],
  ['flow', 'お金の流れ'],
  ['updates', '政策の動き'],
  ['find', '制度をさがす'],
  ['connect', 'AIとつなぐ']
];

const current = (view: ViewId, v: ViewId): 'page' | undefined => (view === v ? 'page' : undefined);

export function Header({ view, login, dock, onToggleDock }: NavProps) {
  return (
    <header className="hdr">
      <div className="hdr-in">
        <a className="brand" href="#home" aria-label="ゆくえ ホーム">
          <Seal />
          <span className="brand-name">ゆくえ</span>
          <span className="brand-tag">仮称</span>
        </a>
        <nav className="nav" aria-label="メイン">
          {NAV.map(([v, name]) => (
            <a key={v} href={`#${v}`} aria-current={current(view, v)}>
              {name}
            </a>
          ))}
        </nav>
        <div className="hdr-act">
          <a className="hdr-link m-only" href="#connect" aria-current={current(view, 'connect')} aria-label="AIとつなぐ">
            <Ic name="plug" />
          </a>
          <a className="hdr-link" href="#about" aria-current={current(view, 'about')} aria-label="このサイトについて">
            <Ic name="note" />
            <span>このサイトについて</span>
          </a>
          <a className="hdr-link" href="#me" aria-current={current(view, 'me')} aria-label="マイページ">
            <Ic name="user" />
            <span>{login ? 'マイページ' : 'ログイン'}</span>
          </a>
          <button
            className="btn btn-ai"
            type="button"
            aria-expanded={dock}
            aria-controls="dock"
            disabled={!onToggleDock}
            onClick={onToggleDock}
          >
            <Ic name="spark" />
            AIに聞く
          </button>
        </div>
      </div>
    </header>
  );
}

export function TabBar({ view, onOpenDock }: NavProps) {
  return (
    <nav className="tabbar" aria-label="メイン（下部）">
      <a href="#home" aria-current={current(view, 'home')}>
        <Ic name="home" />
        ホーム
      </a>
      <a href="#flow" aria-current={current(view, 'flow')}>
        <Ic name="flow" />
        流れ
      </a>
      <a href="#updates" aria-current={current(view, 'updates')}>
        <Ic name="pulse" />
        動き
      </a>
      <a href="#find" aria-current={current(view, 'find')}>
        <Ic name="search" />
        制度
      </a>
      <button type="button" disabled={!onOpenDock} onClick={onOpenDock}>
        <Ic name="spark" />
        AIに聞く
      </button>
    </nav>
  );
}
