/**
 * 制度をさがす：設定に合う制度（規則で判定）、すべての制度、Jグランツで受付中の補助金。
 * 前の2つは人が整えた制度（programs/curated.json）、3つめは Jグランツの公開APIから集めたもの。
 */
import { useMemo } from 'react';
import { Chip, Dot, Seg, SrcLink } from '../components/Bits.tsx';
import { Ic } from '../components/Icons.tsx';
import { AUD, LV, type AudId } from '../content.ts';
import { dateTimeLabel, todayJst, untilLabel } from '../lib/dates.ts';
import { fmtYen } from '../lib/format.ts';
import { areaLabel, filterJGrants, jgrantAreas, jgrantStatus } from '../lib/jgrants.ts';
import { matchPrograms, type Match } from '../lib/match.ts';
import { profileSummary, type PresetId } from '../lib/profile.ts';
import { useApp, useUi } from '../state/context.ts';
import { findModeOf, type FindMode } from '../state/store.ts';
import type { JGrant, Program } from '../types.ts';

const AUD_IDS = Object.keys(AUD) as AudId[];

/** 「例でためす」のボタン（設定がまだのときに出す） */
export function PresetButtons({ onUse }: { onUse?: () => void }) {
  const { store } = useApp();
  const use = (id: PresetId): void => {
    store.usePreset(id);
    onUse?.();
  };
  return (
    <>
      <button className="btn btn-ghost" type="button" onClick={() => use('person')}>
        例でためす：子育て中の会社員
      </button>
      <button className="btn btn-ghost" type="button" onClick={() => use('biz')}>
        例でためす：創業2年の個人事業主
      </button>
    </>
  );
}

export function ProgramCard({ p, m }: { p: Program; m: Match | null }) {
  const { store, chat, model } = useApp();
  return (
    <article className="panel prog" id={`prog-${p.id}`}>
      <div className="prog-top">
        <span className="prog-kind">
          <Dot color={model.themeVar(p.theme)} />
          {`${p.kind} ・ ${model.themeName(p.theme)}`}
        </span>
        <span className={`st ${p.status}`}>{p.statusText}</span>
      </div>
      <h2 className="prog-name">{p.name}</h2>
      <p className="prog-amt">
        {p.amt}
        <small>{p.amtNote}</small>
      </p>
      {m && (
        <p className={`match ${m.lv}`}>
          <b>{LV[m.lv].n}</b>
          {m.why.length > 0 && <span>{m.why.join('、')}</span>}
          {m.ask.length > 0 && <span>{`たしかめること：${m.ask.join('、')}`}</span>}
        </p>
      )}
      <dl className="prog-dl">
        <div>
          <dt>対象</dt>
          <dd>{p.who}</dd>
        </div>
        <div>
          <dt>担当</dt>
          <dd>{p.by}</dd>
        </div>
      </dl>
      <div className="prog-act">
        {p.apply && (
          <button className="btn btn-solid" type="button" onClick={() => store.startApply(p.id)}>
            申請の準備をする
          </button>
        )}
        <button className="btn btn-ghost" type="button" onClick={() => void chat.ask(`「${p.name}」の対象になる条件を教えて`)}>
          <Ic name="spark" />
          条件をAIに確認
        </button>
        <SrcLink link={p.link} />
      </div>
    </article>
  );
}

function JGrantCard({ g, today }: { g: JGrant; today: string }) {
  const status = jgrantStatus(g, today);
  const amount = fmtYen(g.maxAmount);
  const until = untilLabel(g.end, today);
  const area = areaLabel(g.area);
  return (
    <article className="panel prog" id={`jg-${g.id}`}>
      <div className="prog-top">
        <span className="prog-kind wrap">補助金{area ? ` ・ ${area}` : ''}</span>
        <span className={`st ${status.cls}`}>{status.text}</span>
      </div>
      <h2 className="prog-name">{g.title}</h2>
      <p className="prog-amt">
        {amount ? `上限 ${amount}` : '上限額の記載なし'}
        <small>補助率や対象の経費は、Jグランツで確認</small>
      </p>
      <dl className="prog-dl">
        <div>
          <dt>地域</dt>
          <dd>{areaLabel(g.area, 8) || '記載なし'}</dd>
        </div>
        <div>
          <dt>締切</dt>
          <dd>{until ?? '記載なし'}</dd>
        </div>
        {g.employees && (
          <div>
            <dt>規模</dt>
            <dd>{g.employees}</dd>
          </div>
        )}
      </dl>
      <div className="prog-act">
        <SrcLink link={{ name: 'Jグランツ', url: g.url }} />
      </div>
    </article>
  );
}

