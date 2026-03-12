#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import sys
import unicodedata
from typing import Any


ROOT_DIR = Path(__file__).resolve().parents[1]
DEFAULT_ENV_FILE = ROOT_DIR / ".env"

sys.path.insert(0, str(Path(__file__).resolve().parent))

from run_rag_eval import load_env_file  # noqa: E402
import mcp_server  # noqa: E402


def strip_json_fence(text: str) -> str:
    cleaned = (text or "").strip()
    cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
    cleaned = re.sub(r"\s*```$", "", cleaned)
    return cleaned.strip()


def slug_or_hash(text: str) -> str:
    normalized = unicodedata.normalize("NFKC", text or "").strip().lower()
    ascii_slug = re.sub(r"[^a-z0-9]+", "_", normalized).strip("_")
    if ascii_slug:
        return ascii_slug[:36]
    digest = hashlib.sha1((text or "").encode("utf-8")).hexdigest()
    return digest[:12]


def infer_region(category: str, title: str) -> str:
    combined = f"{category} {title}"
    if any(token in combined for token in ("education", "学校", "大学", "研究", "科学")):
        return "Education"
    if any(token in combined for token in ("medical", "health", "福祉", "介護", "医療")):
        return "Welfare"
    if any(token in combined for token in ("energy", "gx", "インフラ", "水素", "省エネ")):
        return "Energy"
    if any(token in combined for token in ("technology", "半導体", "ai", "dx", "デジタル")):
        return "Technology"
    if any(token in combined for token in ("employment", "labor", "雇用")):
        return "Labor"
    return "Policy"


def position_for_index(source_node: dict[str, Any], index: int) -> tuple[float, float]:
    base_lat = float(source_node.get("lat") or 35.0)
    base_lng = float(source_node.get("lng") or 139.0)
    offsets = [
        (0.0012, 0.0008),
        (-0.0011, 0.0014),
        (0.0005, -0.0015),
        (0.0018, -0.0004),
        (-0.0015, -0.0011),
        (0.0009, 0.0019),
        (-0.0007, 0.0021),
        (0.0015, -0.0018),
    ]
    lat_offset, lng_offset = offsets[index % len(offsets)]
    cycle = index // len(offsets)
    scale = 1 + cycle * 0.35
    return base_lat + lat_offset * scale, base_lng + lng_offset * scale


def build_prompt(
    query: str,
    source_dataset: str,
    source_title: str,
    source_url: str,
    fiscal_year: int,
    context_text: str,
    max_programs: int,
    max_highlights: int,
) -> str:
    return f"""あなたは日本の省庁予算PDFから reviewed candidate JSON を作る補助担当です。

目的:
- official PDF の根拠に基づき、主要事業 edge 候補と budget_highlights 候補を抽出する
- 出力は厳密に JSON のみ

前提:
- source_dataset: {source_dataset}
- source_title: {source_title}
- source_url: {source_url}
- fiscal_year: {fiscal_year}
- user_query: {query}
- major programs は最大 {max_programs} 件
- budget highlights は最大 {max_highlights} 件

重要ルール:
- 金額は `amount_oku_yen` に数値で入れる。単位は億円
- `citation_ids` には必ず context 中の `[1]` のような番号を入れる
- 事業名や施策名は資料の表記に寄せる
- 推測で数値を作らない
- JSON 以外の説明文は一切出さない

出力 schema:
{{
  "summary": "短い要約",
  "targets": [
    {{
      "title": "事業名",
      "amount_oku_yen": 1234,
      "category": "education|welfare|technology|infrastructure|services|other",
      "sub_category": "UI表示用の短い名前",
      "description": "1文の説明",
      "citation_ids": ["[1]"]
    }}
  ],
  "budget_highlights": [
    {{
      "section_key": "overview|increase_driver|policy_frame|individual_project",
      "title": "見出し",
      "amount_text": "1,234億円",
      "amount_oku_yen": 1234,
      "summary": "1文の説明",
      "citation_ids": ["[1]"]
    }}
  ]
}}

context:
{context_text}
"""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate a reviewed budget candidate draft from RAG context.")
    parser.add_argument("--env-file", default=str(DEFAULT_ENV_FILE), help="Path to .env file.")
    parser.add_argument("--query", required=True, help="Budget extraction query.")
    parser.add_argument("--source-node-id", required=True, help="Source ministry node id, e.g. MIN_MEXT.")
    parser.add_argument("--source-dataset", required=True, help="Source dataset label for the reviewed candidate.")
    parser.add_argument("--source-title", required=True, help="Official source title.")
    parser.add_argument("--source-url", required=True, help="Official source URL.")
    parser.add_argument("--fiscal-year", type=int, required=True, help="Fiscal year for the candidate.")
    parser.add_argument("--output", required=True, help="Output reviewed candidate JSON path.")
    parser.add_argument("--document-id", type=int, default=None, help="Optional document id to constrain retrieval.")
    parser.add_argument("--mode", default="hybrid", help="Retrieval mode.")
    parser.add_argument("--limit", type=int, default=8, help="Citation limit.")
    parser.add_argument("--max-context-chars", type=int, default=7000, help="Context size limit.")
    parser.add_argument("--max-programs", type=int, default=5, help="Max target programs to keep.")
    parser.add_argument("--max-highlights", type=int, default=8, help="Max budget highlights to keep.")
    parser.add_argument("--provider", default=None, help="Override answer provider.")
    parser.add_argument("--model", default=None, help="Override answer model.")
    parser.add_argument("--temperature", type=float, default=0.1, help="Generation temperature.")
    parser.add_argument("--max-output-tokens", type=int, default=1400, help="Generation max output tokens.")
    return parser.parse_args()


