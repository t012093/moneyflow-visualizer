# アプリ活用ガイド

このアプリは、単一の機能ではなく、次の 3 層を組み合わせて使う前提です。

- `RAG / 文書検索`
  - PDF や HTML を取り込み、本文・chunk・embedding を使って検索と回答を行う
- `フローDB / 可視化`
  - `source -> target -> amount` の構造化 edge を 2D / 3D UI で見る
- `予算ハイライト`
  - 主要事業、増要因、政策枠を予算ページで見る

## 1. まず何を見るか

### 3D グローブ

向いている用途:

- 全体の資金移動を俯瞰したい
- 大分類の動きをざっくり見たい

向いていない用途:

- 個別事業の根拠 PDF を確認したい
- 省庁ごとの詳細内訳を見たい

### 2D 解析フロー

向いている用途:

- 特定エンティティの入出金を見たい
- フローごとの出典資料を見たい
- `公式PDF` と `推計配分` を見分けたい

使い方:

1. `特定エンティティ` を選ぶ
2. 年度を合わせる
3. Sankey の線をクリックする
4. 右下の詳細パネルで `出典資料` と `元の資料・PDFを開く` を確認する

注意:

- `マクロカテゴリ別` は複数 edge の集約表示なので、単一 PDF の根拠には向きません
- `特定エンティティ` で見ると、元 edge の provenance がそのまま出ます

### 予算ページ

向いている用途:

- 主要施策を一覧で見たい
- 総額、増要因、政策枠、個別施策を読みたい
- 2D フローより先に概要を掴みたい

## 2. このアプリでできること

### 文書を根拠に答える

- `search_documents`
- `answer_documents`
- `generate_document_answer`

が使えます。これは PDF 本文を検索して、引用付きで回答する用途です。

使いどころ:

- `こども家庭庁は何をやっているか`
- `児童手当の増額根拠はどの PDF の何ページか`
- `高等教育費の負担軽減の金額は何か`

### フローを可視化する

2D / 3D UI は、`edges` テーブルに入っている構造化データを表示します。

重要:

- PDF を取り込んだだけでは、2D フローは自動で細かくなりません
- UI に細かい事業を出したい場合は、`事業名 / 金額 / 出典URL / ページ番号` を edge として DB に追加する必要があります

### 信頼ソースだけ自動収集する

次の流れで新規資料を追加できます。

1. `discover_source_candidates_from_page`
2. `review_source_candidates_report`
3. `bulk_review_source_candidates`
4. `bulk_ingest_trusted_candidates`
5. `ingest_and_eval_trusted_candidates`

日次運用は `daily_trusted_ingest_pipeline` を使います。

## 3. RAG とフローの違い

このアプリで混乱しやすい点です。

### RAG 層

保持しているもの:

- PDF 本文
- chunk
- embedding
- 検索と回答用の context

主なテーブル:

- `crawl_documents`
- `document_chunks`
- `chunk_embeddings`

### フロー層

保持しているもの:

- `source -> target -> amount`
- provenance
- UI に出す構造化 edge

主なテーブル:

- `edges`
- `source_provenance`

つまり:

- PDF を RAG に入れることと
- UI のフローを細かくすることは

同じではありません。

## 4. PDF 情報が出ているのにフローが粗い理由

例:

- `文部科学省 (MEXT)` で 2D に `文教及び科学振興費` と `その他経費` しか出ない年度がある

これは不具合ではなく、年度ごとに DB の edge 粒度が違うためです。

現在の状態:

- provenance は年別の official PDF に正規化済み
- `FY2024-FY2025` の `MEXT` と `MHLW` は reviewed workflow で主要事業 edge を追加済み
- `FY2024` の `MLIT` と `FY2025` の `METI` も reviewed workflow で主要事業 edge を追加済み
- それ以外の年度・省庁はまだ大分類中心

改善したい場合:

1. official PDF から主要事業を抽出する
2. reviewed candidate JSON に落とす
3. `MIN_xxx -> 主要事業` の edge を追加する
4. 必要なら `主要事業 -> 受益者/制度` まで分解する

## 5. UI の見方

### `公式PDF`

意味:

- edge が直接 PDF を参照している
- クリックすると一次資料の PDF が開く

### `推計配分`

意味:

- 予算の配分比率や概算モデルで作った edge
- 出典 PDF はあるが、PDF から 1 本ずつ直接抽出した事業ではない

読むときの原則:

- 金額の厳密確認は `公式PDF` を優先する
- 全体構造の把握は `推計配分` も使う

## 6. おすすめの使い方

### ケース 1: まず政策の全体像を知りたい

1. `予算ページ` を開く
2. 総額、増要因、政策枠を確認する
3. 気になる項目だけ 2D で掘る

### ケース 2: ある金額の根拠を確認したい

1. `2D 解析フロー` を開く
2. `特定エンティティ` を選ぶ
3. 線をクリックして詳細パネルを見る
4. `この年度の予算ページへ` で同年度の主要事業カードへ飛ぶ
5. 必要なら `元の資料・PDFを開く` で一次資料を確認する

### ケース 3: PDF に載っている事業を UI に増やしたい

1. RAG で PDF から事業名と金額を確認する
2. `scripts/generate_reviewed_budget_candidate.py` で reviewed candidate の draft JSON を作る
3. draft を review して `scripts/reviewed_budget_candidates/` に確定 JSON として保存する
4. `scripts/build_reviewed_budget_dataset.py` か省庁別 wrapper で dataset JSON を生成する
5. `python3 scripts/seed_db.py` で `edges` と `source_provenance` に反映する
6. `npm run build` 後に UI で表示確認する

### ケース 4: 新しい公式資料を継続的に取り込みたい

1. 一覧ページ discovery を使う
2. candidate を review する
3. trusted ingest に流す
4. eval で品質確認する

## 7. 運用上のおすすめ

- まず `予算ページ` で全体像を見る
- 個別の確認は `2D 解析フロー` の `特定エンティティ` を使う
- 根拠確認は `公式PDF` バッジを優先する
- reviewed workflow 未対応の年度・主体は、今後 `主要事業 edge` を増やす前提で見る
- 文書検索の回答と UI のフロー表示は別レイヤーだと意識する

## 8. このアプリをさらに活かす次の打ち手

優先度が高い順です。

1. 未対応年度の `MEXT` / `MHLW` や他省庁にも reviewed workflow を広げる
2. `page_number` を他省庁にも増やす
3. PDF から edge への半自動変換フローを固定化する
4. その運用手順を skill で再利用する

skill 化する場合は、データそのものではなく、次を skill にするのが適切です。

- PDF から主要事業を抽出する手順
- edge へ正規化する手順
- reviewed candidate を dataset / DB / UI へ反映する手順
- provenance を付ける手順
- UI 反映までの確認手順

project-local skill は [`SKILL.md`](/Volumes/space/お金の流れ/global-money-flow/.codex/skills/ministry-budget-flow/SKILL.md) を参照してください。
