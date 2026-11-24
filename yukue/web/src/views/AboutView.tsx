/**
 * このサイトについて：どこまでが公表値でどこがサンプルか、どこから集めているか、ログインと申請の扱い。
 * 文言は、プロトタイプの設計メモ（「このサンプルについて」「ログイン・プロフィール・AIでの申請」）をもとにしている。
 */
import { SrcLinks } from '../components/Bits.tsx';
import { FETCH_KIND, LAW_LINKS, LAW_NOTE } from '../content.ts';
import { dateTimeLabel, todayJst } from '../lib/dates.ts';
import { filterJGrants } from '../lib/jgrants.ts';
import { isHttps } from '../lib/updates.ts';
import { useApp } from '../state/context.ts';
import type { SourceStatus } from '../types.ts';

const count = (n: number): string => n.toLocaleString('ja-JP');
/** Jグランツの情報源のID（収集システムの登録名）。受付中の補助金の数も添える */
const JGRANTS_SOURCE_ID = 'jgrants';

/** 1つの情報源の、いちばん新しい記録 */
function SourceRow({ s, listed, grants }: { s: SourceStatus; listed: number; grants: number | null }) {
  const lastOk = dateTimeLabel(s.lastOk);
  const checked = dateTimeLabel(s.checkedAt);
  const streak = s.failures != null && s.failures > 1 ? `${count(s.failures)}回つづけて失敗` : null;
  return (
    <tr>
      <td>
        {isHttps(s.url) ? (
          <a className="lnk" href={s.url} target="_blank" rel="noopener">
            {s.name}
          </a>
        ) : (
          s.name
        )}
      </td>
      <td>{FETCH_KIND[s.kind]}</td>
      <td>
        <span className={s.ok ? 'st open' : 'st fail'}>{s.ok ? '取得できた' : '失敗'}</span>
        {!s.ok && (streak || s.error) && (
          <>
            <br />
            <span className="src">{[streak, s.error].filter(Boolean).join(' ・ ')}</span>
          </>
        )}
        {!s.ok && lastOk && (
          <>
            <br />
            <span className="src">{`最後に取得できたのは ${lastOk}`}</span>
          </>
        )}
      </td>
      <td>
        {`${count(listed)}件`}
        {grants != null && (
          <>
            <br />
            <span className="src">{`ほかに、受付中の補助金 ${count(grants)}件`}</span>
          </>
        )}
      </td>
      <td>
        {!s.ok ? '―' : s.unchanged ? '変化なし' : `取得 ${count(s.fetched)}件 ・ 新着 ${count(s.added)}件`}
        {checked && (
          <>
            <br />
            <span className="src">{`${checked} に確認`}</span>
          </>
        )}
      </td>
    </tr>
  );
}

