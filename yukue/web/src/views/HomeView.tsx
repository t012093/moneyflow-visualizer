/** ホーム：きょうの国の動き、今年度の予算のあらまし、フォロー中のテーマ、これからの予定。 */
import { useMemo } from 'react';
import { Chip, Dot } from '../components/Bits.tsx';
import { Sparkline } from '../components/Charts.tsx';
import { FlowDiagram } from '../components/FlowDiagram.tsx';
import { Ic } from '../components/Icons.tsx';
import { FOLLOW, typeInfo } from '../content.ts';
import { shortDate, stampJst, todayJst } from '../lib/dates.ts';
import { fmtCho, n1, yoyOf } from '../lib/format.ts';
import { pickByTheme, resolveBriefing, safeLinks, stageName, upcoming } from '../lib/updates.ts';
import { useApp } from '../state/context.ts';
import type { UpdateItem } from '../types.ts';

/** 「予算 ・ 国会審議 ・ 財務省」のような一行（無いものは飛ばす） */
const metaLine = (parts: (string | null | undefined)[]): string => parts.filter(Boolean).join(' ・ ');

export function HomeView() {
  const { store, chat, model } = useApp();
  const { fy, fmt, data } = model;
  const today = todayJst(store.now());

  const stamp = stampJst(data.updates.generatedAt);
  const tops = useMemo(() => resolveBriefing(data.briefing, model.updates), [data.briefing, model.updates]);
  const sources = tops.reduce((n, t) => n + safeLinks(t.update.links).length, 0);
  const followed = useMemo(() => FOLLOW.flatMap(t => pickByTheme(model.updates, t, 1, today)), [model.updates, today]);
  const agenda = useMemo(() => upcoming(data.calendar, model.updates, today), [data.calendar, model.updates, today]);
  const yoy = yoyOf(fy.trend);
  const rowMeta = (u: UpdateItem): string => metaLine([model.themeName(u.theme), typeInfo(u.type).n, stageName(u)]);

  return (
    <section className="view" id="v-home" data-view="home">
      <div className="home-top">
        <article className="brief">
          <p className="eyebrow">{stamp ? `${stamp.date} ${stamp.dow} ・ ${stamp.time} 更新` : ''}</p>
          <h1 className="vt">きょうの国の動き</h1>
          <div className="brief-list">
            {tops.map(({ update: u, text }) => (
              <button className="brief-item" type="button" key={u.id} onClick={() => store.openUpdate(u.id)}>
                <Dot color={model.themeVar(u.theme)} />
                <span className="brief-t">{text}</span>
                <span className="brief-m">{metaLine([typeInfo(u.type).n, stageName(u), u.ministry])}</span>
              </button>
            ))}
            {!tops.length && <p className="empty">きょうの動きは、まだありません。</p>}
          </div>
          <p className="brief-foot">
            {data.briefing?.method === 'ai' && tops.length > 0 && <span className="tag">AI要約</span>}
            {tops.length > 0 && <span>{`一次情報 ${sources}件にもとづく`}</span>}
            <button className="lnk" type="button" onClick={() => void chat.ask('きょうの動きをまとめて教えて')}>
              このまとめについて聞く
            </button>
          </p>
        </article>
        <article className="panel teaser">
          <header className="teaser-h">
            <div>
              <p className="eyebrow">{`${fy.label} ${fy.kind}`}</p>
              <p className="hero">
                <span>{n1(fy.total)}</span>
                <span className="hero-u">兆円</span>
              </p>
              <p className="hero-sub">{`国民1人あたり ${fmt.pc(fy.total)}${yoy ? ` ・ 前年度から ${yoy}` : ''}`}</p>
            </div>
            <a className="btn btn-ghost" href="#flow">
              流れをたどる
              <Ic name="arrow" />
            </a>
          </header>
          <FlowDiagram
            model={model.root}
            fmt={fmtCho}
            pct={fmt.pct}
            themeVar={model.themeVar}
            compact
            label={`${fy.label}一般会計の財源と使いみち`}
            onSelect={nd => store.selectFlow(nd.id)}
          />
        </article>
      </div>

      <section className="tiles" aria-label="数字で見る今年度">
        {model.budget.tiles.map(t => (
          <div className="tile" key={t.label}>
            <p className="tile-l">{t.label}</p>
            <p className="tile-v">
              {t.value}
              <small>{t.unit}</small>
            </p>
            <p className="tile-d">{t.delta}</p>
            <Sparkline values={t.series} />
          </div>
        ))}
      </section>

      <div className="home-low">
        <section>
          <h2 className="sec-h">
            フォロー中のテーマ<small>動きがあると通知します</small>
          </h2>
          <div className="chips follow-chips">
            {FOLLOW.map(k => (
              <Chip key={k} onClick={() => store.showUpdates('all', k)}>
                <Dot color={model.themeVar(k)} />
                {model.themeName(k)}
              </Chip>
            ))}
            <Chip onClick={() => store.go('updates')}>＋ テーマを追加</Chip>
          </div>
          <div className="rows">
            {followed.map(u => (
              <button className="row" type="button" key={u.id} onClick={() => store.openUpdate(u.id)}>
                <span className="row-d">{shortDate(u.date)}</span>
                <span className="row-t">{u.title}</span>
                <span className="row-s">{rowMeta(u)}</span>
              </button>
            ))}
          </div>
        </section>
        <section>
          <h2 className="sec-h">
            これからの予定<small>公表されている日程と、例年の目安</small>
          </h2>
          <div className="rows">
            {agenda.map((c, i) => {
              const body = (
                <>
                  <span className="row-d">{c.when}</span>
                  <span className="row-t">{c.title}</span>
                  <span className="row-s">{c.note}</span>
                </>
              );
              const id = c.updateId;
              return id ? (
                <button className="row" type="button" key={i} onClick={() => store.openUpdate(id)}>
                  {body}
                </button>
              ) : (
                <div className="row" key={i}>
                  {body}
                </div>
              );
            })}
            {!agenda.length && <p className="empty">公表されている予定は、いまのところありません。</p>}
          </div>
        </section>
      </div>
    </section>
  );
}
