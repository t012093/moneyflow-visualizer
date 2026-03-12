#!/usr/bin/env python3
"""
LLM-Powered Budget Data Extraction
====================================
Uses Gemini API to:
  1. Fetch web pages from government open data sources
  2. Extract structured budget flow data (nodes + edges)
  3. Store results with full provenance tracking

Usage:
  python scripts/llm_extract_budget.py                     # Extract from all high-priority sources
  python scripts/llm_extract_budget.py --source cfa_budget # Extract from specific source
  python scripts/llm_extract_budget.py --url <URL>         # Extract from a specific URL
  python scripts/llm_extract_budget.py --dry-run           # Preview without DB writes

Requires:
  pip install google-genai httpx beautifulsoup4
  export GEMINI_API_KEY=your_key
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sqlite3
import sys
import time
from datetime import datetime
from typing import Any

try:
    import httpx
except ImportError:
    print("❌ httpx not installed. Run: pip install httpx")
    sys.exit(1)

try:
    from bs4 import BeautifulSoup
except ImportError:
    print("❌ beautifulsoup4 not installed. Run: pip install beautifulsoup4")
    sys.exit(1)

try:
    from google import genai
    from google.genai import types
except ImportError:
    print("❌ google-genai not installed. Run: pip install google-genai")
    sys.exit(1)

DB_PATH = os.path.join(os.path.dirname(__file__), '../data/money_flow.db')
JPY_PER_USD = 150

# ─── Gemini Configuration ───
GEMINI_MODEL = "gemini-2.5-flash"

EXTRACTION_PROMPT = """あなたは日本の政府予算データの専門分析家です。
以下のウェブページまたは文書のテキストから、「お金の流れ（フロー）」を抽出してください。

## 抽出ルール
1. 1つのフロー = 「どこから（source）」→「どこへ（target）」→「いくら（amount_oku_yen）」
2. 金額は億円単位で統一（兆円は×10000、万円は÷10000に変換）
3. 年度情報が記載されていれば「fiscal_year」に記載（例: "R7" → 2025, "R6" → 2024）
4. confidence は 0.0〜1.0（文書に明確な数値があれば0.9以上、推計なら0.5〜0.8）

## 出力形式 (JSON)
```json
{
  "source_title": "文書のタイトル",
  "source_agency": "省庁名",
  "fiscal_year": 2025,
  "extracted_flows": [
    {
      "source_name": "こども家庭庁",
      "source_id_suggestion": "MIN_CFA",
      "target_name": "児童手当",
      "target_id_suggestion": "REC_CHILD_ALLOW",
      "amount_oku_yen": 21649,
      "category": "welfare",
      "sub_category": "児童手当",
      "confidence": 0.95,
      "evidence_text": "原文の該当箇所（50文字以内）",
      "notes": "補足情報"
    }
  ],
  "summary": "このページから抽出されたフローの概要",
  "data_quality_notes": "データ品質に関する注意事項"
}
```

## カテゴリ一覧
- tax: 税収関連
- welfare: 社会保障・福祉
- education: 教育
- infrastructure: インフラ・建設
- services: 公共サービス
- technology: IT・技術
- banking: 金融・銀行
- trade: 貿易

## node_id の命名規則
- 省庁: MIN_XXX (例: MIN_CFA, MIN_MHLW, MIN_MOF)
- 制度分類: SS_XXX (例: SS_CHILDCARE, SS_MEDICAL)
- 受給者: REC_XXX (例: REC_CHILD_ALLOW, REC_PENSION)
- 企業: CORP_XXX (例: CORP_ACCENTURE)
- 地方: LOCAL_XXX (例: LOCAL_TOYAMA)

