# Funding Knowledge

このディレクトリには、アプリ内の `knowledge_notes` / `structured_facts` と紐づく調査メモを置く。

現在の主な対象:

- こども家庭庁: こども誰でも通園制度の公式フロー、自治体実施状況、比較表、放課後児童クラブ4事業
- 地方自治体: 神戸市こども誰でも通園制度の予算と35施設一覧
- 厚生労働省: 令和7年度 reviewed budget summary
- 文部科学省: 令和7年度 reviewed budget summary
- 国土交通省: 令和6年度 reviewed budget summary
- 経済産業省: 2025年度 reviewed budget summary

原則:

- 一次資料 URL は `scripts/seed_db.py` の `KNOWLEDGE_NOTES` / `STRUCTURED_FACTS` に保持する
- この markdown は UI の `調査ノート` タブで全文表示するための本文ソースとして使う
- 金額・政策枠・個別施策は reviewed 済みの budget dataset JSON と整合させる
