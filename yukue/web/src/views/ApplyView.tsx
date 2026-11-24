/**
 * 申請の準備：対象の確認 → そろえるもの → 下書き → 提出。
 * 手伝うのは確認と下書きまで。提出は、ご本人が公式の窓口で行う。
 */
import { useEffect, useRef, useState } from 'react';
import { Ic } from '../components/Icons.tsx';
import { ASTEPS, LV } from '../content.ts';
import { draftText, hasDraft, newAppRecord } from '../lib/apply.ts';
import { matchProgram } from '../lib/match.ts';
import { profileSummary } from '../lib/profile.ts';
import { isHttps } from '../lib/updates.ts';
import { useApp, useUi } from '../state/context.tsx';
import { applyProgramOf } from '../state/store.ts';

const COPY_LABEL = '下書きをコピー';

export function ApplyView() {
  const { store, chat, model } = useApp();
  const st = useUi();
  const p = applyProgramOf(model, st);
  const pid = p?.id ?? null;
  const [draftNote, setDraftNote] = useState('');
  const [copyLabel, setCopyLabel] = useState(COPY_LABEL);
  const currentStep = useRef<HTMLButtonElement>(null);
  const focusStep = useRef(false);
  const copyTimer = useRef(0);

  // 直接この画面を開いたときも、記録を作っておく（マイページの「申請の準備と記録」に残る）
  useEffect(() => {
    if (pid) store.ensureApp(pid);
  }, [store, pid]);

  const step = (pid ? st.apps[pid]?.step : undefined) ?? 0;
  // 段階を切り替えたら、いまの段階の見出しにフォーカスを移す
  useEffect(() => {
    setDraftNote('');
    if (focusStep.current) {
      focusStep.current = false;
      currentStep.current?.focus();
    }
  }, [step]);

  useEffect(() => () => window.clearTimeout(copyTimer.current), []);

  const ap = p?.apply;
  if (!p || !ap) {
    return (
      <section className="view" id="v-apply" data-view="apply">
        <header className="vh">
          <p className="eyebrow">
            <a className="lnk" href="#find">
              制度をさがす
            </a>{' '}
            ・ 申請の準備
          </p>
          <h1 className="vt">申請の準備</h1>
        </header>
        <p className="empty">申請の準備ができる制度は、いまのところありません。</p>
      </section>
    );
  }

  const a = st.apps[p.id] ?? newAppRecord();
  const m = matchProgram(p, st.pf);
  const d = ap.draft;
  const drafted = hasDraft(d, a);

  const goStep = (n: number): void => {
    focusStep.current = true;
    store.setStep(p.id, n);
  };
  const nav = (prev: number | null, next: number | null) => (
    <div className="d-act">
      {prev != null && (
        <button className="btn btn-ghost" type="button" onClick={() => goStep(prev)}>
          戻る
        </button>
      )}
      {next != null && (
        <button className="btn btn-solid" type="button" onClick={() => goStep(next)}>
          {`次へ：${ASTEPS[next]}`}
          <Ic name="chev" />
        </button>
      )}
    </div>
  );
  const makeDraft = (): void => {
    const result = store.makeDraft(p.id);
    setDraftNote(
      result === 'need-answers'
        ? '2つの質問に答えてから押してください。'
        : result === 'made'
          ? '下書きができました。事実を確かめて、自分の言葉に直してください。'
          : ''
    );
  };
  const copyDraft = async (): Promise<void> => {
    if (!d) return;
    try {
      await navigator.clipboard.writeText(draftText(d, a));
      setCopyLabel('コピーしました');
    } catch {
      setCopyLabel('コピーできませんでした');
    }
    window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => setCopyLabel(COPY_LABEL), 1800);
  };

  let body;
  if (step === 0) {
    body = (
      <>
        <h2>対象になりそうか</h2>
        {m ? (
          <>
            <p className={`match ${m.lv}`}>
              <b>{LV[m.lv].n}</b>
            </p>
            <ul className="chk">
              {m.why.map(w => (
                <li className="ok" key={w}>
                  <Ic name="check" />
                  {w}
                </li>
              ))}
              {m.ask.map(w => (
                <li key={w}>
                  <Ic name="search" />
                  {`たしかめること：${w}`}
                </li>
              ))}
            </ul>
            <p className="cap">
              {`設定（${profileSummary(st.pf)}）をもとにした、サンプルの規則によるめやすです。正式な条件は、公募要領などで確認してください。`}
            </p>
          </>
        ) : (
          <p>設定がまだないので、判定できません。マイページで立場などを入れると、ここに結果が出ます。</p>
        )}
        <div className="d-act">
          <button className="btn btn-solid" type="button" onClick={() => goStep(1)}>
            {`次へ：${ASTEPS[1]}`}
            <Ic name="chev" />
          </button>
          <button className="btn btn-ghost" type="button" onClick={() => void chat.ask(`「${p.name}」の対象になる条件を教えて`)}>
            <Ic name="spark" />
            条件をAIに確認
          </button>
          <a className="btn btn-ghost" href="#me">
            {m ? '設定を直す' : '設定を入れる'}
          </a>
        </div>
      </>
    );
  } else if (step === 1) {
    body = (
      <>
        <h2>そろえるもの</h2>
        <ul className="needs">
          {ap.needs.map(n => (
            <li key={n.id}>
              <label htmlFor={`need-${n.id}`}>
                <input
                  type="checkbox"
                  id={`need-${n.id}`}
                  checked={!!a.checks[n.id]}
                  onChange={e => store.setCheck(p.id, n.id, e.target.checked)}
                />
                <span>
                  <b>{n.name}</b>
                  <small>{n.note}</small>
                </span>
              </label>
            </li>
          ))}
        </ul>
        <p className="cap">サンプルの一覧です。正式に必要なものは、公募要領や窓口で確認してください。</p>
        {nav(0, 2)}
      </>
    );
  } else if (step === 2 && d) {
    body = (
      <>
        <h2>下書きをつくる</h2>
        <p>
          2つの質問に短く答えると、AIが申請書の文章の下書きを作ります。下書きはそのまま出さず、事実を確かめて、自分の言葉に直してください。
        </p>
        <div className="field">
          <label className="f-l" htmlFor="aq1">
            {d.q1}
          </label>
          <textarea
            className="ta"
            id="aq1"
            rows={2}
            placeholder={d.q1ph}
            value={a.q1}
            onChange={e => store.setAnswer(p.id, 'q1', e.target.value)}
          />
        </div>
        <div className="field">
          <label className="f-l" htmlFor="aq2">
            {d.q2}
          </label>
          <textarea
            className="ta"
            id="aq2"
            rows={2}
            placeholder={d.q2ph}
            value={a.q2}
            onChange={e => store.setAnswer(p.id, 'q2', e.target.value)}
          />
        </div>
        <div className="d-act">
          <button className="btn btn-solid" type="button" onClick={makeDraft}>
            <Ic name="spark" />
            {drafted ? '下書きを作り直す' : 'AIに下書きを頼む'}
          </button>
          <span className="f-save" role="status">
            {draftNote}
          </span>
        </div>
        <p className="cap">試作版では、AIの代わりに、あらかじめ用意したひな形で下書きを作ります。</p>
        {drafted &&
          d.parts.map(x => (
            <div className="field" key={x.id}>
              <label className="f-l" htmlFor={`ad-${x.id}`}>
                {x.name} <span className="tag">下書きのひな形</span>
              </label>
              <textarea
                className="ta"
                id={`ad-${x.id}`}
                rows={5}
                value={a.draft[x.id] ?? ''}
                onChange={e => store.setDraftPart(p.id, x.id, e.target.value)}
              />
            </div>
          ))}
        {nav(1, 3)}
      </>
    );
  } else if (step === 2) {
    body = (
      <>
        <h2>下書き</h2>
        <p>
          この制度は、決まった様式に記入して出します。文章の下書きは要りません。記入のしかたが分からないところは、AIに聞けます。
        </p>
        <div className="d-act">
          <button className="btn btn-ghost" type="button" onClick={() => void chat.ask(`「${p.name}」の申請で気をつけることは？`)}>
            <Ic name="spark" />
            AIに聞く
          </button>
        </div>
        {nav(1, 3)}
      </>
    );
  } else {
    body = (
      <>
        <h2>提出する</h2>
        <p>
          <b>{`提出先：${ap.where}`}</b>
          {`　${ap.whereNote}`}
        </p>
        <p>提出は、ご本人が公式の窓口で行います。ゆくえが代わりに送信することはありません。</p>
        <div className="d-act">
          {isHttps(ap.url) && (
            <a className="btn btn-solid" href={ap.url} target="_blank" rel="noopener">
              {`${ap.urlName || ap.where}を開く`}
              <Ic name="ext" />
            </a>
          )}
          {drafted && (
            <button className="btn btn-ghost" type="button" onClick={() => void copyDraft()}>
              <Ic name="copy" />
              <span>{copyLabel}</span>
            </button>
          )}
        </div>
        <label className="sw" htmlFor="adone">
          <input type="checkbox" id="adone" checked={!!a.done} onChange={e => store.setDone(p.id, e.target.checked)} />
          <span>
            提出した
            <small>{a.done ? `${a.done}に提出ずみとして記録しました。` : 'チェックすると、マイページに記録します。'}</small>
          </span>
        </label>
        {nav(2, null)}
      </>
    );
  }

  return (
    <section className="view" id="v-apply" data-view="apply">
      <header className="vh">
        <p className="eyebrow">
          <a className="lnk" href="#find">
            制度をさがす
          </a>{' '}
          ・ 申請の準備
        </p>
        <h1 className="vt">{p.name}</h1>
        <p className="lead">AIが、確認と下書きを手伝います。提出は、公式の窓口でご本人が行います。</p>
      </header>
      <ol className="life s4" aria-label="申請の準備の段階">
        {ASTEPS.map((s, i) => (
          <li key={s} className={i < step ? 'done' : i === step ? 'now' : undefined}>
            <button
              type="button"
              ref={i === step ? currentStep : undefined}
              aria-current={i === step ? 'step' : undefined}
              onClick={() => goStep(i)}
            >
              {s}
            </button>
          </li>
        ))}
      </ol>
      <section className="panel apply-card">{body}</section>
    </section>
  );
}