## 入力テキスト
{text}
"""


def fetch_page_text(url: str) -> tuple[str, str]:
    """Fetch a URL and extract visible text content."""
    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; OpenDataBot/1.0; +https://github.com/opendata)"
    }
    resp = httpx.get(url, headers=headers, follow_redirects=True, timeout=30)
    resp.raise_for_status()
    
    content_type = resp.headers.get("content-type", "")
    
    if "pdf" in content_type:
        # For PDFs, we'd need PyMuPDF - return a placeholder
        return f"[PDF document from {url} - PDF extraction requires PyMuPDF]", "application/pdf"
    
    soup = BeautifulSoup(resp.text, "html.parser")
    
    # Remove scripts, styles, nav elements
    for tag in soup(["script", "style", "nav", "footer", "header"]):
        tag.decompose()
    
    # Get page title
    title = soup.title.string if soup.title else url
    
    # Extract main content text
    text = soup.get_text(separator="\n", strip=True)
    
    # Clean up: remove excessive whitespace
    text = re.sub(r'\n{3,}', '\n\n', text)
    
    # Truncate to ~8000 chars to fit in context window
    if len(text) > 8000:
        text = text[:8000] + "\n\n[... truncated ...]"
    
    return f"# {title}\n\n{text}", content_type


def extract_with_gemini(text: str, api_key: str) -> dict[str, Any]:
    """Use Gemini to extract structured budget flows from text."""
    client = genai.Client(api_key=api_key)
    
    prompt = EXTRACTION_PROMPT.replace("{text}", text)
    
    response = client.models.generate_content(
        model=GEMINI_MODEL,
        contents=prompt,
        config=types.GenerateContentConfig(
            temperature=0.1,
            response_mime_type="application/json",
        ),
    )
    
    # Parse the JSON response
    result_text = response.text.strip()
    
    # Handle markdown code blocks
    if result_text.startswith("```"):
        result_text = re.sub(r'^```(?:json)?\s*', '', result_text)
        result_text = re.sub(r'\s*```$', '', result_text)
    
    return json.loads(result_text)


def store_extracted_data(
    conn: sqlite3.Connection, 
    extracted: dict[str, Any], 
    source_url: str,
    source_id: str | None,
    dry_run: bool = False
) -> dict[str, int]:
    """Store extracted flows in DB with provenance."""
    stats = {"nodes_created": 0, "edges_created": 0, "provenance_created": 0}
    
    fiscal_year = extracted.get("fiscal_year", 2024)
    source_title = extracted.get("source_title", source_url)
    
    for flow in extracted.get("extracted_flows", []):
        # Skip low-confidence flows
        confidence = flow.get("confidence", 0.5)
        if confidence < 0.3:
            print(f"  ⚠️  Skipping low-confidence flow: {flow.get('source_name')} → {flow.get('target_name')} (conf={confidence})")
            continue
        
        source_node_id = flow.get("source_id_suggestion", f"EXT_{flow['source_name'][:10]}")
        target_node_id = flow.get("target_id_suggestion", f"EXT_{flow['target_name'][:10]}")
        amount_oku = flow.get("amount_oku_yen", 0)
        
        # Convert 億円 to USD (approximate)
        value_usd = (amount_oku * 1e8) / JPY_PER_USD  # 億円 → 円 → USD
        value_jpy = amount_oku * 1e8
        
        if dry_run:
            print(f"  [DRY] {source_node_id} → {target_node_id}: {amount_oku}億円 (conf={confidence})")
            stats["edges_created"] += 1
            continue
        
        # Ensure source node exists
        existing = conn.execute("SELECT id FROM nodes WHERE id = ?", (source_node_id,)).fetchone()
        if not existing:
            conn.execute(
                "INSERT OR IGNORE INTO nodes (id, name, type, dataset) VALUES (?, ?, ?, ?)",
                (source_node_id, flow["source_name"], "ministry", "llm_extracted")
            )
            stats["nodes_created"] += 1
        
        # Ensure target node exists
        existing = conn.execute("SELECT id FROM nodes WHERE id = ?", (target_node_id,)).fetchone()
        if not existing:
            conn.execute(
                "INSERT OR IGNORE INTO nodes (id, name, type, dataset) VALUES (?, ?, ?, ?)",
                (target_node_id, flow["target_name"], "recipient", "llm_extracted")
            )
            stats["nodes_created"] += 1
        
        # Insert edge
        evidence = flow.get("evidence_text", "")
        description = f"LLM extracted: {evidence}" if evidence else "LLM extracted from open data"
        
        cursor = conn.execute(
            """INSERT INTO edges (source_id, target_id, category, sub_category,
               value_usd, value_jpy, fiscal_year, confidence, source_dataset, description)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                source_node_id, target_node_id,
                flow.get("category", "welfare"),
                flow.get("sub_category"),
                value_usd, value_jpy,
                fiscal_year,
                confidence,
                f"LLM:{source_title}",
                description
            )
        )
        edge_id = cursor.lastrowid
        stats["edges_created"] += 1
        
        # Insert provenance
        conn.execute(
            """INSERT INTO source_provenance 
               (edge_id, source_id, source_url, source_title, extracted_text, extraction_method, confidence)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                edge_id,
                source_id,
                source_url,
                source_title,
                evidence[:500] if evidence else None,
                f"llm_{GEMINI_MODEL}",
                confidence
            )
        )
        stats["provenance_created"] += 1
    
    if not dry_run:
        conn.commit()
    
    return stats


def get_sources_from_db(conn: sqlite3.Connection, priority: str | None = None) -> list[dict]:
    """Get data sources from DB, optionally filtered by priority."""
    query = "SELECT source_id, name, name_ja, url, data_format, priority FROM data_sources"
    params: list[str] = []
    
    if priority:
        query += " WHERE priority = ?"
        params.append(priority)
    else:
        query += " WHERE priority IN ('critical', 'high')"
    
    query += " ORDER BY CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 ELSE 2 END"
    
    return [
        {"source_id": r[0], "name": r[1], "name_ja": r[2], "url": r[3], "data_format": r[4], "priority": r[5]}
        for r in conn.execute(query, params).fetchall()
    ]


def main():
    parser = argparse.ArgumentParser(description="LLM-powered budget data extraction")
    parser.add_argument("--source", help="Specific data source ID (e.g., cfa_budget)")
    parser.add_argument("--url", help="Specific URL to extract from")
    parser.add_argument("--dry-run", action="store_true", help="Preview without writing to DB")
    parser.add_argument("--priority", choices=["critical", "high", "medium"], help="Filter by priority")
    parser.add_argument("--delay", type=float, default=2.0, help="Delay between API calls (seconds)")
    args = parser.parse_args()
    
    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        print("❌ Set GEMINI_API_KEY or GOOGLE_API_KEY environment variable")
        sys.exit(1)
    
    if not os.path.exists(DB_PATH):
        print("❌ Database not found. Run init_db.py first.")
        sys.exit(1)
    
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA foreign_keys = ON;")
    
    total_stats = {"nodes_created": 0, "edges_created": 0, "provenance_created": 0}
    
    if args.url:
        # Single URL extraction
        print(f"\n🔍 Extracting from URL: {args.url}")
        text, _ = fetch_page_text(args.url)
        print(f"   Fetched {len(text)} characters")
        
        print(f"   🤖 Sending to {GEMINI_MODEL}...")
        extracted = extract_with_gemini(text, api_key)
        
        print(f"   📊 Extracted {len(extracted.get('extracted_flows', []))} flows")
        print(f"   📝 Summary: {extracted.get('summary', 'N/A')}")
        
        stats = store_extracted_data(conn, extracted, args.url, None, args.dry_run)
        for k, v in stats.items():
            total_stats[k] += v
    else:
        # Batch extraction from registered sources
        if args.source:
            sources = [s for s in get_sources_from_db(conn) if s["source_id"] == args.source]
            if not sources:
                # Try without priority filter
                row = conn.execute(
                    "SELECT source_id, name, name_ja, url, data_format, priority FROM data_sources WHERE source_id = ?",
                    (args.source,)
                ).fetchone()
                if row:
                    sources = [{"source_id": row[0], "name": row[1], "name_ja": row[2], 
                               "url": row[3], "data_format": row[4], "priority": row[5]}]
        else:
            sources = get_sources_from_db(conn, args.priority)
        
        if not sources:
            print("❌ No matching data sources found")
            conn.close()
            sys.exit(1)
        
        print(f"\n📋 Processing {len(sources)} data sources:")
        for s in sources:
            print(f"   [{s['priority']:>8s}] {s['source_id']:30s} {s['name_ja'] or s['name']}")
        
        for i, source in enumerate(sources):
            url = source["url"]
            if not url:
                print(f"\n⚠️  Skipping {source['source_id']}: no URL")
                continue
            
            # Skip PDF-only sources (can't extract text yet)
            if source.get("data_format") == "PDF":
                print(f"\n⚠️  Skipping {source['source_id']}: PDF-only (requires PyMuPDF)")
                continue
            
            print(f"\n{'='*60}")
            print(f"🔍 [{i+1}/{len(sources)}] {source['name_ja'] or source['name']}")
            print(f"   URL: {url}")
            
            try:
                text, content_type = fetch_page_text(url)
                print(f"   Fetched {len(text)} characters ({content_type})")
                
                if "[PDF document" in text:
                    print(f"   ⚠️  PDF detected - skipping (PyMuPDF not available)")
                    continue
                
                if len(text) < 100:
                    print(f"   ⚠️  Too little content - skipping")
                    continue
                
                print(f"   🤖 Sending to {GEMINI_MODEL}...")
                extracted = extract_with_gemini(text, api_key)
                
                flows = extracted.get("extracted_flows", [])
                print(f"   📊 Extracted {len(flows)} flows")
                if extracted.get("summary"):
                    print(f"   📝 {extracted['summary'][:100]}")
                
                stats = store_extracted_data(
                    conn, extracted, url, source["source_id"], args.dry_run
                )
                for k, v in stats.items():
                    total_stats[k] += v
                
                # Update last_crawled_at
                if not args.dry_run:
                    conn.execute(
                        "UPDATE data_sources SET last_crawled_at = ? WHERE source_id = ?",
                        (datetime.now().isoformat(), source["source_id"])
                    )
                    conn.commit()
                
                # Rate limiting
                if i < len(sources) - 1:
                    print(f"   ⏱️  Waiting {args.delay}s...")
                    time.sleep(args.delay)
                    
            except Exception as e:
                print(f"   ❌ Error: {e}")
                continue
    
    # Summary
    print(f"\n{'='*60}")
    print(f"✅ Extraction complete {'(DRY RUN)' if args.dry_run else ''}")
    print(f"   Nodes created:      {total_stats['nodes_created']}")
    print(f"   Edges created:      {total_stats['edges_created']}")
    print(f"   Provenance records: {total_stats['provenance_created']}")
    
    conn.close()


if __name__ == "__main__":
    main()
