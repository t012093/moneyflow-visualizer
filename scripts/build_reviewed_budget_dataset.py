#!/usr/bin/env python3
"""
Build reviewed ministry budget candidates into a frontend dataset JSON.

Usage:
  python scripts/build_reviewed_budget_dataset.py \
    --input scripts/reviewed_budget_candidates/mext_r7_major_projects.json \
    --output src/data/mext_budget_data.json
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

JPY_TO_USD = 1 / 150


def oku_to_usd(value_oku: float) -> float:
    return value_oku * 1e8 * JPY_TO_USD


def load_candidate(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def build_dataset(candidate: dict[str, Any]) -> dict[str, Any]:
    source_node = candidate["source_node"]
    fiscal_year = int(candidate["fiscal_year"])
    source_dataset = candidate["source_dataset"]
    default_source_title = candidate.get("source_title") or source_dataset
    default_source_url = candidate.get("source_url")
    default_confidence = float(candidate.get("confidence", 0.95))

    nodes: list[dict[str, Any]] = [source_node]
    edges: list[dict[str, Any]] = []

    for item in candidate.get("targets", []):
        node = {
            "id": item["target_id"],
            "name": item["target_name"],
            "lat": item["lat"],
            "lng": item["lng"],
            "region": item["region"],
            "type": item["target_type"],
        }
        nodes.append(node)

        edges.append(
            {
                "source_id": source_node["id"],
                "target_id": item["target_id"],
                "category": item.get("category", "education"),
                "sub_category": item.get("sub_category") or item["target_name"],
                "value_usd": oku_to_usd(float(item["amount_oku_yen"])),
                "year": fiscal_year,
                "confidence": float(item.get("confidence", default_confidence)),
                "source_dataset": source_dataset,
                "description": item.get("description"),
                "source_title": item.get("source_title") or default_source_title,
                "source_url": item.get("source_url") or default_source_url,
                "page_number": item.get("page_number"),
            }
        )

    return {
        "nodes": nodes,
        "edges": edges,
        "budget_highlights": candidate.get("budget_highlights", []),
        "metadata": {
            "source": candidate.get("metadata_source", [default_source_title]),
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "scope": candidate.get("scope", f"{source_node['name']} reviewed major budget projects"),
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Build reviewed ministry budget dataset")
    parser.add_argument("--input", required=True, help="Reviewed candidate JSON path")
    parser.add_argument("--output", required=True, help="Output dataset JSON path")
    args = parser.parse_args()

    input_path = Path(args.input)
    output_path = Path(args.output)

    candidate = load_candidate(input_path)
    dataset = build_dataset(candidate)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8") as handle:
        json.dump(dataset, handle, ensure_ascii=False, indent=2)

    print(f"✅ wrote {output_path}")
    print(f"   nodes={len(dataset['nodes'])} edges={len(dataset['edges'])} highlights={len(dataset.get('budget_highlights', []))}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
