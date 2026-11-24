/** お金の流れ：財源 → 一般会計 → 使いみち。使いみちを押すと、内訳 → 届け先まで進める。 */
import { Fragment, useCallback, useState } from 'react';
import { Dot, Seg } from '../components/Bits.tsx';
import { TrendChart } from '../components/Charts.tsx';
import { FlowDiagram } from '../components/FlowDiagram.tsx';
import { Ic } from '../components/Icons.tsx';
import { typeInfo } from '../content.ts';
import { shortDate } from '../lib/dates.ts';
import { findNode, type FlowModel, type FlowNode } from '../lib/flowModel.ts';
import { fmtCho, yoyOf, type Unit } from '../lib/format.ts';
import { stageName } from '../lib/updates.ts';
import { useApp, useUi } from '../state/context.tsx';
import { currentFlow, type FlowMode } from '../state/store.ts';
import type { ThemeId } from '../types.ts';

const UNITS: readonly (readonly [Unit, string])[] = [
  ['cho', '兆円'],
  ['pc', '1人あたり'],
  ['man', '1万円のうち']
];
const MODES: readonly (readonly [FlowMode, string])[] = [
  ['flow', '流れ'],
  ['table', '表']
];

export function FlowView() {
  const { store, model } = useApp();
  const st = useUi();
  const { fy, fmt } = model;
  const flow = currentFlow(model, st);
  const { model: fm, isRoot, node } = flow;
  const openUse = isRoot ? null : (model.useById.get(fm.key) ?? null);
  const isTable = st.mode === 'table';
  const unitFmt = fmt.by(st.unit);
  const [wide, setWide] = useState(false);
  const onScrolled = useCallback((scrolled: boolean) => setWide(scrolled), []);

  const unitNote =
    st.unit === 'pc'
      ? ` 1人あたり＝${fy.popNote}で割った値。`
      : st.unit === 'man'
        ? ' 1万円のうち＝一般会計の総額を1万円としたときの金額。'
        : '';

  return (
    <section className="view" id="v-flow" data-view="flow">
      <header className="vh">
        <p className="eyebrow">{`${fy.label}（${fy.west}）${fy.kind}`}</p>
        <h1 className="vt">お金の流れ</h1>
        <p className="lead">
          左が「どこから来たか」、右が「どこへ行くか」。気になる行き先を押すと、説明と関連する動きが出ます。さらに内訳までたどれます。
        </p>
      </header>

      <div className="life-wrap">
        <p className="life-t">
          <b>{`${fy.label}予算のいま`}</b>
          {` ${fy.lifeNote}`}
        </p>
        <ol className="life">
          {model.budget.life.map(s => (
            <li key={s.k} className={s.s || undefined}>
              {s.k}
              <time>{s.d}</time>
            </li>
          ))}
        </ol>
      </div>

      <div className="ctrl">
        <div className="ctrl-g">
          <span className="ctrl-l" id="unitL">
            単位
          </span>
          <Seg value={st.unit} options={UNITS} onChange={store.setUnit} labelledBy="unitL" />
        </div>
        <div className="ctrl-g">
          <span className="ctrl-l" id="modeL">
            表示
          </span>
          <Seg value={st.mode} options={MODES} onChange={store.setMode} labelledBy="modeL" />
        </div>
      </div>

      <div className="flow-grid">
        <figure className="panel flow-card">
          <nav className="crumb" aria-label="階層">
            {isRoot || !openUse ? (
              <span className="cur">全体</span>
            ) : (
              <>
                <button type="button" onClick={store.toRoot}>
                  全体
                </button>
                <Ic name="chev" />
                <span className="cur">{openUse.name}</span>
              </>
            )}
            {wide && !isTable && <span className="crumb-hint">横にスクロールできます</span>}
          </nav>

          {isTable ? (
            <div className="tbl-wrap">
              <FlowTable flow={fm} />
            </div>
          ) : (
            <div className="flow-scroll">
              <FlowDiagram
                model={fm}
                fmt={unitFmt}
                pct={fmt.pct}
                themeVar={model.themeVar}
                sel={node?.id ?? null}
                label={isRoot || !openUse ? `${fy.label}一般会計の財源と使いみち` : `${openUse.name}の内訳と届け先`}
                onSelect={store.pickNode}
                onScrolledChange={onScrolled}
              />
            </div>
          )}

          <div className="sel-bar">
            {node && (
              <>
                <Dot color={model.nodeColor(node)} />
                <b>{node.name}</b>
                <span>{unitFmt(node.v)}</span>
                <span className="sel-sub">{`全体の${fmt.pct(node.v)}`}</span>
                {isRoot && node.drill && (
                  <button className="btn btn-solid" type="button" onClick={() => store.drill(node.id)}>
                    内訳を見る
                    <Ic name="chev" />
                  </button>
                )}
              </>
            )}
          </div>

          <div className="legend" role="group" aria-label="分野の色">
            {isRoot || !openUse ? (
              model.budget.use.map(u => (
                <button className="lg" type="button" key={u.id} aria-pressed={node?.id === u.id} onClick={() => store.selectNode(u.id)}>
                  <i style={{ background: model.themeVar(u.theme) }} />
                  {u.name}
                </button>
              ))
            ) : (
              <>
                <span className="lg">
                  <i style={{ background: model.themeVar(openUse.theme) }} />
                  {`${openUse.name}のお金`}
                </span>
                <span className="lg">
                  <i style={{ background: 'var(--flow-neutral)' }} />
                  届け先
                </span>
              </>
            )}
          </div>
          <figcaption className="cap">{(isRoot ? fy.capRoot : fy.capDrill) + unitNote}</figcaption>
        </figure>

        <aside className="panel detail" aria-live="polite">
          {node ? <Detail flow={fm} node={node} /> : <p className="d-empty">項目をえらぶと、説明がここに出ます。</p>}
        </aside>
      </div>
    </section>
  );
}

