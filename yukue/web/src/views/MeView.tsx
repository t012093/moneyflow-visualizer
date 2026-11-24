/** マイページ：ログイン（画面の再現）、プロフィール、合う制度の数、情報の扱い、申請の記録。 */
import { useState } from 'react';
import { Chip } from '../components/Bits.tsx';
import { Ic } from '../components/Icons.tsx';
import { AIMS, ASTEPS, BFORM, INCOME, INDUSTRY, KIDS, KIND, KOYO, OFORM, PREFS, WORK } from '../content.ts';
import { matchPrograms } from '../lib/match.ts';
import { cleanProfile, type AimId, type KidsId, type KindId, type Profile } from '../lib/profile.ts';
import { useApp, useUi } from '../state/context.tsx';
import { PresetButtons } from './FindView.tsx';

const keysOf = <T extends string>(map: Record<T, string>): T[] => Object.keys(map) as T[];

function Options({ map, empty = 'えらぶ' }: { map: Record<string, string>; empty?: string }) {
  return (
    <>
      <option value="">{empty}</option>
      {Object.entries(map).map(([k, n]) => (
        <option key={k} value={k}>
          {n}
        </option>
      ))}
    </>
  );
}

export function MeView() {
  const { store, model } = useApp();
  const st = useUi();
  const { pf, login } = st;
  const k = pf.kind;
  /** 「保存しました」を出すか（この画面で何か変えたあとだけ） */
  const [saved, setSaved] = useState(false);
  /** 消す前に、もう一度押してもらう */
  const [wipeArm, setWipeArm] = useState(false);

  const touch = (): void => {
    setSaved(true);
    setWipeArm(false);
  };
  /** 入力欄・選択欄：知っている値だけを受け取り、値が変わったときだけ保存する */
  const setField = <K extends keyof Profile>(key: K, raw: string): void => {
    const value = cleanProfile({ ...pf, [key]: raw })[key];
    if (store.setProfileField(key, value)) setSaved(true);
  };

  const matches = matchPrograms(model.programs, pf);
  const high = matches.filter(x => x.m.lv === 'high').length;
  const mid = matches.filter(x => x.m.lv === 'when' || x.m.lv === 'later' || x.m.lv === 'maybe').length;
  const apps = Object.entries(st.apps).flatMap(([id, rec]) => {
    const p = model.programs.find(x => x.id === id && x.apply);
    return p ? [{ p, rec }] : [];
  });

  const aims = (
    <div className="field">
      <span className="f-l" id="l-aims">
        取り組みたいこと
      </span>
      <div className="chips" role="group" aria-labelledby="l-aims">
        {keysOf<AimId>(AIMS).map(v => (
          <Chip
            key={v}
            pressed={pf.aims.includes(v)}
            onClick={() => {
              store.toggleAim(v);
              touch();
            }}
          >
            {AIMS[v]}
          </Chip>
        ))}
      </div>
    </div>
  );
  const staffField = (label: string) => (
    <div className="field">
      <label className="f-l" htmlFor="pf-staff">
        {label}
      </label>
      <input
        className="inp"
        id="pf-staff"
        type="number"
        min={0}
        inputMode="numeric"
        value={pf.staff}
        onChange={e => setField('staff', e.target.value)}
      />
    </div>
  );

  return (
    <section className="view" id="v-me" data-view="me">
      <header className="vh">
        <p className="eyebrow">マイページ</p>
        <h1 className="vt">あなたの設定</h1>
        <p className="lead">入れた内容は、合う制度をさがすために使います。どの項目も、入れなくてかまいません。</p>
      </header>
      <div className="me-grid">
        <div className="me-col">
          <section className="panel me-card">
            {login ? (
              <>
                <h2 className="sec-h">
                  ログイン中<small>サンプルのアカウント</small>
                </h2>
                <ul className="chk">
                  <li className="ok">
                    <Ic name="check" />
                    設定を、ほかの端末でも使える
                  </li>
                  <li className="ok">
                    <Ic name="check" />
                    フォロー中のテーマと締切を通知する
                  </li>
                  <li className="ok">
                    <Ic name="check" />
                    申請の準備と記録を残す
                  </li>
                </ul>
                <div className="d-act">
                  <button
                    className="btn btn-ghost"
                    type="button"
                    onClick={() => {
                      store.setLogin(false);
                      touch();
                    }}
                  >
                    ログアウト
                  </button>
                </div>
              </>
            ) : (
              <>
                <h2 className="sec-h">ログイン</h2>
                <p>
                  ログインすると、設定をほかの端末でも使えて、締切の通知と申請の記録ができます。ログインしなくても、この端末に保存して使えます。
                </p>
                <div className="d-act">
                  <button
                    className="btn btn-solid"
                    type="button"
                    onClick={() => {
                      store.setLogin(true);
                      touch();
                    }}
                  >
                    メールアドレスでログイン
                  </button>
                  <button
                    className="btn btn-ghost"
                    type="button"
                    onClick={() => {
                      store.setLogin(true);
                      touch();
                    }}
                  >
                    パスキーでログイン
                  </button>
                </div>
                <p className="cap">サンプルなので、実際の認証は行いません。押すと、ログインした状態の画面になります。</p>
              </>
            )}
          </section>

          <section className="panel me-card">
            <h2 className="sec-h">
              プロフィール<small>どの項目も任意です</small>
            </h2>
            <div className="field">
              <span className="f-l" id="l-kind">
                立場
              </span>
              <div className="chips" role="group" aria-labelledby="l-kind">
                {keysOf<KindId>(KIND).map(v => (
                  <Chip
                    key={v}
                    pressed={k === v}
                    onClick={() => {
                      store.toggleKind(v);
                      touch();
                    }}
                  >
                    {KIND[v]}
                  </Chip>
                ))}
              </div>
            </div>
            {!k && (
              <div className="pf-act">
                <PresetButtons onUse={touch} />
              </div>
            )}
            {k && (
              <div className="field">
                <label className="f-l" htmlFor="pf-pref">
                  {k === 'person' ? '住んでいる' : '活動している'}都道府県
                </label>
                <select className="sel" id="pf-pref" value={pf.pref} onChange={e => setField('pref', e.target.value)}>
                  <option value="">えらぶ</option>
                  {PREFS.map(p => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
                <p className="f-h">地域の制度をさがすのに使います（このサンプルに入っているのは国の制度だけです）。</p>
              </div>
            )}
            {k === 'person' && (
              <>
                <div className="field">
                  <span className="f-l" id="l-kids">
                    子ども
                  </span>
                  <div className="chips" role="group" aria-labelledby="l-kids">
                    {keysOf<KidsId>(KIDS).map(v => (
                      <Chip
                        key={v}
                        pressed={pf.kids.includes(v)}
                        onClick={() => {
                          store.toggleKid(v);
                          touch();
                        }}
                      >
                        {KIDS[v]}
                      </Chip>
                    ))}
                  </div>
                </div>
                <div className="f-row">
                  <div className="field">
                    <label className="f-l" htmlFor="pf-work">
                      働き方
                    </label>
                    <select className="sel" id="pf-work" value={pf.work} onChange={e => setField('work', e.target.value)}>
                      <Options map={WORK} />
                    </select>
                  </div>
                  <div className="field">
                    <label className="f-l" htmlFor="pf-koyo">
                      雇用保険
                    </label>
                    <select className="sel" id="pf-koyo" value={pf.koyo} onChange={e => setField('koyo', e.target.value)}>
                      <Options map={KOYO} />
                    </select>
                  </div>
                  <div className="field">
                    <label className="f-l" htmlFor="pf-income">
                      世帯の年収のめやす
                    </label>
                    <select className="sel" id="pf-income" value={pf.income} onChange={e => setField('income', e.target.value)}>
                      <Options map={INCOME} empty="答えない" />
                    </select>
                  </div>
                </div>
              </>
            )}
            {k === 'biz' && (
              <>
                <div className="f-row">
                  <div className="field">
                    <label className="f-l" htmlFor="pf-bform">
                      事業の形
                    </label>
                    <select className="sel" id="pf-bform" value={pf.bform} onChange={e => setField('bform', e.target.value)}>
                      <Options map={BFORM} />
                    </select>
                  </div>
                  <div className="field">
                    <label className="f-l" htmlFor="pf-industry">
                      業種
                    </label>
                    <select className="sel" id="pf-industry" value={pf.industry} onChange={e => setField('industry', e.target.value)}>
                      <Options map={INDUSTRY} />
                    </select>
                  </div>
                  {staffField('従業員の数')}
                  <div className="field">
                    <label className="f-l" htmlFor="pf-years">
                      創業からの年数
                    </label>
                    <input
                      className="inp"
                      id="pf-years"
                      type="number"
                      min={0}
                      inputMode="numeric"
                      value={pf.years}
                      onChange={e => setField('years', e.target.value)}
                    />
                  </div>
                </div>
                {aims}
              </>
            )}
            {k === 'npo' && (
              <>
                <div className="f-row">
                  <div className="field">
                    <label className="f-l" htmlFor="pf-oform">
                      団体の形
                    </label>
                    <select className="sel" id="pf-oform" value={pf.oform} onChange={e => setField('oform', e.target.value)}>
                      <Options map={OFORM} />
                    </select>
                  </div>
                  {staffField('職員の数')}
                </div>
                {aims}
              </>
            )}
            <p className="f-save" role="status">
              {saved && k ? (login ? '保存しました（ログイン中のほかの端末にも反映されます）' : 'この端末に保存しました') : ''}
            </p>
          </section>
        </div>

        <div className="me-col">
          <section className="panel me-card" aria-live="polite">
            <h2 className="sec-h">いまの設定で合う制度</h2>
            {k ? (
              <>
                <div className="pv-row">
                  <p className="big-n">
                    {high}
                    <small>件 対象の可能性が高い</small>
                  </p>
                  <p className="big-n">
                    {mid}
                    <small>件 条件しだい</small>
                  </p>
                </div>
                <div className="d-act">
                  <button className="btn btn-solid" type="button" onClick={() => store.setFindMode('match')}>
                    合う制度を見る
                    <Ic name="chev" />
                  </button>
                </div>
                <p className="cap">判定は、サンプルの規則によるめやすです。</p>
              </>
            ) : (
              <p>立場をえらぶと、合いそうな制度の数がここに出ます。</p>
            )}
          </section>

          <section className="panel me-card">
            <h2 className="sec-h">情報の扱い</h2>
            <label className="sw" htmlFor="pf-ai">
              <input type="checkbox" id="pf-ai" checked={pf.useInAi} onChange={e => store.setUseInAi(e.target.checked)} />
              <span>
                AIの回答に、この設定を使う<small>オフにすると、AIには設定を渡しません。</small>
              </span>
            </label>
            <ul className="chk">
              <li className="ok">
                <Ic name="check" />
                保存する場所は、この端末です。ログインすると、暗号化して同期します。
              </li>
              <li className="ok">
                <Ic name="check" />
                合う制度の判定と、申請の下書きにだけ使います。
              </li>
              <li className="ok">
                <Ic name="check" />
                広告や、ほかの会社への提供には使いません。
              </li>
            </ul>
            <div className="d-act">
              <button
                className="btn btn-ghost"
                type="button"
                onClick={() => {
                  if (!wipeArm) {
                    setWipeArm(true);
                    return;
                  }
                  setWipeArm(false);
                  setSaved(false);
                  store.wipe();
                }}
              >
                {wipeArm ? 'もう一度押すと消えます' : 'この端末の設定を消す'}
              </button>
            </div>
          </section>

          <section className="panel me-card">
            <h2 className="sec-h">申請の準備と記録</h2>
            {apps.length ? (
              apps.map(({ p, rec }) => (
                <button
                  className="d-link"
                  type="button"
                  key={p.id}
                  onClick={() => store.startApply(p.id)}
                >
                  <span className="d-link-t">{p.name}</span>
                  <span className="d-link-m">{rec.done ? `${rec.done}に提出ずみ` : `準備中（${ASTEPS[rec.step] ?? ASTEPS[0]}）`}</span>
                  <Ic name="chev" />
                </button>
              ))
            ) : (
              <p>まだありません。「制度をさがす」で制度をえらび、「申請の準備をする」を押すと、ここに残ります。</p>
            )}
          </section>
        </div>
      </div>
    </section>
  );
}