function JGrantList() {
  const { store, model } = useApp();
  const st = useUi();
  const today = todayJst(store.now());
  const file = model.data.jgrants;
  const areas = useMemo(() => jgrantAreas(file.items), [file.items]);
  const open = useMemo(() => filterJGrants(file.items, { query: '', area: '' }, today), [file.items, today]);
  const list = useMemo(
    () => filterJGrants(file.items, { query: st.jgQuery, area: st.jgArea }, today),
    [file.items, st.jgQuery, st.jgArea, today]
  );
  const shown = list.slice(0, st.jgLimit);
  const asOf = dateTimeLabel(file.generatedAt);

  if (!open.length) return <p className="empty">受付中の補助金は、いまのところありません。</p>;
  return (
    <>
      <div className="ctrl">
        <div className="kw">
          <label className="sr" htmlFor="jgQ">
            キーワードでさがす
          </label>
          <input
            className="inp"
            id="jgQ"
            type="search"
            placeholder="キーワードでさがす（補助金の名前・地域）"
            autoComplete="off"
            value={st.jgQuery}
            onChange={e => store.setJgQuery(e.target.value)}
          />
        </div>
        <div className="ctrl-g">
          <label className="ctrl-l" htmlFor="jgArea">
            地域
          </label>
          <select className="sel" id="jgArea" value={st.jgArea} onChange={e => store.setJgArea(e.target.value)}>
            <option value="">すべての地域</option>
            {areas.map(a => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
        <span className="ctrl-l" role="status">
          {list.length.toLocaleString('ja-JP')}件
        </span>
      </div>
      <p className="cap find-note">
        {`デジタル庁の補助金の申請システム「Jグランツ」の公開APIから集めた、受付中の補助金です${asOf ? `（${asOf} 時点）` : ''}。申請の前に、Jグランツで最新の条件を確認してください。`}
      </p>
      {shown.length ? (
        <div className="progs">
          {shown.map(g => (
            <JGrantCard key={g.id} g={g} today={today} />
          ))}
        </div>
      ) : (
        <p className="empty">この条件に合う補助金は、いまのところありません。</p>
      )}
      {list.length > shown.length && (
        <div className="feed-more more">
          <button className="btn btn-ghost" type="button" onClick={store.moreJGrants}>
            もっと見る
          </button>
          <span className="cap">
            {list.length.toLocaleString('ja-JP')}件のうち、{shown.length.toLocaleString('ja-JP')}件を表示しています
          </span>
        </div>
      )}
    </>
  );
}

export function FindView() {
  const { store, model } = useApp();
  const st = useUi();
  const pf = st.pf;
  const has = !!pf.kind;
  const mode = findModeOf(st);
  const matches = useMemo(() => matchPrograms(model.programs, pf), [model.programs, pf]);

  const modes: (readonly [FindMode, string])[] = [
    ...(has ? [['match', 'あなたに合う制度'] as const] : []),
    ['all', 'すべての制度'],
    ['jgrants', '受付中の補助金（Jグランツ）']
  ];

  let body;
  if (mode === 'jgrants') {
    body = <JGrantList />;
  } else if (mode === 'match') {
    const yes = matches.filter(x => x.m.lv !== 'no');
    const no = matches.filter(x => x.m.lv === 'no');
    body = (
      <>
        {yes.length ? (
          <div className="progs">
            {yes.map(x => (
              <ProgramCard key={x.p.id} p={x.p} m={x.m} />
            ))}
          </div>
        ) : (
          <p className="empty">いまの設定に合いそうな制度は、サンプルには入っていません。</p>
        )}
        {no.length > 0 && (
          <details className="more">
            <summary>{`対象外の見込みの制度（${no.length}件）`}</summary>
            <div className="progs">
              {no.map(x => (
                <ProgramCard key={x.p.id} p={x.p} m={x.m} />
              ))}
            </div>
          </details>
        )}
      </>
    );
  } else {
    const list = model.programs.filter(p => st.aud === 'all' || p.aud.includes(st.aud));
    body = list.length ? (
      <div className="progs">
        {list.map(p => (
          <ProgramCard key={p.id} p={p} m={null} />
        ))}
      </div>
    ) : (
      <p className="empty">この立場に合う制度は、サンプルには入っていません。</p>
    );
  }

  return (
    <section className="view" id="v-find" data-view="find">
      <header className="vh">
        <p className="eyebrow">給付 ・ 補助金 ・ 助成金 ・ 減税</p>
        <h1 className="vt">制度をさがす</h1>
        <p className="lead">自分の状況を入れておくと、合う制度が上に並びます。申請の準備も、ここから進められます。</p>
      </header>

      {has ? (
        <p className="pf-bar">
          <span className="pf-sum">
            <Ic name="user" />
            <b>あなたの設定</b>
            {profileSummary(pf)}
          </span>
          <a className="lnk" href="#me">
            変更する
          </a>
        </p>
      ) : (
        <div className="pf-invite">
          <p>
            <b>自分の状況を入れておくと、合う制度が分かります。</b> 入力は任意で、この端末に保存されます。
          </p>
          <div className="pf-act">
            <a className="btn btn-solid" href="#me">
              自分の設定を入れる
            </a>
            <PresetButtons />
          </div>
        </div>
      )}

      <div className="ctrl">
        <Seg value={mode} options={modes} onChange={store.setFindMode} label="表示する制度" wrap />
        {mode === 'all' && (
          <div className="chips" role="group" aria-label="立場">
            {AUD_IDS.map(k => (
              <Chip key={k} pressed={st.aud === k} onClick={() => store.setAud(k)}>
                {AUD[k]}
              </Chip>
            ))}
          </div>
        )}
      </div>
      {mode !== 'jgrants' && (
        <p className="cap find-note">
          {mode === 'match'
            ? '判定は、設定をもとにしたサンプルの規則によるめやすです。金額や状態にもサンプルの値が含まれます。正式な条件は、担当省庁のページで確認してください。'
            : '金額や状態にはサンプルの値が含まれます。申請の前に、担当省庁のページで最新の条件を確認してください。'}
        </p>
      )}
      {body}
    </section>
  );
}
