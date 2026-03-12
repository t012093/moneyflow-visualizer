---
name: ministry-budget-flow
description: Use this skill when you need to turn an official Japanese ministry budget PDF into reviewed flow edges, provenance, and budget highlights for this app, or when you need to extend the reviewed-candidate workflow to another ministry.
---

# Ministry Budget Flow

Use this skill when the task is any of the following:

- extract major projects from an official ministry budget PDF
- convert reviewed findings into `MIN_xxx -> REC_xxx` flow edges
- add `budget_highlights` for the budget page
- wire a new ministry dataset into `scripts/seed_db.py` and the UI

Do not use this skill for generic RAG ingestion only. This workflow is specifically for turning reviewed budget findings into structured flow data.

## Workflow

1. Identify the official PDF and verify the exact viewer page numbers you want to cite.
2. Create or update a reviewed candidate JSON under `scripts/reviewed_budget_candidates/`.
3. Convert that reviewed candidate into a dataset JSON with `scripts/build_reviewed_budget_dataset.py`, or add a thin ministry wrapper like `scripts/fetch_mext_budget.py` when the file should be regenerated often.
4. Wire the new dataset into `scripts/seed_db.py`.
5. If the ministry is new, make sure `scripts/init_db.py` and `scripts/seed_db.py` both know the `data_sources.source_id`.
6. Re-seed with `python3 scripts/seed_db.py`.
7. Verify:
   - the new `edges` exist in `data/money_flow.db`
   - `source_provenance` has the official PDF URL, title, and page
   - `src/data/unified_data.json` contains the new edges and `metadata.budgetHighlights`
   - `npm run build` passes

## Required Outputs

Each reviewed ministry dataset should produce all of the following:

- `nodes`: one ministry source node and target recipient nodes
- `edges`: `source_id`, `target_id`, amount, provenance, and page number
- `budget_highlights`: overview, policy frames, and individual projects when available

## File Map

- Reviewed candidate schema: `references/reviewed_candidate_schema.md`
- Generic builder: [`scripts/build_reviewed_budget_dataset.py`](/Volumes/space/お金の流れ/global-money-flow/scripts/build_reviewed_budget_dataset.py)
- MEXT example wrapper: [`scripts/fetch_mext_budget.py`](/Volumes/space/お金の流れ/global-money-flow/scripts/fetch_mext_budget.py)
- Seed/export pipeline: [`scripts/seed_db.py`](/Volumes/space/お金の流れ/global-money-flow/scripts/seed_db.py)
- App usage notes: [`docs/app_usage_guide.md`](/Volumes/space/お金の流れ/global-money-flow/docs/app_usage_guide.md)

## Validation Commands

Run these after changes:

```bash
python3 -m py_compile scripts/build_reviewed_budget_dataset.py scripts/seed_db.py
python3 scripts/seed_db.py
npm run build
```

When debugging a new ministry, inspect the DB directly:

```bash
sqlite3 data/money_flow.db "select e.source_id,e.target_id,p.source_title,p.page_number from edges e left join source_provenance p on p.edge_id=e.id where e.fiscal_year=2025 and e.source_id='MIN_MEXT';"
```
