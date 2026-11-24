/**
 * 画面全体の組み立て。
 * データ（data/*.json）を読み込み、読めたら状態（store）と会話（chat）を作って、いまの画面を出す。
 * 画面の切り替えは、プロトタイプと同じく URL の # で行う（#home、#flow、#updates、#find、#me、#apply、#connect、#about）。
 */
import { useEffect, useLayoutEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { ChatController } from './chat/controller.ts';
import { createLocalProvider } from './chat/local.ts';
import { Dock, Scrim } from './components/Dock.tsx';
import { Header, TabBar } from './components/Header.tsx';
import { IconSprite } from './components/Icons.tsx';
import { TipLayer, hideTip } from './components/Tip.tsx';
import { VIEW_NAMES, type ViewId } from './content.ts';
import { DataLoadError, loadData } from './data/load.ts';
import { buildModel } from './data/model.ts';
import { prefersReducedMotion } from './lib/hooks.ts';
import { storage } from './lib/storage.ts';
import { AppProvider, useApp, useUi, type AppServices } from './state/context.tsx';
import { AppStore, viewFromHash } from './state/store.ts';
import { AboutView } from './views/AboutView.tsx';
import { ApplyView } from './views/ApplyView.tsx';
import { ConnectView } from './views/ConnectView.tsx';
import { FindView } from './views/FindView.tsx';
import { FlowView } from './views/FlowView.tsx';
import { HomeView } from './views/HomeView.tsx';
import { MeView } from './views/MeView.tsx';
import { UpdatesView } from './views/UpdatesView.tsx';

const SITE_TITLE = 'ゆくえ（試作版）';

type Boot =
  | { status: 'loading' }
  | { status: 'error'; failures: { path: string; reason: string }[] }
  | { status: 'ready'; services: AppServices };

/** ページのいちばん上の注意書き */
function SampleNote() {
  return (
    <p className="sample-note">
      <span className="tag">試作版</span>
      <span>
        内訳や届け先の一部は、サンプルの値です。
        <a className="lnk" href="#about">
          くわしく見る
        </a>
      </span>
    </p>
  );
}

const VIEW: Record<ViewId, () => ReactNode> = {
  home: HomeView,
  flow: FlowView,
  updates: UpdatesView,
  find: FindView,
  me: MeView,
  apply: ApplyView,
  connect: ConnectView,
  about: AboutView
};

function Shell() {
  const { store } = useApp();
  const st = useUi();
  const View = VIEW[st.view];

  // URL の # が変わったら（リンク、戻る・進む）、その画面にする
  useEffect(() => {
    const onHash = (): void => store.show(window.location.hash);
    window.addEventListener('hashchange', onHash);
    onHash();
    return () => window.removeEventListener('hashchange', onHash);
  }, [store]);

  // 画面を切り替えたら、いちばん上から見せる
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
    hideTip();
  }, [st.view]);

  useEffect(() => {
    document.title = st.view === 'home' ? SITE_TITLE : `${VIEW_NAMES[st.view]} ・ ${SITE_TITLE}`;
  }, [st.view]);

  // 1件の動き・1つの制度を指して開いたときは、それが見える位置まで動かす
  const reveal = st.reveal;
  useEffect(() => {
    if (!reveal) return;
    const frame = requestAnimationFrame(() => {
      const el = document.getElementById((reveal.kind === 'up' ? 'up-' : 'prog-') + reveal.id);
      if (!el) return;
      const smooth = reveal.kind === 'up' && !prefersReducedMotion();
      el.scrollIntoView({ block: 'center', behavior: smooth ? 'smooth' : 'auto' });
    });
    return () => cancelAnimationFrame(frame);
  }, [reveal]);

  return (
    <>
      <Header view={st.view} login={st.login} dock={st.dock} onToggleDock={() => store.setDock(!st.dock, true)} />
      <div className={st.dock ? 'shell dock-open' : 'shell'} id="shell">
        <main className="main" id="main">
          <SampleNote />
          <View />
        </main>
        <Dock />
      </div>
      <Scrim />
      <TabBar view={st.view} login={st.login} dock={st.dock} onOpenDock={() => store.setDock(true, true)} />
    </>
  );
}

const subscribeHash = (onChange: () => void): (() => void) => {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
};

/** 読み込み中と、読み込めなかったとき。上のナビは先に出しておく */
function BootScreen({ boot, onRetry }: { boot: Exclude<Boot, { status: 'ready' }>; onRetry: () => void }) {
  const view = useSyncExternalStore(subscribeHash, () => viewFromHash(window.location.hash));
  const login = storage.get('login') === true;
  return (
    <>
      <Header view={view} login={login} dock={false} />
      <div className="shell" id="shell">
        <main className="main" id="main">
          {boot.status === 'loading' ? (
            <div className="state" role="status">
              <p>データを読み込んでいます…</p>
            </div>
          ) : (
            <div className="state" role="alert">
              <h1>データを読み込めませんでした</h1>
              <p>通信の状態を確かめて、もう一度お試しください。しばらくしても直らないときは、データの更新中かもしれません。</p>
              {boot.failures.length > 0 && (
                <ul className="state-list">
                  {boot.failures.map(f => (
                    <li key={f.path}>
                      <code>data/{f.path}</code>：{f.reason}
                    </li>
                  ))}
                </ul>
              )}
              <button className="btn btn-solid" type="button" onClick={onRetry}>
                もう一度読み込む
              </button>
            </div>
          )}
        </main>
      </div>
      <TabBar view={view} login={login} dock={false} />
    </>
  );
}

export function App() {
  const [boot, setBoot] = useState<Boot>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const ctl = new AbortController();
    setBoot({ status: 'loading' });
    loadData(ctl.signal).then(
      data => {
        if (ctl.signal.aborted) return;
        const model = buildModel(data);
        const store = new AppStore(model);
        const chat = new ChatController(store, createLocalProvider(), prefersReducedMotion);
        setBoot({ status: 'ready', services: { store, chat, model } });
      },
      (e: unknown) => {
        if (ctl.signal.aborted) return;
        const failures = e instanceof DataLoadError ? e.failures : [];
        setBoot({ status: 'error', failures });
      }
    );
    return () => ctl.abort();
  }, [attempt]);

  return (
    <>
      <IconSprite />
      {boot.status === 'ready' ? (
        <AppProvider value={boot.services}>
          <Shell />
        </AppProvider>
      ) : (
        <BootScreen boot={boot} onRetry={() => setAttempt(n => n + 1)} />
      )}
      <TipLayer />
    </>
  );
}
