/** AIとつなぐ：外のAI（Claude など）から、ゆくえをコネクターとして使うときの見え方と、つなぎ方。 */
import { useEffect, useRef, useState } from 'react';
import { FlowDiagram } from '../components/FlowDiagram.tsx';
import { Ic, Seal } from '../components/Icons.tsx';
import { MCP_URL, TOOLS } from '../content.ts';
import { fmtCho } from '../lib/format.ts';
import { useApp } from '../state/context.ts';

export function ConnectView() {
  const { store, model } = useApp();
  const { fy, fmt } = model;
  const urlRef = useRef<HTMLElement>(null);
  const timer = useRef(0);
  const [copyLabel, setCopyLabel] = useState('コピー');
  useEffect(() => () => window.clearTimeout(timer.current), []);

  // 会話の見本は「防衛費」。データに内訳がなければ、図と説明は出さない
  const d = model.useById.get('defense');
  const flow = d ? model.drill(d.id) : null;
  const top = d?.drill ? [...d.drill.items].sort((a, b) => b.v - a.v) : [];
  const [t0, t1] = top;

  const copyUrl = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(MCP_URL);
      setCopyLabel('コピーしました');
    } catch {
      // コピーできないときは、URLを選んだ状態にして、手でコピーできるようにする
      const code = urlRef.current;
      const sel = window.getSelection();
      if (code && sel) {
        const range = document.createRange();
        range.selectNodeContents(code);
        sel.removeAllRanges();
        sel.addRange(range);
      }
      setCopyLabel('選択しました');
    }
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopyLabel('コピー'), 1800);
  };

  return (
    <section className="view" id="v-connect" data-view="connect">
      <header className="vh">
        <p className="eyebrow">コネクター（MCP Apps）</p>
        <h1 className="vt">いつものAIから、そのまま聞ける</h1>
        <p className="lead">
          ゆくえをClaudeやChatGPTにつなぐと、会話の中で国のお金の流れを調べられます。対応するアプリでは、図も会話の中にそのまま表示されます。
        </p>
      </header>
      <div className="con-grid">
        <figure className="panel mock">
          <div className="mock-bar">
            <Ic name="spark" />
            AIアシスタントの会話画面（表示イメージ）
          </div>
          <div className="mock-body">
            <p className="m-user">防衛費って、何に使われているの？</p>
            <div className="m-ai">
              <p className="m-call">
                <Ic name="plug" />
                ゆくえ ・ show_flow を使用
              </p>
              {d && flow && (
                <div className="widget">
                  <div className="widget-h">
                    <span>
                      <Seal size={16} />
                      {`お金の流れ › ${d.name}`}
                    </span>
                    <button
                      className="btn btn-ghost"
                      type="button"
                      style={{ minHeight: 30, padding: '0 10px', fontSize: 12 }}
                      onClick={() => store.selectFlow(d.id, { drill: true })}
                    >
                      ゆくえで開く
                    </button>
                  </div>
                  <div className="widget-b">
                    <div className="flow-scroll">
                      <FlowDiagram
                        model={flow}
                        fmt={fmtCho}
                        pct={fmt.pct}
                        themeVar={model.themeVar}
                        compact
                        label="防衛費の内訳と届け先"
                      />
                    </div>
                  </div>
                </div>
              )}
              {d && t0 && t1 && (
                <p>
                  {`${fy.label}の${d.long || d.name}は${fmtCho(d.v)}で、一般会計の${fmt.pct(d.v)}です。いちばん大きいのは${t0.name}（${fmtCho(t0.v)}）、次が${t1.name}（${fmtCho(t1.v)}）です。図の項目を押すと、届け先ごとの金額を確認できます。`}
                </p>
              )}
              <p className="srcs">
                出典<span className="srcl">{fy.srcChip}</span>
                <span className="srcl">内訳はサンプル</span>
              </p>
            </div>
          </div>
          <figcaption className="cap">
            コネクターが返した図は、会話の中でそのまま操作できます。押した項目について、続けてAIに聞くこともできます。
          </figcaption>
        </figure>

        <div className="con-side">
          <section className="panel con-card">
            <h2>つなぎ方（Claudeの場合）</h2>
            <ol className="stepsl">
              <li>Claudeの「設定」から「コネクタ」を開く</li>
              <li>「カスタムコネクタを追加」をえらび、下のURLを貼る</li>
              <li>会話で「ゆくえで調べて」と頼む</li>
            </ol>
            <div className="url">
              <code ref={urlRef}>{MCP_URL}</code>
              <button className="btn btn-ghost" type="button" onClick={() => void copyUrl()}>
                <Ic name="copy" />
                <span>{copyLabel}</span>
              </button>
            </div>
            <p>
              公開されている情報を調べるだけなら、ログインは要りません。自分の設定に合う制度を聞くときだけ、ゆくえへのログインを求めます。ChatGPTなど、同じ規格（MCP
              Apps）に対応したAIにも同じサーバーでつなげる想定です。URLは見本です。
            </p>
          </section>
          <section className="panel con-card">
            <h2>AIが使える道具</h2>
            <div>
              {TOOLS.map(t => (
                <div className="tool" key={t.name}>
                  <code>{t.name}</code>
                  <span className="ro">{t.badge ?? '読み取り専用'}</span>
                  <p>{t.desc}</p>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>

      <section className="con-where">
        <h2 className="sec-h">
          どこで図が出るか<small>2026年11月時点の公式ドキュメントにもとづく</small>
        </h2>
        <div className="tbl-wrap">
          <table className="tbl wrap">
            <thead>
              <tr>
                <th>使う場所</th>
                <th>図の表示</th>
                <th>補足</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Claude（Web・デスクトップ・スマホアプリ）</td>
                <td>会話の中に表示</td>
                <td>カスタムコネクタとしてURLで追加できる</td>
              </tr>
              <tr>
                <td>ChatGPT</td>
                <td>会話の中に表示</td>
                <td>同じ規格（MCP Apps）で動く</td>
              </tr>
              <tr>
                <td>Claude Code</td>
                <td>テキストのみ</td>
                <td>道具は呼べるが、図は描画されない</td>
              </tr>
              <tr>
                <td>ゆくえのアプリ内チャット</td>
                <td>画面の図が連動</td>
                <td>同じ道具を使い、アプリ自身の図を動かす</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}
