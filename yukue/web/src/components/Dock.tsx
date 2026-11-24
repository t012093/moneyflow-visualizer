/**
 * 「AIに聞く」。広い画面では右の列に常設し、狭い画面では上にかぶせて開く。
 * 答えるのは chat（ChatController）で、ここは表示と入力だけを受け持つ。
 */
import { useEffect, useLayoutEffect, useRef } from 'react';
import type { ChatMessage } from '../chat/controller.ts';
import { screenLabel, suggestions } from '../chat/screen.ts';
import { fmtCho } from '../lib/format.ts';
import { useMediaQuery } from '../lib/hooks.ts';
import { useApp, useChatState, useUi } from '../state/context.tsx';
import { OVERLAY_QUERY } from '../state/store.ts';
import { Ic } from './Icons.tsx';

function Figure({ figure }: { figure: NonNullable<ChatMessage['figure']> }) {
  const { model } = useApp();
  const max = Math.max(...figure.items.map(i => i.v), 0) || 1;
  return (
    <div className="fig">
      <p className="fig-t">{figure.title}</p>
      {figure.items.map((i, k) => (
        <div className="hb" key={k}>
          <span className="hb-n">{i.name}</span>
          <span className="hb-t">
            <span
              className="hb-b"
              style={{ width: ((i.v / max) * 100).toFixed(1) + '%', background: i.theme ? model.themeVar(i.theme) : 'var(--flow-neutral)' }}
            />
          </span>
          <span className="hb-v">{fmtCho(i.v)}</span>
        </div>
      ))}
    </div>
  );
}

export function Dock() {
  const { store, chat, model } = useApp();
  const st = useUi();
  const cs = useChatState();
  const overlay = useMediaQuery(OVERLAY_QUERY);
  const msgsRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // 会話が進んだら、いちばん下を見せる
  useLayoutEffect(() => {
    const el = msgsRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [cs.messages, st.dock]);

  // ボタンで開いたときは、入力欄にフォーカスを移す
  useEffect(() => {
    if (st.focusAsk > 0) inputRef.current?.focus();
  }, [st.focusAsk]);

  // 本文にかぶさっているあいだは、うしろの画面をスクロールさせない
  useEffect(() => {
    document.body.style.overflow = st.dock && overlay ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [st.dock, overlay]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && store.getState().dock && store.isOverlay()) store.setDock(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [store]);

  // 入力欄の高さを、中身に合わせる（120px まで）。何か入力するまでは、1行ぶんの自然な高さのまま
  const typed = useRef(false);
  useLayoutEffect(() => {
    const t = inputRef.current;
    if (cs.input) typed.current = true;
    if (!t || !typed.current) return;
    t.style.height = 'auto';
    t.style.height = Math.min(t.scrollHeight, 120) + 'px';
  }, [cs.input, st.dock]);

  const send = (): void => {
    void chat.ask(cs.input);
  };

  return (
    <aside className="dock" id="dock" aria-label="AIに聞く">
      <header className="dock-h">
        <div className="dock-t">
          <Ic name="spark" />
          <strong>AIに聞く</strong>
          <span className="tag">{chat.provider.modeLabel}</span>
        </div>
        <button className="icon-btn" type="button" aria-label="閉じる" onClick={() => store.setDock(false)}>
          <Ic name="x" />
        </button>
      </header>
      <p className="ctx">
        いま見ている画面：<b>{screenLabel(model, st)}</b>
      </p>
      <div className="msgs" ref={msgsRef} role="log" aria-live="polite" aria-busy={cs.busy}>
        {cs.messages.map(m =>
          m.role === 'user' ? (
            <div className="msg user" key={m.id}>
              <div className="bub">{m.text}</div>
            </div>
          ) : (
            <div className="msg ai" key={m.id}>
              <div className={'bub' + (m.thinking ? ' thinking' : '')}>{m.thinking ? '考えています…' : m.text}</div>
              {m.figure && <Figure figure={m.figure} />}
              {m.action && (
                <button className="act" type="button" onClick={() => m.action && chat.runAction(m.action.run)}>
                  <Ic name="arrow" />
                  {m.action.label}
                </button>
              )}
              {m.source && <p className="msrc">{m.source}</p>}
            </div>
          )
        )}
      </div>
      <div className="sugg">
        {!cs.busy &&
          suggestions(model, st).map(q => (
            <button key={q} type="button" onClick={() => void chat.ask(q)}>
              {q}
            </button>
          ))}
      </div>
      <form
        className="composer"
        onSubmit={e => {
          e.preventDefault();
          send();
        }}
      >
        <label className="sr" htmlFor="q">
          質問を入力
        </label>
        <textarea
          id="q"
          ref={inputRef}
          rows={1}
          placeholder="例：防衛費はどこへ行く？"
          value={cs.input}
          onChange={e => chat.setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
        />
        {cs.busy ? (
          <button className="send" type="button" aria-label="止める" onClick={chat.stop}>
            <Ic name="stop" />
          </button>
        ) : (
          <button className="send" type="submit" aria-label="送信">
            <Ic name="send" />
          </button>
        )}
      </form>
      <p className="dock-foot">{chat.provider.footnote}</p>
    </aside>
  );
}

/** 狭い画面で「AIに聞く」を開いているあいだ、うしろの画面をうすく覆う。押すと閉じる */
export function Scrim() {
  const { store } = useApp();
  const st = useUi();
  const overlay = useMediaQuery(OVERLAY_QUERY);
  return <div className="scrim" hidden={!(st.dock && overlay)} onClick={() => store.setDock(false)} />;
}