/** 図と同じ内容の表 */
function FlowTable({ flow }: { flow: FlowModel }) {
  const { model } = useApp();
  const { fmt } = model;
  return (
    <table className="tbl">
      <thead>
        <tr>
          <th>項目</th>
          <th>金額</th>
          <th>全体に占める割合</th>
          <th>1人あたり</th>
          <th>1万円のうち</th>
        </tr>
      </thead>
      <tbody>
        {flow.cols.map(c => (
          <Fragment key={c.title}>
            <tr className="grp">
              <td colSpan={5}>{c.title}</td>
            </tr>
            {c.nodes.map(nd => (
              <tr key={nd.id}>
                <td>
                  <Dot color={model.nodeColor(nd)} />
                  {nd.name}
                </td>
                <td>{fmtCho(nd.v)}</td>
                <td>{fmt.pct(nd.v)}</td>
                <td>{fmt.pc(nd.v)}</td>
                <td>{fmt.man(nd.v)}</td>
              </tr>
            ))}
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}

/** えらんだ項目の説明、金額、推移、関連する動きと制度 */
function Detail({ flow, node: nd }: { flow: FlowModel; node: FlowNode }) {
  const { store, chat, model } = useApp();
  const { fy, fmt } = model;
  const isRoot = flow.key === 'root';
  const parent = isRoot ? null : (model.useById.get(flow.key) ?? null);
  const u = nd.kind === 'use' ? (model.useById.get(nd.id) ?? null) : null;
  const s = nd.kind === 'src' ? (model.srcById.get(nd.id) ?? null) : null;
  const isPool = nd.kind === 'pool';
  const item = nd.kind === 'item' ? (parent?.drill?.items.find(i => i.id === nd.id) ?? null) : null;

  const theme: ThemeId | null = nd.theme ?? (s || isPool ? 'whole' : null);
  const desc = u
    ? u.desc
    : s
      ? s.desc
      : isPool
        ? fy.poolDesc
        : item
          ? item.desc
          : nd.kind === 'recip' && parent
            ? `${parent.name}のうち、おもに${nd.name}に届く金額です。`
            : '';
  const trend = (u ? u.trend : s ? s.trend : isPool ? fy.trend : null) ?? null;
  const color = model.nodeColor(nd);
  const title = u ? u.long || u.name : nd.name;
  const related = theme ? model.visibleUpdates.filter(x => x.theme === theme).slice(0, 2) : [];
  const programs = u ? model.programs.filter(p => p.theme === u.theme).slice(0, 2) : [];
  const yoy = yoyOf(trend);
  const from = nd.kind === 'recip' ? flow.links.filter(l => l.t === nd.id).sort((a, b) => b.v - a.v) : [];
  const question = u
    ? `${u.name}は何に使われているの？`
    : s
      ? `${s.name}は全体のどれくらい？`
      : `${(item ?? nd).name}について教えて`;

  return (
    <>
      <h2 className="d-h1">
        <Dot color={color} />
        {title}
      </h2>
      {desc && <p className="d-desc">{desc}</p>}
      <dl className="d-figs">
        <div>
          <dt>金額</dt>
          <dd>{fmtCho(nd.v)}</dd>
        </div>
        <div>
          <dt>1人あたり</dt>
          <dd>{fmt.pc(nd.v)}</dd>
        </div>
        <div>
          <dt>1万円のうち</dt>
          <dd>{fmt.man(nd.v)}</dd>
        </div>
      </dl>

      {trend && trend.length > 1 && (
        <div>
          <p className="d-sub">
            {`${trend.length}年の推移`}
            <small>{`当初予算${yoy ? ` ・ 前年度から ${yoy}` : ''}`}</small>
          </p>
          <TrendChart key={nd.id} values={trend} years={fy.years} color={color} unit="兆円" />
        </div>
      )}

      {from.length > 0 && (
        <div>
          <p className="d-sub">どの内訳から届くか</p>
          {from.map(l => (
            <div className="d-link" key={l.s}>
              <span className="d-link-t">{findNode(flow, l.s)?.name ?? l.s}</span>
              <span className="d-link-m">{fmtCho(l.v)}</span>
            </div>
          ))}
        </div>
      )}

      {related.length > 0 && (
        <div>
          <p className="d-sub">関連する動き</p>
          {related.map(x => (
            <button className="d-link" type="button" key={x.id} onClick={() => store.openUpdate(x.id)}>
              <span className="d-link-t">{x.title}</span>
              <span className="d-link-m">{[shortDate(x.date), typeInfo(x.type).n, stageName(x)].filter(Boolean).join(' ・ ')}</span>
              <Ic name="chev" />
            </button>
          ))}
        </div>
      )}

      {programs.length > 0 && (
        <div>
          <p className="d-sub">関連する制度</p>
          {programs.map(p => (
            <button className="d-link" type="button" key={p.id} onClick={() => store.showProgram(p.id)}>
              <span className="d-link-t">{p.name}</span>
              <span className="d-link-m">{`${p.kind} ・ ${p.amt}`}</span>
              <Ic name="chev" />
            </button>
          ))}
        </div>
      )}

      <div className="d-act">
        {u && isRoot && nd.drill && (
          <button className="btn btn-solid" type="button" onClick={() => store.drill(u.id)}>
            内訳を見る
            <Ic name="chev" />
          </button>
        )}
        <button className="btn btn-ghost" type="button" onClick={() => void chat.ask(question)}>
          <Ic name="spark" />
          AIに聞く
        </button>
      </div>
      <p className="src">{nd.kind === 'item' || nd.kind === 'recip' ? fy.srcDrill : fy.srcShort}</p>
    </>
  );
}
