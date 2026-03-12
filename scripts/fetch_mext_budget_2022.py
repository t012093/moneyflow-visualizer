#!/usr/bin/env python3
"""
Generate the reviewed MEXT FY2022 major budget projects dataset.
"""

from __future__ import annotations

from pathlib import Path

from build_reviewed_budget_dataset import build_dataset, load_candidate


def main() -> int:
    repo_root = Path(__file__).resolve().parent.parent
    input_path = repo_root / "scripts" / "reviewed_budget_candidates" / "mext_r4_major_projects.json"
    output_path = repo_root / "src" / "data" / "mext_budget_2022_data.json"

    dataset = build_dataset(load_candidate(input_path))
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(__import__("json").dumps(dataset, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"✅ wrote {output_path}")
    print(f"   nodes={len(dataset['nodes'])} edges={len(dataset['edges'])} highlights={len(dataset.get('budget_highlights', []))}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