export function AboutView() {
  const { store, model } = useApp();
  const { fy, data } = model;
  const run = data.run;
  const finished = dateTimeLabel(run?.finishedAt);
  const failed = run ? run.sources.filter(s => !s.ok).length : 0;
  /** 「制度をさがす」に出している、受付中の補助金の数 */
  const openGrants = filterJGrants(data.jgrants.items, { query: '', area: '' }, todayJst(store.now())).length;
  /** いま画面に載せている動きの数（情報源ごと） */
  const listed = new Map<string, number>();
  for (const u of model.updates) listed.set(u.sourceId, (listed.get(u.sourceId) ?? 0) + 1);

  return (
    <section className="view" id="v-about" data-view="about">
      <header className="vh">
        <p className="eyebrow">ゆくえ（仮称） ・ 試作版</p>
        <h1 className="vt">このサイトについて</h1>
        <p className="lead">どこまでが公表された値で、どこがサンプルか。情報をどこから集めているか。ログインと申請をどう扱うか。</p>
      </header>

      <div className="notes">
        <section className="note-sec">
          <h2>公表値と、サンプルの値</h2>
          <p>{fy.sampleNote}</p>
          <dl className="kv">
            <div>
              <dt>公表値にもとづくもの</dt>
              <dd>
                {fy.label}一般会計の総額、財源、主要経費。{fy.capRoot}
              </dd>
            </div>
            <div>
              <dt>政策の動き</dt>
              <dd>
                各機関が公開しているページ、RSS、APIから集めたものです。題と要約は、人、AI、規則のいずれかが整えています。AIが要約したものには「AI要約」と表示します。くわしい内容は、各項目の「一次情報」で確認してください。
              </dd>
            </div>
            <div>
              <dt>受付中の補助金（Jグランツ）</dt>
              <dd>デジタル庁の補助金の申請システム「Jグランツ」の公開APIから集めた内容を、そのまま表示しています。</dd>
            </div>
            <div>
              <dt>サンプルの値</dt>
              <dd>
                社会保障・防衛・公共事業・教育の内訳の一部、届け先ごとの金額、過去10年の推移（概数）、一部の制度の金額と状態。画面の見え方を確かめるための値です。
              </dd>
            </div>
            <div>
              <dt>マイページと申請の準備</dt>
              <dd>
                合うかどうかの判定の規則、そろえるものの一覧、下書きの文例はサンプルです。ログインは画面の再現だけで、認証は行いません。入れた設定は、このブラウザにだけ保存されます。
              </dd>
            </div>
            <div>
              <dt>右側の「AIに聞く」</dt>
              <dd>
                いまは、あらかじめ用意した規則で答える「かんたん応答」です。答えの根拠は、この画面に出しているデータだけです。公開版では、出典つきでAIが答えます。
              </dd>
            </div>
            <div>
              <dt>名前</dt>
              <dd>「ゆくえ」は仮の名前です。</dd>
            </div>
          </dl>
        </section>

        <section className="note-sec">
          <h2>情報を集めている元</h2>
          <p>「政策の動き」と「受付中の補助金」は、下の情報源から自動で集めています。直近の収集の結果は、次のとおりです。</p>
          {!run ? (
            <p className="empty">収集の記録を読み込めませんでした。</p>
          ) : !run.sources.length ? (
            <p className="empty">収集の記録は、まだありません。</p>
          ) : (
            <>
              <p className="run-sum">
                {finished && (
                  <span>
                    直近の収集 <b>{finished}</b>
                  </span>
                )}
                <span>
                  新しく加わった動き <b>{`${count(run.totals.added)}件`}</b>
                </span>
                <span>
                  掲載中の動き <b>{`${count(model.updates.length)}件`}</b>
                </span>
                {failed > 0 && (
                  <span>
                    失敗している情報源 <b>{`${count(failed)}件`}</b>
                  </span>
                )}
              </p>
              <div className="tbl-wrap">
                <table className="tbl wrap">
                  <thead>
                    <tr>
                      <th>情報源</th>
                      <th>取り方</th>
                      <th>結果</th>
                      <th>掲載中</th>
                      <th>直近の確認</th>
                    </tr>
                  </thead>
                  <tbody>
                    {run.sources.map(s => (
                      <SourceRow
                        key={s.id}
                        s={s}
                        listed={listed.get(s.id) ?? 0}
                        grants={s.id === JGRANTS_SOURCE_ID ? openGrants : null}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="cap">
                表は、情報源ごとの、いちばん新しい記録です。前回から中身が変わっていないときは「変化なし」と表示します。
              </p>
            </>
          )}
          {data.missing.length > 0 && (
            <p className="cap">
              読み込めなかったデータ：{data.missing.map(m => `${m.path}（${m.reason}）`).join('、')}
            </p>
          )}
        </section>

        <section className="note-sec">
          <h2>ログイン・プロフィール・AIでの申請</h2>
          <p>
            制度さがしは、<strong>ログインしなくても使える</strong>
            ようにします。設定はまず端末に保存し、ログインした人には、端末をまたいだ同期、締切の通知、申請の記録を足します。入口でログインを求めると、いちばん届けたい人が離れてしまうためです。
          </p>
          <dl className="kv">
            <div>
              <dt>プロフィール</dt>
              <dd>
                項目はすべて任意。入れた分だけ判定が細かくなり、足りない項目は「たしかめること」として示す。病歴や障害のように、とくに慎重に扱う情報は、それが必要な制度をえらんだときにだけ、同意を得てから聞く。
              </dd>
            </div>
            <div>
              <dt>合うかどうかの判定</dt>
              <dd>
                制度ごとの条件を規則として持ち、「対象の可能性が高い／条件しだい／対象外の見込み」を理由つきで出す。判定はAIの推測ではなく規則で行い、AIは説明と質問への答えを受け持つ。
              </dd>
            </div>
            <div>
              <dt>AIでの申請は3段階</dt>
              <dd>
                ①対象の確認と、そろえるものの案内。②本人の言葉をもとにした、文章の下書き。③公式の窓口への橋渡し。①と②から作り、③は窓口ごとに、連携が認められている範囲で広げる。
              </dd>
            </div>
            <div>
              <dt>提出は本人が行う</dt>
              <dd>{LAW_NOTE}</dd>
            </div>
            <div>
              <dt>AIに渡す情報</dt>
              <dd>
                設定をAIの回答に使うかどうかは、本人が切り替えられる。病歴や障害などは「要配慮個人情報」で、同意なしには集められない。海外の事業者が動かすAIに個人データを送るときは、外国への提供としての同意と説明が要る場合があり、公式の整理はまだ定まっていない。公開の前に専門家と決める。
              </dd>
            </div>
          </dl>
          <p className="note-links">
            <span className="src" style={{ alignSelf: 'center' }}>
              参照した資料
            </span>
            <SrcLinks links={LAW_LINKS} />
          </p>
        </section>
      </div>
    </section>
  );
}
