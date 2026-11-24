# ゆくえ（仮称）の画面

国のお金の流れと政策の動きを見せる画面です。React 19 + TypeScript（strict）+ Vite で作っています。
見た目・文言・動きは `design/yukue-sample/index.html`（1ファイルの試作）を写したもので、データだけは埋め込まずに `yukue/data` の JSON から読み込みます。

UIの部品集、グラフのライブラリ、ルーターは使っていません（流れ図も試作と同じく手書きです）。

## 動かす

Node.js 22.12 以上が必要です。

```bash
cd yukue/web
npm install

npm run dev        # 開発サーバー（http://127.0.0.1:5173/）
npm run build      # 型検査をしてから dist/ に書き出す
npm run preview    # dist/ を手元で配信する（http://127.0.0.1:4173/）

npm test           # 単体テスト（Vitest）
npm run typecheck  # 型検査だけ
```

`dist/` は、どのパスに置いても動きます（`base: './'`。資産もデータも相対パスで参照します）。

## データはどこから来るか

画面は、開いたときに次の7つを取りに行きます（一覧は `src/data/files.json`）。

| 取りに行く先 | 元のファイル | 無いとき |
| --- | --- | --- |
| `data/budget/fy2026.json` | `yukue/data/budget/fy2026.json` | 読み込みの失敗として知らせる |
| `data/updates/latest.json` | `yukue/data/updates/latest.json` | 同上 |
| `data/programs/curated.json` | `yukue/data/programs/curated.json` | 同上 |
| `data/briefing.json` | `yukue/data/briefing.json` | 重要度の高い動きを3件出す |
| `data/calendar.json` | `yukue/data/calendar.json` | 動きに書かれた締切だけを出す |
| `data/programs/jgrants.json` | `yukue/data/programs/jgrants.json` | 「受付中の補助金は、いまのところありません」 |
| `data/runs/latest.json` | `yukue/data/runs/latest.json` | 「このサイトについて」にその旨を出す |

データの形は `yukue/shared/types.ts`（収集システムと共有）です。読み込むときに形を確かめ、こわれた項目は1件ずつ捨てます（`src/data/load.ts`）。

- **開発サーバー**は、`yukue/data` をそのまま `/data` として返します。収集をやり直したら、画面を読み込み直すだけで反映されます（`vite.config.ts`）
- **ビルド**の前には `npm run sync-data` が動き、上の7つを `public/data` に写します。`public/data` は写しなので git には入れません（`.gitignore`）
- 収集システムの内部の記録（`data/state`）と保管分（`data/updates/archive`）は、どちらの場合も配信しません

## 中身

```
src/
  main.tsx, App.tsx        入口。データを読み込み、いまの画面を出す（切り替えは URL の #）
  styles.css               スタイル。試作の <style> をそのまま写し、追加分は末尾にまとめた
  content.ts               画面に固定で出す文言と選択肢
  types.ts                 yukue/shared/types.ts の型を取り次ぐ
  data/
    files.json             読み込むファイルの一覧（sync-data と開発サーバーも同じものを使う）
    load.ts                読み込みと、形の確認
    model.ts               索引、金額の書式、分野の色
  lib/                     画面に依らない計算（どれも単体テストあり）
    flowModel.ts           流れ図の内容（財源 → 一般会計 → 使いみち／内訳 → 届け先）
    flowLayout.ts          流れ図の配置（四角・帯・ラベルの位置、横スクロールが要るか）
    format.ts, dates.ts    金額と日付の書き方（日付は日本時間）
    updates.ts, jgrants.ts 動きと補助金の並べ方・絞り込み、ホームに出す分
    profile.ts, match.ts   プロフィールと、制度に合うかどうかの規則
    apply.ts, storage.ts   申請の準備の記録、この端末への保存
  state/
    store.ts               画面の状態と操作（試作の st・pf・apps と、それを書きかえる関数）
    context.tsx            React から使うための入口
  chat/
    types.ts               ChatProvider（答え手の約束ごと）と ViewAction（画面を動かす操作）
    local.ts               かんたん応答：手元の規則で答える（試作の localAnswer）
    controller.ts          会話の進行。答えを少しずつ出し、画面も動かす
    actions.ts, screen.ts  操作の実行、「いま見ている画面」と質問の例
  components/              ヘッダー、AIに聞く、流れ図、小さな図、アイコン
  views/                   ホーム、お金の流れ、政策の動き、制度をさがす、マイページ、申請の準備、AIとつなぐ、このサイトについて
scripts/
  sync-data.mjs            yukue/data → public/data
  browser-check.cjs        ビルドしたものを実際のブラウザーで確かめる（下を参照）
```

### 「AIに聞く」をサーバーのAIに替えるとき

`chat/types.ts` の `ChatProvider` を実装し、`App.tsx` の `createLocalProvider()` と差し替えます。
答えには画面を動かす操作（`ViewAction`）を値で添えられるので、サーバーから返しても同じように画面が動きます。
少しずつ届く答えは `onText` で渡します。利用者が「AIの回答に、この設定を使う」を切っているとき（`state.pf.useInAi === false`）は、設定を端末の外へ送らないでください。

### この端末に保存するもの

`localStorage` に、試作と同じキーで保存します：`yukue.profile`（プロフィール）、`yukue.login`（ログインの再現）、`yukue.apps`（申請の準備の記録）、`yukue.dock`（AIに聞くを開いているか）。保存できない環境でも、画面はそのまま動きます。

## ブラウザーでの確認

Playwright が見える環境で（このパッケージの依存には入れていません）、ビルドしたものを配信してから実行します。

```bash
npm run build
npx vite preview --port 4173 --strictPort &
NODE_PATH=/opt/node-tools/node_modules node scripts/browser-check.cjs
```

1440px と 390px、ライトとダークで、コンソールのエラー、ページの横はみ出し、流れ図の内訳、合う制度、申請の準備、チャット、政策の動き、Jグランツ、読み込みの失敗などを確かめます。
`YUKUE_SHOTS=どこか` を付けると、スクリーンショットも残します。外へのリクエストは、この確認の中ではすべて止めます。

## 試作と変えてあるところ

- 設計メモの画面をやめ、「このサイトについて」（`#about`）にした。昔の `#notes` は `#about` を出す
- 政策の動き：集めた発表（種類「発表」、要点や段階のないもの）を出せるようにし、キーワード、「すべての発表を表示」、60件ずつの表示、締切、「AI要約」の印、「正式な名前」を足した
- 制度をさがす：「受付中の補助金（Jグランツ）」を足した
- AIに聞く：答えるのは手元の規則だけ（「かんたん応答（試作）」）。申請の下書きも、ひな形を使う
- ヘッダー：760〜1100px では、右側のリンクをアイコンだけにした（試作では、ナビと重なっていた）
- 書体は試作と同じく Google Fonts から読み込む。読み込めないときは、代わりの書体で表示する
