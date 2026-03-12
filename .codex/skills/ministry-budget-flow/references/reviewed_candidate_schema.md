# Reviewed Candidate Schema

Use `scripts/reviewed_budget_candidates/*.json` as the review boundary between PDF reading and flow upsert.

## Minimum Shape

```json
{
  "source_dataset": "文部科学省 令和7年度予算のポイント",
  "source_title": "令和7年度予算のポイント",
  "source_url": "https://...pdf",
  "fiscal_year": 2025,
  "source_node": {
    "id": "MIN_MEXT",
    "name": "文部科学省 (MEXT)",
    "lat": 35.7036,
    "lng": 139.7495,
    "region": "Ministry",
    "type": "ministry"
  },
  "targets": [
    {
      "target_id": "REC_MEXT_KAKENHI",
      "target_name": "科学研究費助成事業（科研費）",
      "target_type": "recipient",
      "region": "Science",
      "lat": 35.7089,
      "lng": 139.7474,
      "amount_oku_yen": 2379,
      "category": "education",
      "sub_category": "科学研究費助成事業（科研費）",
      "description": "基礎から応用までの学術研究を支える競争的研究費。",
      "source_title": "令和7年度予算のポイント",
      "source_url": "https://...pdf#page=68",
      "page_number": 68
    }
  ],
  "budget_highlights": []
}
```

## Rules

- `amount_oku_yen` is the reviewed source of truth. The builder converts it to `value_usd`.
- `page_number` should match the PDF viewer page index used in the URL anchor.
- `source_url` should point to the official PDF, not a landing page.
- `source_title` should be the human-facing PDF title shown in the UI.
- `target_id` should stay stable across reseeds.

## Commands

Generic build:

```bash
python3 scripts/build_reviewed_budget_dataset.py \
  --input scripts/reviewed_budget_candidates/<file>.json \
  --output src/data/<dataset>.json
```

Then re-seed:

```bash
python3 scripts/seed_db.py
```
