# Roadmap

このリポジトリの近い開発項目です。GitHub issue に切りやすい粒度でまとめています。

## Now

### 1. MHLW reviewed workflow

- 目的:
  - `MHLW` も `MEXT FY2025` と同じ reviewed candidate workflow に乗せる
- 完了条件:
  - official PDF から `MIN_MHLW -> REC_*` edge を追加
  - `source_provenance` に official PDF / page を付与
  - `budget_highlights` に主要項目を追加
  - `2D` と `予算ページ` に反映

### 2. MEXT FY2024 breakdown

- 目的:
  - `FY2024` の `MEXT` が `文教及び科学振興費 / その他経費` だけなのを改善する
- 完了条件:
  - `FY2024` の reviewed candidate JSON を追加
  - `MIN_MEXT -> REC_*` edge を増やす
  - hover で official PDF が開ける

### 3. Provenance coverage

- 目的:
  - 他省庁の `page_number` と `source_title` の精度を揃える
- 完了条件:
  - `MHLW` `MLIT` `METI` などの主要 edge に official PDF / page を追加
  - `公式PDF` / `推計配分` の区別が一貫する

## Next

### 4. README screenshot automation

- 目的:
  - README のスクリーンショットを手作業にしない
- 完了条件:
  - `?view=2d` `?view=budget` などの deep-link を使って headless capture できる
  - `docs/screenshots/` を再生成するスクリプトがある

### 5. Budget page expansion

- 目的:
  - `budget_highlights` を複数省庁で使い回せる状態にする
- 完了条件:
  - `MIN_CFA` と `MIN_MEXT` 以外にも budget page 対応主体を追加
  - UI の entity chooser が自然に増えても崩れない

### 6. Retrieval quality regression

- 目的:
  - ingest 後に RAG 品質が落ちたら止める
- 完了条件:
  - `daily_trusted_ingest_pipeline` の quality gate を継続運用
  - 代表質問の pass rate を追跡

## Backlog

### 7. Flow-to-document back references

- 目的:
  - UI から文書回答に飛べるようにする
- 完了条件:
  - 2D / 予算ページから `generate_document_answer` 相当の導線がある

### 8. Ministry budget skill reuse

- 目的:
  - reviewed candidate workflow を別省庁へ横展開しやすくする
- 完了条件:
  - [`SKILL.md`](/Volumes/space/お金の流れ/global-money-flow/.codex/skills/ministry-budget-flow/SKILL.md) と reference の内容で `MHLW` `MLIT` に再利用できる
