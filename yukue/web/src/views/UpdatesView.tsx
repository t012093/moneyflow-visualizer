/** 政策の動き：法律・予算・税・制度・補助金・そのほかの発表を、種類と段階をそろえて並べる。 */
import { useMemo } from 'react';
import { Chip, Dot, SrcLinks, Steps } from '../components/Bits.tsx';
import { Ic } from '../components/Icons.tsx';
import { TYPES, TYPE_IDS, isThemeId, typeInfo } from '../content.ts';
import { dateLabel, deadlineLabel, todayJst } from '../lib/dates.ts';
import { filterUpdates, groupByDay, safeLinks, stageName } from '../lib/updates.ts';
import { useApp, useUi } from '../state/context.ts';
import type { ThemeId, UpdateItem } from '../types.ts';

export function UpdatesView() {
  const { store, model } = useApp();
  const st = useUi();
  const today = todayJst(store.now());

  const list = useMemo(
    () => filterUpdates(model.updates, { type: st.upType, theme: st.upTheme, query: st.upQuery, showAll: st.upAll }),
    [model.updates, st.upType, st.upTheme, st.upQuery, st.upAll]
  );
  const shown = list.slice(0, st.upLimit);
  const days = groupByDay(shown);

  /** 絞り込みに出す分野：いまの一覧（人事などを含めるかどうかで変わる）に出てくるものだけ */
  const themes = useMemo(() => {
    const present = new Set<string>((st.upAll ? model.updates : model.visibleUpdates).map(u => u.theme));
    if (st.upTheme !== 'all') present.add(st.upTheme);
    return Object.keys(model.budget.themes).filter((k): k is ThemeId => isThemeId(k) && present.has(k));
  }, [model, st.upAll, st.upTheme]);

  return (
    <section className="view" id="v-updates" data-view="updates">
      <header className="vh">
        <p className="eyebrow">毎日更新 ・ 各府省・国会・Jグランツから</p>
        <h1 className="vt">政策の動き</h1>
        <p className="lead">
          法律、予算、税、制度、補助金。発表元がちがっても、「種類」と「いまの段階」をそろえて1か所に並べます。
        </p>
      </header>

      <div className="ctrl">
        <div className="chips" role="group" aria-label="種類">
          <Chip pressed={st.upType === 'all'} onClick={() => store.setUpType('all')}>
            すべて
          </Chip>
          {TYPE_IDS.map(k => (
            <Chip key={k} pressed={st.upType === k} onClick={() => store.setUpType(k)}>
              <Ic name={TYPES[k].i} />
              {TYPES[k].n}
            </Chip>
          ))}
        </div>
      </div>
      <div className="ctrl">
        <div className="chips" role="group" aria-label="分野">
          <Chip pressed={st.upTheme === 'all'} onClick={() => store.setUpTheme('all')}>
            全分野
          </Chip>
          {themes.map(k => (
            <Chip key={k} pressed={st.upTheme === k} onClick={() => store.setUpTheme(k)}>
              <Dot color={model.themeVar(k)} />
              {model.themeName(k)}
            </Chip>
          ))}
        </div>
      </div>
      <div className="ctrl">
        <div className="kw">
          <label className="sr" htmlFor="upQ">
            キーワードでさがす
          </label>
          <input
            className="inp"
            id="upQ"
            type="search"
            placeholder="キーワードでさがす（題・要約・発表元）"
            autoComplete="off"
            value={st.upQuery}
            onChange={e => store.setUpQuery(e.target.value)}
          />
        </div>
        <label className="sw" htmlFor="upAll">
          <input type="checkbox" id="upAll" checked={st.upAll} onChange={e => store.setUpAll(e.target.checked)} />
          <span>
            すべての発表を表示<small>人事・入札・会見なども並べます</small>
          </span>
        </label>
      </div>

      <div className="feed">
        {days.length ? (
          days.map(g => (
            <section key={g.date}>
              <h2 className="day-h">
                {g.date === today ? 'きょう ・ ' : ''}
                {dateLabel(g.date)}
              </h2>
              {g.items.map(u => (
                <UpdateCard key={u.id} u={u} open={st.openUp === u.id} today={today} />
              ))}
            </section>
          ))
        ) : (
          <p className="empty">この条件に合う動きは、いまのところありません。</p>
        )}
        {list.length > shown.length && (
          <div className="feed-more">
            <button className="btn btn-ghost" type="button" onClick={store.moreUpdates}>
              もっと見る
            </button>
            <span className="cap">
              {list.length.toLocaleString('ja-JP')}件のうち、{shown.length.toLocaleString('ja-JP')}件を表示しています
            </span>
          </div>
        )}
      </div>
    </section>
  );
}