def resolve_source_node(conn: Any, source_node_id: str) -> dict[str, Any]:
    row = conn.execute(
        "SELECT id, name, lat, lng, region, type FROM nodes WHERE id = ?",
        (source_node_id,),
    ).fetchone()
    if not row:
        raise RuntimeError(f"Source node not found: {source_node_id}")
    return dict(row)


def build_citation_map(citations: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {str(citation["citation_id"]): citation for citation in citations if citation.get("citation_id")}


def normalize_target_item(
    item: dict[str, Any],
    source_node: dict[str, Any],
    citation_map: dict[str, dict[str, Any]],
    index: int,
) -> dict[str, Any]:
    title = str(item.get("title") or "").strip()
    if not title:
        raise ValueError("target title is required")
    lat, lng = position_for_index(source_node, index)
    citation_ids = [str(value).strip() for value in item.get("citation_ids", []) if str(value).strip()]
    primary_citation = citation_map.get(citation_ids[0]) if citation_ids else None
    category = str(item.get("category") or "other").strip().lower()
    source_suffix = source_node["id"].replace("MIN_", "")
    return {
        "target_id": f"REC_{source_suffix}_{slug_or_hash(title).upper()}",
        "target_name": title,
        "target_type": "recipient",
        "region": infer_region(category, title),
        "lat": round(lat, 4),
        "lng": round(lng, 4),
        "amount_oku_yen": float(item["amount_oku_yen"]),
        "category": category,
        "sub_category": str(item.get("sub_category") or title).strip(),
        "description": str(item.get("description") or "").strip() or None,
        "source_title": primary_citation.get("file_name") if primary_citation else None,
        "source_url": primary_citation.get("source_url") if primary_citation else None,
        "page_number": primary_citation.get("page_number") if primary_citation else None,
    }


def normalize_highlight_item(
    item: dict[str, Any],
    source_node_id: str,
    fiscal_year: int,
    citation_map: dict[str, dict[str, Any]],
    index: int,
) -> dict[str, Any]:
    title = str(item.get("title") or "").strip()
    if not title:
        raise ValueError("highlight title is required")
    citation_ids = [str(value).strip() for value in item.get("citation_ids", []) if str(value).strip()]
    primary_citation = citation_map.get(citation_ids[0]) if citation_ids else None
    return {
        "entity_id": source_node_id,
        "fiscal_year": fiscal_year,
        "section_key": str(item.get("section_key") or "individual_project").strip(),
        "title": title,
        "amount_text": item.get("amount_text"),
        "amount_oku_yen": float(item["amount_oku_yen"]) if item.get("amount_oku_yen") is not None else None,
        "summary": str(item.get("summary") or "").strip() or None,
        "source_title": primary_citation.get("file_name") if primary_citation else None,
        "source_url": primary_citation.get("source_url") if primary_citation else None,
        "page_number": primary_citation.get("page_number") if primary_citation else None,
        "display_order": int(item.get("display_order") or ((index + 1) * 10)),
    }


def main() -> int:
    args = parse_args()
    load_env_file(Path(args.env_file))

    conn = mcp_server.get_db()
    try:
        source_node = resolve_source_node(conn, args.source_node_id)
        context_pack = mcp_server._answer_documents(
            {
                "query": args.query,
                "mode": args.mode,
                "limit": args.limit,
                "document_id": args.document_id,
                "max_context_chars": args.max_context_chars,
            },
            conn,
        )
        if context_pack.get("error"):
            raise RuntimeError(context_pack["error"])
        if not context_pack.get("citations"):
            raise RuntimeError("No citations returned for the requested query")

        prompt = build_prompt(
            query=args.query,
            source_dataset=args.source_dataset,
            source_title=args.source_title,
            source_url=args.source_url,
            fiscal_year=args.fiscal_year,
            context_text=context_pack["context_text"],
            max_programs=args.max_programs,
            max_highlights=args.max_highlights,
        )
        generation = mcp_server._generate_answer_with_llm(
            prompt,
            provider_override=args.provider,
            model_override=args.model,
            temperature=args.temperature,
            max_output_tokens=args.max_output_tokens,
        )
        if generation.get("status") != "generated":
            raise RuntimeError(generation.get("reason") or generation.get("error") or "LLM generation failed")

        payload = json.loads(strip_json_fence(generation.get("answer", "")))
        citation_map = build_citation_map(context_pack["citations"])

        targets = [
            normalize_target_item(item, source_node, citation_map, index)
            for index, item in enumerate(payload.get("targets", [])[: args.max_programs])
        ]
        highlights = [
            normalize_highlight_item(item, args.source_node_id, args.fiscal_year, citation_map, index)
            for index, item in enumerate(payload.get("budget_highlights", [])[: args.max_highlights])
        ]

        candidate = {
            "source_dataset": args.source_dataset,
            "source_title": args.source_title,
            "source_url": args.source_url,
            "fiscal_year": args.fiscal_year,
            "confidence": 0.9,
            "metadata_source": [args.source_title],
            "scope": f"{args.source_node_id} FY{args.fiscal_year} draft reviewed candidate",
            "source_node": source_node,
            "targets": targets,
            "budget_highlights": highlights,
            "generation_metadata": {
                "query": args.query,
                "mode": args.mode,
                "document_id": args.document_id,
                "provider": generation.get("provider"),
                "model": generation.get("model"),
                "citation_count": len(context_pack.get("citations", [])),
                "summary": payload.get("summary"),
            },
        }

        output_path = Path(args.output)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(json.dumps(candidate, ensure_ascii=False, indent=2), encoding="utf-8")

        print(f"✅ wrote {output_path}")
        print(f"   targets={len(targets)} highlights={len(highlights)} citations={len(context_pack.get('citations', []))}")
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