function UpdateCard({ u, open, today }: { u: UpdateItem; open: boolean; today: string }) {
  const { store, chat, model } = useApp();
  const type = typeInfo(u.type);
  const stage = u.stage;
  const stageLabel = stageName(u);
  const deadline = deadlineLabel(u.deadline, today);
  const bodyId = `upb-${u.id}`;
  const links = safeLinks(u.links);
  const formal = u.originalTitle && u.originalTitle !== u.title ? u.originalTitle : null;
  return (
    <article className="up" id={`up-${u.id}`}>
      <button className="up-h" type="button" aria-expanded={open} aria-controls={open ? bodyId : undefined} onClick={() => store.toggleUp(u.id)}>
        <span className="up-type">
          <Ic name={type.i} />
          {type.n}
        </span>
        <span className="up-title">{u.title}</span>
        {stage && stageLabel && (
          <span className="up-stage" title={stage.steps.join(' → ')}>
            {stageLabel}
            <Steps stage={stage} />
          </span>
        )}
        {u.summary && <span className="up-sum">{u.summary}</span>}
        <span className="up-meta">
          <span>
            <Dot color={model.themeVar(u.theme)} />
            {model.themeName(u.theme)}
          </span>
          {u.ministry && <span>{u.ministry}</span>}
          {u.amount && <span>{u.amount}</span>}
          {deadline && <span>{deadline}</span>}
          {u.enriched === 'ai' && <span className="tag">AI要約</span>}
        </span>
      </button>
      {open && (
        <div className="up-body" id={bodyId}>
          {/* 「何が変わる／だれに関係／いつから」は、人かAIが書いたときだけ。無ければ、一次情報と段階だけを出す */}
          {u.qa && (
            <>
              <dl className="qa">
                <div>
                  <dt>何が変わる</dt>
                  <dd>{u.qa.what}</dd>
                </div>
                <div>
                  <dt>だれに関係</dt>
                  <dd>{u.qa.who}</dd>
                </div>
                <div>
                  <dt>いつから</dt>
                  <dd>{u.qa.when}</dd>
                </div>
              </dl>
              <div className="up-acts">
                {model.useById.has(u.theme) && (
                  <button className="btn btn-ghost" type="button" onClick={() => store.selectFlow(u.theme)}>
                    <Ic name="flow" />
                    お金の流れで見る
                  </button>
                )}
                <button className="btn btn-ghost" type="button" onClick={() => void chat.ask(`「${u.title}」をわかりやすく説明して`)}>
                  <Ic name="spark" />
                  AIに聞く
                </button>
              </div>
            </>
          )}
          {formal && <p className="src">{`正式な名前：${formal}`}</p>}
          {links.length > 0 && (
            <p className="srcs">
              一次情報
              <SrcLinks links={links} />
            </p>
          )}
          {stage && (
            <p className="src">{`段階：${stage.steps.map((s, i) => (i === stage.index ? `【${s}】` : s)).join(' → ')}`}</p>
          )}
          {!u.qa && !formal && !links.length && !stage && <p className="src">この発表には、一次情報のリンクがありません。</p>}
        </div>
      )}
    </article>
  );
}
