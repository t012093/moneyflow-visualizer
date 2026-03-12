#!/usr/bin/env python3
"""
Money Flow MCP Server
======================
Exposes the money-flow SQLite DB as MCP tools for AI agents (Codex, Claude Code).

Tools categories:
  Data Management:   list_sources, search_flows, store_flow, store_node, list_nodes
  Provenance:        get_provenance, get_db_summary
  Smart Crawl:       crawl_url, register_crawl_route, list_crawl_routes, recrawl_route

Usage:
  python scripts/mcp_server.py   # stdio mode (for MCP clients)

Requires:
  pip install mcp httpx beautifulsoup4 pymupdf pandas openpyxl
"""

from __future__ import annotations

from array import array
from collections import Counter
import hashlib
import io
import json
import math
import os
from pathlib import Path
import re
import sqlite3
import sys
from datetime import datetime
from typing import Any
from urllib.parse import urljoin, urlparse
import xml.etree.ElementTree as ET

try:
    from mcp.server import Server
    from mcp.server.stdio import stdio_server
    from mcp.types import Tool, TextContent
except ImportError:
    print("❌ mcp not installed. Run: pip install mcp", file=sys.stderr)
    sys.exit(1)

try:
    import httpx
    HTTPX_IMPORT_ERROR = None
except Exception as exc:
    httpx = None  # type: ignore
    HTTPX_IMPORT_ERROR = exc

try:
    import fitz as pymupdf  # PyMuPDF
    PYMUPDF_IMPORT_ERROR = None
except Exception as exc:
    pymupdf = None  # type: ignore
    PYMUPDF_IMPORT_ERROR = exc

try:
    import pandas as pd
    PANDAS_IMPORT_ERROR = None
except Exception as exc:
    pd = None  # type: ignore
    PANDAS_IMPORT_ERROR = exc

try:
    from bs4 import BeautifulSoup
    BEAUTIFULSOUP_IMPORT_ERROR = None
except Exception as exc:
    BeautifulSoup = None  # type: ignore
    BEAUTIFULSOUP_IMPORT_ERROR = exc


ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
DB_PATH = os.path.join(ROOT_DIR, "data", "money_flow.db")
DEFAULT_ENV_FILE = os.path.join(ROOT_DIR, ".env")
DEFAULT_EVAL_QUESTIONS_FILE = os.path.join(ROOT_DIR, "eval", "questions.json")
DEFAULT_EVAL_RESULTS_FILE = os.path.join(ROOT_DIR, "eval", "latest_results.json")
DEFAULT_EVAL_REPORT_FILE = os.path.join(ROOT_DIR, "eval", "latest_report.md")
DEFAULT_PIPELINE_LOG_FILE = os.path.join(ROOT_DIR, "eval", "latest_daily_pipeline.json")
JPY_PER_USD = 150
CHUNK_TARGET_CHARS = int(os.environ.get("CHUNK_TARGET_CHARS", "1000"))
CHUNK_MAX_CHARS = int(os.environ.get("CHUNK_MAX_CHARS", "1400"))
CHUNK_OVERLAP_CHARS = int(os.environ.get("CHUNK_OVERLAP_CHARS", "150"))
MIN_CHUNK_CHARS = int(os.environ.get("MIN_CHUNK_CHARS", "80"))
LEXICAL_TOP_K = int(os.environ.get("LEXICAL_TOP_K", "20"))
SEMANTIC_TOP_K = int(os.environ.get("SEMANTIC_TOP_K", "20"))
RRF_K = int(os.environ.get("RRF_K", "60"))
DEFAULT_INDEX_EMBEDDINGS = os.environ.get("INDEX_EMBEDDINGS_DEFAULT", "true").lower() not in {"0", "false", "no"}
ANSWER_CONTEXT_LIMIT = int(os.environ.get("ANSWER_CONTEXT_LIMIT", "6000"))
ANSWER_CHUNK_CHAR_LIMIT = int(os.environ.get("ANSWER_CHUNK_CHAR_LIMIT", "1200"))
ANSWER_LLM_PROVIDER = os.environ.get("ANSWER_LLM_PROVIDER", "none").strip().lower()
ANSWER_LLM_MODEL = os.environ.get("ANSWER_LLM_MODEL", "").strip()
ANSWER_LLM_API_BASE = os.environ.get("ANSWER_LLM_API_BASE", "http://127.0.0.1:11434").rstrip("/")
ANSWER_LLM_API_KEY = os.environ.get("ANSWER_LLM_API_KEY", "").strip()
ANSWER_LLM_TIMEOUT_SECONDS = int(os.environ.get("ANSWER_LLM_TIMEOUT_SECONDS", "120"))
ANSWER_LLM_TEMPERATURE = float(os.environ.get("ANSWER_LLM_TEMPERATURE", "0.1"))
ANSWER_LLM_MAX_OUTPUT_TOKENS = int(os.environ.get("ANSWER_LLM_MAX_OUTPUT_TOKENS", "600"))
ANSWER_CITATION_RETRY_LIMIT = int(os.environ.get("ANSWER_CITATION_RETRY_LIMIT", "1"))
ANSWER_CITATION_FALLBACK_MAX_SENTENCES = int(os.environ.get("ANSWER_CITATION_FALLBACK_MAX_SENTENCES", "3"))
EMBEDDING_PROVIDER = os.environ.get("EMBEDDING_PROVIDER", "tei_local")
EMBEDDING_MODEL = os.environ.get("EMBEDDING_MODEL", "Qwen/Qwen3-Embedding-0.6B")
EMBEDDING_MODEL_PATH = os.environ.get("EMBEDDING_MODEL_PATH", "").strip()
EMBEDDING_ENDPOINT = os.environ.get("EMBEDDING_ENDPOINT", "http://127.0.0.1:8080").rstrip("/")
EMBEDDING_DIM = int(os.environ.get("EMBEDDING_DIM", "1024"))
EMBEDDING_TIMEOUT_SECONDS = int(os.environ.get("EMBEDDING_TIMEOUT_SECONDS", "30"))
EMBEDDING_DEVICE = os.environ.get("EMBEDDING_DEVICE", "auto").strip().lower()
EMBEDDING_BATCH_SIZE = int(os.environ.get("EMBEDDING_BATCH_SIZE", "8"))
EMBEDDING_MAX_LENGTH = int(os.environ.get("EMBEDDING_MAX_LENGTH", "8192"))
EMBEDDING_QUERY_TASK = os.environ.get(
    "EMBEDDING_QUERY_TASK",
    "Given a web search query, retrieve relevant passages that answer the query",
)
PDF_PAGE_MARKER_RE = re.compile(r"\n--- Page (\d+) ---\n")
_LOCAL_EMBEDDING_RUNTIME: dict[str, Any] | None = None
FALLBACK_FOCUS_STOPWORDS = {
    "こと", "もの", "ため", "これ", "それ", "ここ", "そこ", "よう", "要点", "概要", "質問",
    "教えて", "ください", "です", "ます", "でした", "ません", "社会", "実現", "構築", "重要", "施策",
    "今回", "主な", "全体", "令和", "年度", "予算案", "向けた", "こど", "子ど", "向上等",
}
FALLBACK_FOCUS_BLACKLIST = {
    "内数",
    "一般会計",
    "特別会計",
    "家庭庁予算",
    "こども家庭庁",
    "支援特別会計",
    "子育て支援特別会計",
    "育児休業等給付勘定",
    "子ども子育て支援勘定",
}
DISCOVERY_OFFICIAL_DOMAIN_SUFFIXES = (
    ".go.jp",
    ".lg.jp",
    ".ac.jp",
    ".or.jp",
)
DISCOVERY_DOCUMENT_EXTENSIONS = {
    ".pdf": "pdf",
    ".csv": "csv",
    ".xlsx": "excel",
    ".xls": "excel",
    ".json": "json",
}
DISCOVERY_ALLOWED_HTML_EXTENSIONS = {
    "",
    ".html",
    ".htm",
    ".php",
    ".aspx",
    ".jsp",
}
SOURCE_POLICY_MIME_TYPE_MAP = {
    "pdf": ["application/pdf"],
    "html": ["text/html"],
    "csv": ["text/csv"],
    "excel": [
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.ms-excel",
    ],
    "json": ["application/json"],
}
DISCOVERY_PRIMARY_KEYWORDS = {
    "予算",
    "概算要求",
    "主要施策",
    "事業概要",
    "事業一覧",
    "施策集",
    "資料",
    "説明資料",
    "pdf",
}
DISCOVERY_INDEX_KEYWORDS = {
    "一覧",
    "お知らせ",
    "公表",
    "掲載",
    "特集",
    "政策",
    "予算ページ",
    "予算",
}
DISCOVERY_NAVIGATION_TITLES = {
    "ホーム",
    "検索",
    "メニュー",
    "サイトマップ",
    "ご意見・ご要望",
    "関連リンク",
    "組織情報",
    "広報・報道",
    "新着・更新",
    "大臣等会見",
    "global site",
}
DISCOVERY_BLOCKED_PATH_FRAGMENTS = {
    "/search",
    "/search/",
    "/tag/",
    "/tags/",
    "/category/",
    "/categories/",
    "/amp/",
}
DISCOVERY_BLOCKED_QUERY_KEYS = {
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "gclid",
    "fbclid",
    "sessionid",
}
FALLBACK_FOCUS_THEME_RULES: dict[str, dict[str, set[str]]] = {
    "childcare": {
        "triggers": {
            "児童手当", "子育て", "保育", "保育士", "放課後児童クラブ",
            "こども誰でも通園制度", "妊婦", "妊娠", "出産",
        },
        "blacklist": {
            "若い世代", "若者", "高等教育", "大学", "授業料", "進学", "受験料",
            "カウンセリング", "ライフデザイン", "結婚支援", "負担軽減",
        },
    },
    "higher_education": {
        "triggers": {
            "高等教育", "大学", "授業料", "進学", "受験料", "学生", "奨学",
        },
        "blacklist": {
            "児童手当", "保育", "保育士", "放課後児童クラブ", "妊婦", "出産",
            "乳幼児", "子育て", "こども誰でも通園制度",
        },
    },
    "youth_support": {
        "triggers": {
            "若者", "若い世代", "ライフデザイン", "結婚支援", "少子化",
        },
        "blacklist": {
            "児童手当", "保育", "保育士", "高等教育", "授業料", "放課後児童クラブ",
        },
    },
}
SEARCH_TERM_COMPONENT_SUFFIXES = (
    "拡充",
    "軽減",
    "支援",
    "改善",
    "強化",
    "推進",
    "無償化",
    "充実",
    "普及",
    "策定",
    "反映",
    "創設",
    "撤廃",
    "整備",
)
RUNTIME_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS chunk_embeddings (
  chunk_id         INTEGER PRIMARY KEY REFERENCES document_chunks(id) ON DELETE CASCADE,
  model_name       TEXT NOT NULL,
  embedding_dim    INTEGER NOT NULL,
  embedding_blob   BLOB NOT NULL,
  content_hash     TEXT NOT NULL,
  created_at       TEXT DEFAULT (datetime('now')),
  updated_at       TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_chunk_embeddings_model
  ON chunk_embeddings(model_name);

CREATE INDEX IF NOT EXISTS idx_document_chunks_doc
  ON document_chunks(document_id, chunk_index);

CREATE TABLE IF NOT EXISTS source_candidates (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  candidate_url       TEXT NOT NULL UNIQUE,
  domain              TEXT NOT NULL,
  title               TEXT,
  publisher           TEXT,
  file_type           TEXT,
  discovered_by       TEXT NOT NULL,
  discovery_query     TEXT,
  llm_classification  TEXT,
  llm_confidence      REAL,
  is_primary_source   INTEGER DEFAULT 0,
  is_official_site    INTEGER DEFAULT 0,
  is_stable_url       INTEGER DEFAULT 0,
  review_status       TEXT DEFAULT 'pending',
  review_note         TEXT,
  created_at          TEXT DEFAULT (datetime('now')),
  reviewed_at         TEXT,
  updated_at          TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS source_policies (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  domain               TEXT NOT NULL,
  allowed_path_regex   TEXT NOT NULL,
  allowed_mime_types   TEXT,
  trust_tier           TEXT NOT NULL,
  auto_ingest          INTEGER DEFAULT 0,
  extract_strategy     TEXT DEFAULT 'auto',
  review_status        TEXT DEFAULT 'approved',
  owner_note           TEXT,
  created_at           TEXT DEFAULT (datetime('now')),
  last_reviewed_at     TEXT,
  updated_at           TEXT DEFAULT (datetime('now')),
  UNIQUE(domain, allowed_path_regex)
);

CREATE TABLE IF NOT EXISTS budget_highlights (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_id            TEXT NOT NULL REFERENCES nodes(id),
  fiscal_year          INTEGER NOT NULL,
  section_key          TEXT NOT NULL,
  title                TEXT NOT NULL,
  amount_text          TEXT,
  amount_oku_yen       REAL,
  summary              TEXT,
  source_title         TEXT,
  source_url           TEXT,
  page_number          INTEGER,
  display_order        INTEGER DEFAULT 0,
  created_at           TEXT DEFAULT (datetime('now')),
  updated_at           TEXT DEFAULT (datetime('now')),
  UNIQUE(entity_id, fiscal_year, section_key, title)
);

CREATE TABLE IF NOT EXISTS knowledge_notes (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_id            TEXT NOT NULL REFERENCES nodes(id),
  fiscal_year          INTEGER NOT NULL,
  note_key             TEXT NOT NULL,
  title                TEXT NOT NULL,
  summary              TEXT,
  key_points_json      TEXT,
  body_markdown        TEXT,
  doc_path             TEXT,
  display_order        INTEGER DEFAULT 0,
  created_at           TEXT DEFAULT (datetime('now')),
  updated_at           TEXT DEFAULT (datetime('now')),
  UNIQUE(entity_id, fiscal_year, note_key)
);

CREATE TABLE IF NOT EXISTS knowledge_note_sources (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  note_id              INTEGER NOT NULL REFERENCES knowledge_notes(id) ON DELETE CASCADE,
  source_title         TEXT NOT NULL,
  source_url           TEXT NOT NULL,
  source_kind          TEXT,
  authority_level      TEXT,
  display_order        INTEGER DEFAULT 0,
  UNIQUE(note_id, source_url)
);

CREATE TABLE IF NOT EXISTS structured_facts (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_id            TEXT NOT NULL REFERENCES nodes(id),
  fiscal_year          INTEGER NOT NULL,
  fact_key             TEXT NOT NULL,
  fact_group           TEXT,
  title                TEXT NOT NULL,
  value_text           TEXT NOT NULL,
  numeric_value        REAL,
  unit                 TEXT,
  summary              TEXT,
  note_key             TEXT,
  source_excerpt       TEXT,
  display_order        INTEGER DEFAULT 0,
  created_at           TEXT DEFAULT (datetime('now')),
  updated_at           TEXT DEFAULT (datetime('now')),
  UNIQUE(entity_id, fiscal_year, fact_key)
);

CREATE TABLE IF NOT EXISTS structured_fact_sources (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  fact_id              INTEGER NOT NULL REFERENCES structured_facts(id) ON DELETE CASCADE,
  source_title         TEXT NOT NULL,
  source_url           TEXT NOT NULL,
  source_kind          TEXT,
  authority_level      TEXT,
  display_order        INTEGER DEFAULT 0,
  UNIQUE(fact_id, source_url)
);

CREATE TABLE IF NOT EXISTS source_link_health (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  source_url           TEXT NOT NULL UNIQUE,
  request_url          TEXT,
  final_url            TEXT,
  validation_status    TEXT NOT NULL DEFAULT 'unknown',
  http_status          INTEGER,
  error_message        TEXT,
  checked_at           TEXT,
  created_at           TEXT DEFAULT (datetime('now')),
  updated_at           TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_source_candidates_domain
  ON source_candidates(domain);

CREATE INDEX IF NOT EXISTS idx_source_candidates_status
  ON source_candidates(review_status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_source_policies_domain
  ON source_policies(domain);

CREATE INDEX IF NOT EXISTS idx_source_policies_status
  ON source_policies(review_status, auto_ingest, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_budget_highlights_entity_year
  ON budget_highlights(entity_id, fiscal_year, section_key, display_order);

CREATE INDEX IF NOT EXISTS idx_knowledge_notes_entity_year
  ON knowledge_notes(entity_id, fiscal_year, display_order);

CREATE INDEX IF NOT EXISTS idx_knowledge_note_sources_note
  ON knowledge_note_sources(note_id, display_order);

CREATE INDEX IF NOT EXISTS idx_structured_facts_entity_year
  ON structured_facts(entity_id, fiscal_year, display_order);

CREATE INDEX IF NOT EXISTS idx_structured_fact_sources_fact
  ON structured_fact_sources(fact_id, display_order);

CREATE INDEX IF NOT EXISTS idx_source_link_health_status
  ON source_link_health(validation_status, updated_at DESC);
"""

# ─── Database helpers ───

def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.row_factory = sqlite3.Row
    conn.executescript(RUNTIME_SCHEMA_SQL)
    return conn

def rows_to_dicts(rows) -> list[dict]:
    return [dict(r) for r in rows]


# ─── Content Extraction ───

def _fetch_url(url: str) -> tuple[bytes, str, str]:
    """Fetch URL, return (content_bytes, content_type, final_url)."""
    if not httpx:
        raise RuntimeError(f"httpx unavailable: {HTTPX_IMPORT_ERROR or 'not installed'}")
    headers = {"User-Agent": "Mozilla/5.0 (compatible; MoneyFlowBot/1.0)"}
    resp = httpx.get(url, headers=headers, follow_redirects=True, timeout=30, verify=False)
    resp.raise_for_status()
    ct = resp.headers.get("content-type", "")
    return resp.content, ct, str(resp.url)


def _extract_html(content: bytes, url: str) -> dict:
    """Extract text and tables from HTML."""
    if not BeautifulSoup:
        return {"text": content.decode("utf-8", errors="replace"), "tables": []}
    
    soup = BeautifulSoup(content, "html.parser")
    for tag in soup(["script", "style", "nav", "footer", "header", "aside"]):
        tag.decompose()
    
    title = soup.title.string.strip() if soup.title and soup.title.string else url
    
    # Extract tables with numbers
    tables = []
    for i, table_tag in enumerate(soup.find_all("table")):
        rows = []
        for tr in table_tag.find_all("tr"):
            cells = [td.get_text(strip=True) for td in tr.find_all(["td", "th"])]
            if cells:
                rows.append(cells)
        if rows and len(rows) > 1:
            # Check if table contains numbers
            has_numbers = any(
                re.search(r'\d', cell) 
                for row in rows for cell in row
            )
            if has_numbers:
                tables.append({
                    "table_index": i,
                    "headers": rows[0] if rows else [],
                    "rows": rows[1:20],  # Limit to 20 rows
                    "total_rows": len(rows) - 1
                })
    
    text = soup.get_text(separator="\n", strip=True)
    text = re.sub(r'\n{3,}', '\n\n', text)
    
    return {
        "title": title,
        "text": text,
        "tables": tables[:10],
        "table_count": len(tables)
    }


def _extract_pdf(content: bytes, url: str) -> dict:
    """Extract text and tables from PDF using PyMuPDF."""
    if not pymupdf:
        return {"error": f"PyMuPDF unavailable: {PYMUPDF_IMPORT_ERROR or 'not installed'}", "text": ""}
    
    doc = pymupdf.open(stream=content, filetype="pdf")
    pages = []
    all_text = ""
    tables_found = []
    
    for page_num in range(min(len(doc), 30)):  # Limit to 30 pages
        page = doc[page_num]
        page_text = page.get_text()
        all_text += f"\n--- Page {page_num + 1} ---\n{page_text}"
        
        # Extract tables if available
        try:
            page_tables = page.find_tables()
            for t_idx, table in enumerate(page_tables):
                table_data = table.extract()
                if table_data and len(table_data) > 1:
                    has_numbers = any(
                        cell and re.search(r'\d', str(cell))
                        for row in table_data for cell in row
                    )
                    if has_numbers:
                        tables_found.append({
                            "page": page_num + 1,
                            "table_index": t_idx,
                            "headers": [str(c) if c else "" for c in table_data[0]],
                            "rows": [[str(c) if c else "" for c in row] for row in table_data[1:20]],
                            "total_rows": len(table_data) - 1
                        })
        except Exception:
            pass  # Table extraction not available in older PyMuPDF
        
        pages.append({
            "page": page_num + 1,
            "text_length": len(page_text),
            "has_tables": any(t["page"] == page_num + 1 for t in tables_found)
        })
    
    total_pages = len(doc) if hasattr(doc, '__len__') else 0
    doc.close()
    
    return {
        "title": url.split("/")[-1],
        "total_pages": total_pages,
        "text": all_text,
        "tables": tables_found[:15],
        "table_count": len(tables_found),
        "pages_summary": pages
    }


def _extract_csv(content: bytes, url: str) -> dict:
    """Extract data from CSV."""
    if not pd:
        return {
            "error": f"pandas unavailable: {PANDAS_IMPORT_ERROR or 'not installed'}",
            "text": content.decode("utf-8", errors="replace")[:5000],
        }
    
    try:
        # Try different encodings common in Japanese gov data
        for enc in ["utf-8", "shift_jis", "cp932", "euc-jp"]:
            try:
                df = pd.read_csv(io.BytesIO(content), encoding=enc)
                break
            except (UnicodeDecodeError, pd.errors.ParserError):
                continue
        else:
            return {"error": "Could not decode CSV with any Japanese encoding"}
        
        # Find numeric columns
        numeric_cols = df.select_dtypes(include=["number"]).columns.tolist()
        
        return {
            "title": url.split("/")[-1],
            "columns": list(df.columns),
            "numeric_columns": numeric_cols,
            "shape": list(df.shape),
            "sample_rows": df.head(20).to_dict(orient="records"),
            "text": json.dumps(
                {
                    "title": url.split("/")[-1],
                    "columns": list(df.columns),
                    "numeric_columns": numeric_cols,
                    "shape": list(df.shape),
                    "sample_rows": df.head(20).to_dict(orient="records"),
                },
                ensure_ascii=False,
                indent=2,
            ),
            "summary": {col: {"min": float(df[col].min()), "max": float(df[col].max()), "mean": float(df[col].mean())} 
                       for col in numeric_cols[:5]} if numeric_cols else {}
        }
    except Exception as e:
        return {"error": f"CSV parse error: {e}"}


def _extract_excel(content: bytes, url: str) -> dict:
    """Extract data from Excel."""
    if not pd:
        return {"error": f"pandas unavailable: {PANDAS_IMPORT_ERROR or 'not installed'}"}
    
    try:
        xls = pd.ExcelFile(io.BytesIO(content))
        sheets = {}
        for sheet_name in xls.sheet_names[:5]:  # Limit to 5 sheets
            df = xls.parse(sheet_name, nrows=30)
            numeric_cols = df.select_dtypes(include=["number"]).columns.tolist()
            sheets[sheet_name] = {
                "columns": list(df.columns.astype(str)),
                "numeric_columns": [str(c) for c in numeric_cols],
                "shape": list(df.shape),
                "sample_rows": df.head(15).fillna("").astype(str).to_dict(orient="records"),
            }
        
        return {
            "title": url.split("/")[-1],
            "sheet_names": xls.sheet_names,
            "sheets": sheets,
            "text": json.dumps(
                {
                    "title": url.split("/")[-1],
                    "sheet_names": xls.sheet_names,
                    "sheets": sheets,
                },
                ensure_ascii=False,
                indent=2,
            ),
        }
    except Exception as e:
        return {"error": f"Excel parse error: {e}"}


def _detect_and_extract(url: str) -> dict:
    """Fetch URL and extract content based on detected file type."""
    content, content_type, final_url = _fetch_url(url)
    content_hash = hashlib.sha256(content).hexdigest()[:16]
    
    # Detect file type
    lower_url = url.lower()
    if "pdf" in content_type or lower_url.endswith(".pdf"):
        file_type = "pdf"
        extracted = _extract_pdf(content, final_url)
    elif "csv" in content_type or lower_url.endswith(".csv"):
        file_type = "csv"
        extracted = _extract_csv(content, final_url)
    elif "spreadsheet" in content_type or "excel" in content_type or lower_url.endswith((".xlsx", ".xls")):
        file_type = "excel"
        extracted = _extract_excel(content, final_url)
    else:
        file_type = "html"
        extracted = _extract_html(content, final_url)
    
    extracted["url"] = final_url
    extracted["file_type"] = file_type
    extracted["content_type"] = content_type
    extracted["content_hash"] = content_hash
    extracted["content_size_bytes"] = len(content)
    extracted["fetched_at"] = datetime.now().isoformat()
    extracted["normalized_text"] = _normalize_search_text(
        extracted.get("text")
        or json.dumps(extracted, ensure_ascii=False, indent=2, default=str)
    )
    
    return extracted


def _normalize_search_text(text: str) -> str:
    text = text or ""
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _split_long_text(text: str, max_chars: int = CHUNK_MAX_CHARS, overlap_chars: int = CHUNK_OVERLAP_CHARS) -> list[str]:
    normalized = _normalize_search_text(text)
    if not normalized:
        return []

    chunks: list[str] = []
    start = 0
    while start < len(normalized):
        end = min(len(normalized), start + max_chars)
        chunk = normalized[start:end].strip()
        if chunk:
            chunks.append(chunk)
        if end >= len(normalized):
            break
        start = max(0, end - overlap_chars)
    return chunks


def _chunk_paragraph_text(text: str) -> list[str]:
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", _normalize_search_text(text)) if p.strip()]
    if not paragraphs:
        return _split_long_text(text)

    chunks: list[str] = []
    current = ""

    for paragraph in paragraphs:
        if len(paragraph) > CHUNK_MAX_CHARS:
            if len(current) >= MIN_CHUNK_CHARS:
                chunks.append(current)
                current = current[-CHUNK_OVERLAP_CHARS :].strip() if CHUNK_OVERLAP_CHARS else ""
            for split_chunk in _split_long_text(paragraph):
                if len(split_chunk) >= MIN_CHUNK_CHARS:
                    chunks.append(split_chunk)
            continue

        candidate = paragraph if not current else f"{current}\n\n{paragraph}"
        if len(candidate) <= CHUNK_MAX_CHARS:
            current = candidate
            if len(current) < CHUNK_TARGET_CHARS:
                continue
        else:
            if len(current) >= MIN_CHUNK_CHARS:
                chunks.append(current)
                overlap = current[-CHUNK_OVERLAP_CHARS :].strip() if CHUNK_OVERLAP_CHARS else ""
                current = f"{overlap}\n\n{paragraph}".strip() if overlap else paragraph
            else:
                current = paragraph

        if len(current) >= CHUNK_TARGET_CHARS:
            chunks.append(current)
            current = current[-CHUNK_OVERLAP_CHARS :].strip() if CHUNK_OVERLAP_CHARS else ""

    if len(current) >= MIN_CHUNK_CHARS:
        chunks.append(current)

    if not chunks:
        return _split_long_text(text)
    return chunks


def _build_document_chunks(normalized_text: str, file_type: str) -> list[dict[str, Any]]:
    chunks: list[dict[str, Any]] = []
    chunk_index = 0

    if file_type == "pdf":
        parts = PDF_PAGE_MARKER_RE.split(normalized_text)
        if len(parts) > 1:
            for i in range(1, len(parts), 2):
                page_number = int(parts[i])
                page_text = parts[i + 1]
                for piece in _chunk_paragraph_text(page_text):
                    chunks.append({
                        "chunk_index": chunk_index,
                        "page_number": page_number,
                        "content": piece,
                    })
                    chunk_index += 1
            return chunks

    for piece in _chunk_paragraph_text(normalized_text):
        chunks.append({
            "chunk_index": chunk_index,
            "page_number": None,
            "content": piece,
        })
        chunk_index += 1

    return chunks


def _pack_embedding(values: list[float]) -> bytes:
    packed = array("f", values)
    if sys.byteorder != "little":
        packed.byteswap()
    return packed.tobytes()


def _unpack_embedding(blob: bytes) -> list[float]:
    unpacked = array("f")
    unpacked.frombytes(blob)
    if sys.byteorder != "little":
        unpacked.byteswap()
    return unpacked.tolist()


def _cosine_similarity(left: list[float], right: list[float]) -> float:
    if not left or not right or len(left) != len(right):
        return 0.0
    dot = sum(a * b for a, b in zip(left, right))
    left_norm = math.sqrt(sum(a * a for a in left))
    right_norm = math.sqrt(sum(b * b for b in right))
    if left_norm == 0 or right_norm == 0:
        return 0.0
    return dot / (left_norm * right_norm)


def _format_query_for_embedding(query: str) -> str:
    query = query.strip()
    if not query:
        return query
    if not EMBEDDING_QUERY_TASK:
        return query
    return f"Instruct: {EMBEDDING_QUERY_TASK}\nQuery: {query}"


def _parse_version_prefix(version_text: str) -> tuple[int, int, int]:
    parts = [int(part) for part in re.findall(r"\d+", version_text)[:3]]
    while len(parts) < 3:
        parts.append(0)
    return tuple(parts[:3])  # type: ignore[return-value]


def _resolve_embedding_model_source() -> str:
    if EMBEDDING_MODEL_PATH:
        model_path = os.path.expanduser(EMBEDDING_MODEL_PATH)
        if not os.path.exists(model_path):
            raise RuntimeError(f"EMBEDDING_MODEL_PATH not found: {model_path}")
        return model_path
    return EMBEDDING_MODEL


def _select_embedding_device(torch_module: Any) -> str:
    if EMBEDDING_DEVICE and EMBEDDING_DEVICE != "auto":
        return EMBEDDING_DEVICE
    if getattr(torch_module, "cuda", None) and torch_module.cuda.is_available():
        return "cuda"
    mps_backend = getattr(getattr(torch_module, "backends", None), "mps", None)
    if mps_backend and mps_backend.is_available():
        return "mps"
    return "cpu"


def _last_token_pool(last_hidden_states: Any, attention_mask: Any, torch_module: Any) -> Any:
    left_padding = bool((attention_mask[:, -1].sum() == attention_mask.shape[0]).item())
    if left_padding:
        return last_hidden_states[:, -1]
    sequence_lengths = attention_mask.sum(dim=1) - 1
    batch_size = last_hidden_states.shape[0]
    batch_indexes = torch_module.arange(batch_size, device=last_hidden_states.device)
    return last_hidden_states[batch_indexes, sequence_lengths]


def _get_transformers_local_runtime() -> dict[str, Any]:
    global _LOCAL_EMBEDDING_RUNTIME
    if _LOCAL_EMBEDDING_RUNTIME is not None:
        return _LOCAL_EMBEDDING_RUNTIME

    try:
        import torch
        import torch.nn.functional as torch_functional
        import transformers
        from transformers import AutoModel, AutoTokenizer
    except ImportError as exc:
        raise RuntimeError(
            "transformers_local requires torch and transformers>=4.51.0"
        ) from exc

    version = getattr(transformers, "__version__", "0.0.0")
    if _parse_version_prefix(version) < (4, 51, 0):
        raise RuntimeError(
            f"transformers_local requires transformers>=4.51.0; current version is {version}"
        )

    model_source = _resolve_embedding_model_source()
    local_files_only = bool(EMBEDDING_MODEL_PATH)
    tokenizer = AutoTokenizer.from_pretrained(
        model_source,
        padding_side="left",
        local_files_only=local_files_only,
    )
    model = AutoModel.from_pretrained(
        model_source,
        local_files_only=local_files_only,
    )
    device = _select_embedding_device(torch)
    model.to(device)
    model.eval()

    _LOCAL_EMBEDDING_RUNTIME = {
        "torch": torch,
        "torch_functional": torch_functional,
        "tokenizer": tokenizer,
        "model": model,
        "device": device,
        "model_source": model_source,
    }
    return _LOCAL_EMBEDDING_RUNTIME


def _embed_texts_tei_local(texts: list[str], input_kind: str) -> list[list[float]]:
    if not httpx:
        raise RuntimeError("httpx not installed. Run: pip install httpx")

    payload_inputs = [
        _format_query_for_embedding(text) if input_kind == "query" else text
        for text in texts
    ]
    response = httpx.post(
        f"{EMBEDDING_ENDPOINT}/embed",
        json={"inputs": payload_inputs},
        timeout=EMBEDDING_TIMEOUT_SECONDS,
    )
    response.raise_for_status()
    data = response.json()

    if isinstance(data, dict):
        if "data" in data:
            embeddings = [item["embedding"] for item in data["data"]]
        elif "embeddings" in data:
            embeddings = data["embeddings"]
        else:
            raise RuntimeError("Unexpected embedding response format")
    elif isinstance(data, list):
        if data and isinstance(data[0], dict):
            embeddings = [item["embedding"] for item in data]
        else:
            embeddings = data
    else:
        raise RuntimeError("Unexpected embedding response type")

    return [list(map(float, embedding)) for embedding in embeddings]


def _embed_texts_transformers_local(texts: list[str], input_kind: str) -> list[list[float]]:
    runtime = _get_transformers_local_runtime()
    torch = runtime["torch"]
    torch_functional = runtime["torch_functional"]
    tokenizer = runtime["tokenizer"]
    model = runtime["model"]
    device = runtime["device"]

    payload_inputs = [
        _format_query_for_embedding(text) if input_kind == "query" else text
        for text in texts
    ]
    embeddings: list[list[float]] = []
    batch_size = max(1, EMBEDDING_BATCH_SIZE)

    for offset in range(0, len(payload_inputs), batch_size):
        batch_inputs = payload_inputs[offset : offset + batch_size]
        batch_dict = tokenizer(
            batch_inputs,
            padding=True,
            truncation=True,
            max_length=EMBEDDING_MAX_LENGTH,
            return_tensors="pt",
        )
        batch_dict = batch_dict.to(device)

        with torch.inference_mode():
            outputs = model(**batch_dict)
            pooled = _last_token_pool(outputs.last_hidden_state, batch_dict["attention_mask"], torch)
            normalized = torch_functional.normalize(pooled, p=2, dim=1)
            embeddings.extend(normalized.detach().cpu().to(torch.float32).tolist())

    return [list(map(float, embedding)) for embedding in embeddings]


def _embed_texts(texts: list[str], input_kind: str) -> list[list[float]]:
    if not texts:
        return []
    if EMBEDDING_PROVIDER == "tei_local":
        return _embed_texts_tei_local(texts, input_kind)
    if EMBEDDING_PROVIDER == "transformers_local":
        return _embed_texts_transformers_local(texts, input_kind)
    raise RuntimeError(f"Unsupported embedding provider: {EMBEDDING_PROVIDER}")


def _truncate_result_text(result: dict, max_text_length: int) -> dict:
    response = dict(result)
    text = response.get("text", "")
    if text and len(text) > max_text_length:
        response["text"] = text[:max_text_length] + "\n\n[... truncated ...]"
    normalized_text = response.get("normalized_text", "")
    if normalized_text and len(normalized_text) > max_text_length:
        response["normalized_text"] = normalized_text[:max_text_length] + "\n\n[... truncated ...]"
    return response


def _reindex_document(
    conn: sqlite3.Connection,
    source_url: str,
    result: dict,
    replace_existing: bool = False,
) -> dict[str, Any]:
    normalized_text = result.get("normalized_text", "")
    existing_document = None
    if not replace_existing and result.get("content_hash"):
        existing_document = conn.execute(
            """SELECT d.id, COUNT(c.id) AS chunk_count
               FROM crawl_documents d
               LEFT JOIN document_chunks c ON c.document_id = d.id
               WHERE d.source_url = ? AND d.content_hash = ?
               GROUP BY d.id
               ORDER BY d.downloaded_at DESC, d.id DESC
               LIMIT 1""",
            (source_url, result["content_hash"]),
        ).fetchone()
        if existing_document and existing_document["chunk_count"] > 0:
            return {
                "document_id": existing_document["id"],
                "deleted_documents": 0,
                "chunk_count": existing_document["chunk_count"],
                "reused_existing": True,
            }

    if replace_existing:
        deleted_documents = conn.execute(
            "SELECT COUNT(*) FROM crawl_documents WHERE source_url = ?",
            (source_url,),
        ).fetchone()[0]
        conn.execute("DELETE FROM crawl_documents WHERE source_url = ?", (source_url,))
    else:
        deleted_documents = 0

    cursor = conn.execute(
        """INSERT INTO crawl_documents
           (source_url, file_name, mime_type, content_hash, content_preview, normalized_text, document_kind, downloaded_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            source_url,
            result.get("title", source_url),
            result.get("content_type"),
            result.get("content_hash"),
            normalized_text[:500],
            normalized_text,
            result.get("file_type"),
            datetime.now().isoformat(),
        ),
    )
    document_id = cursor.lastrowid

    chunks = _build_document_chunks(normalized_text, result.get("file_type", "html"))
    for chunk in chunks:
        conn.execute(
            """INSERT INTO document_chunks (document_id, chunk_index, page_number, content)
               VALUES (?, ?, ?, ?)""",
            (document_id, chunk["chunk_index"], chunk["page_number"], chunk["content"]),
        )
    conn.commit()

    return {
        "document_id": document_id,
        "deleted_documents": deleted_documents,
        "chunk_count": len(chunks),
        "reused_existing": False,
    }


def _index_embeddings_for_document(
    conn: sqlite3.Connection,
    document_id: int,
    force: bool = False,
) -> dict[str, Any]:
    rows = rows_to_dicts(conn.execute(
        """SELECT c.id AS chunk_id, c.content, e.content_hash, e.model_name
           FROM document_chunks c
           LEFT JOIN chunk_embeddings e ON e.chunk_id = c.id
           WHERE c.document_id = ?
           ORDER BY c.chunk_index""",
        (document_id,),
    ).fetchall())

    to_embed: list[dict[str, Any]] = []
    for row in rows:
        content_hash = hashlib.sha256(row["content"].encode("utf-8")).hexdigest()
        is_stale = (
            force
            or row.get("content_hash") != content_hash
            or row.get("model_name") != EMBEDDING_MODEL
        )
        if is_stale:
            to_embed.append({
                "chunk_id": row["chunk_id"],
                "content": row["content"],
                "content_hash": content_hash,
            })

    if not to_embed:
        return {
            "status": "up_to_date",
            "document_id": document_id,
            "indexed_chunks": 0,
            "total_chunks": len(rows),
            "model_name": EMBEDDING_MODEL,
            "provider": EMBEDDING_PROVIDER,
        }

    batch_size = 16
    indexed_count = 0
    for offset in range(0, len(to_embed), batch_size):
        batch = to_embed[offset : offset + batch_size]
        vectors = _embed_texts([row["content"] for row in batch], input_kind="document")
        for row, vector in zip(batch, vectors):
            if EMBEDDING_DIM and len(vector) != EMBEDDING_DIM:
                raise RuntimeError(
                    f"Embedding dimension mismatch: expected {EMBEDDING_DIM}, got {len(vector)}"
                )
            conn.execute(
                """INSERT INTO chunk_embeddings
                   (chunk_id, model_name, embedding_dim, embedding_blob, content_hash, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT(chunk_id) DO UPDATE SET
                     model_name = excluded.model_name,
                     embedding_dim = excluded.embedding_dim,
                     embedding_blob = excluded.embedding_blob,
                     content_hash = excluded.content_hash,
                     updated_at = excluded.updated_at""",
                (
                    row["chunk_id"],
                    EMBEDDING_MODEL,
                    len(vector),
                    _pack_embedding(vector),
                    row["content_hash"],
                    datetime.now().isoformat(),
                    datetime.now().isoformat(),
                ),
            )
            indexed_count += 1
    conn.commit()

    return {
        "status": "indexed",
        "document_id": document_id,
        "indexed_chunks": indexed_count,
        "total_chunks": len(rows),
        "model_name": EMBEDDING_MODEL,
        "provider": EMBEDDING_PROVIDER,
    }


def _build_snippet(content: str, terms: list[str], max_chars: int = 300) -> str:
    normalized = _normalize_search_text(content)
    if not normalized:
        return ""

    lower_content = normalized.lower()
    positions = [lower_content.find(term.lower()) for term in terms if term]
    positions = [pos for pos in positions if pos >= 0]
    start = 0 if not positions else max(0, positions[0] - max_chars // 3)
    snippet = normalized[start : start + max_chars].strip()
    if start > 0:
        snippet = "..." + snippet
    if start + max_chars < len(normalized):
        snippet += "..."
    return snippet


def _build_result_dedupe_key(
    source_url: str,
    page_number: int | None,
    chunk_index: int,
    content: str,
) -> str:
    content_hash = hashlib.sha1(content.encode("utf-8")).hexdigest()[:16]
    return f"{source_url}|{page_number or ''}|{chunk_index}|{content_hash}"


def _is_better_ranked_result(candidate: dict[str, Any], existing: dict[str, Any]) -> bool:
    candidate_score = float(candidate.get("score", 0.0))
    existing_score = float(existing.get("score", 0.0))
    if candidate_score != existing_score:
        return candidate_score > existing_score
    return int(candidate.get("document_id", 0)) > int(existing.get("document_id", 0))


def _deduplicate_ranked_results(results: list[dict[str, Any]]) -> list[dict[str, Any]]:
    deduped: dict[str, dict[str, Any]] = {}
    for row in results:
        key = row["dedupe_key"]
        existing = deduped.get(key)
        if existing is None or _is_better_ranked_result(row, existing):
            deduped[key] = dict(row)
    return sorted(
        deduped.values(),
        key=lambda item: (float(item.get("score", 0.0)), int(item.get("document_id", 0))),
        reverse=True,
    )


def _finalize_ranked_results(results: list[dict[str, Any]], limit: int) -> list[dict[str, Any]]:
    finalized: list[dict[str, Any]] = []
    for row in results[:limit]:
        clean = dict(row)
        clean.pop("dedupe_key", None)
        finalized.append(clean)
    return finalized


def _trim_context_content(content: str, max_chars: int) -> str:
    normalized = _normalize_search_text(content)
    if max_chars <= 0 or len(normalized) <= max_chars:
        return normalized
    return normalized[:max_chars].rstrip() + "\n\n[... truncated ...]"


def _fetch_chunk_context_rows(conn: sqlite3.Connection, chunk_ids: list[int]) -> dict[int, dict[str, Any]]:
    if not chunk_ids:
        return {}
    placeholders = ",".join("?" for _ in chunk_ids)
    rows = rows_to_dicts(conn.execute(
        f"""
        SELECT c.id AS chunk_id, c.document_id, c.page_number, c.chunk_index, c.content,
               d.source_url, d.file_name
        FROM document_chunks c
        JOIN crawl_documents d ON d.id = c.document_id
        WHERE c.id IN ({placeholders})
        """,
        chunk_ids,
    ).fetchall())
    return {row["chunk_id"]: row for row in rows}


def _format_citation_label(row: dict[str, Any], index: int) -> str:
    page_suffix = f" p.{row['page_number']}" if row.get("page_number") else ""
    return f"[{index}] {row['file_name']}{page_suffix} chunk {row['chunk_index']}"


def _build_answer_prompt(query: str, context_text: str) -> str:
    return (
        "以下の context だけを根拠に日本語で回答してください。"
        "推測はしないでください。根拠が不足する場合は不足していると明記し、"
        "各文または各箇条書き項目の末尾に必ず [1] の形式で引用番号を付けてください。"
        "引用番号がない文を出力してはいけません。\n\n"
        f"質問:\n{query}\n\n"
        f"Context:\n{context_text}"
    )


def _build_citation_retry_prompt(query: str, context_text: str) -> str:
    return (
        "前回の回答は引用番号が欠けていたため無効です。"
        "以下の context だけを根拠に、日本語で回答を最初から生成し直してください。"
        "推測はしないでください。"
        "各文または各箇条書き項目の末尾に必ず [1] の形式で引用番号を付けてください。"
        "引用番号がない文を1つでも出力してはいけません。"
        "説明文や前置きは不要で、回答本文だけを返してください。\n\n"
        f"質問:\n{query}\n\n"
        f"Context:\n{context_text}"
    )


def _answer_has_citation_markers(answer_text: str) -> bool:
    return bool(re.search(r"\[\d+\]", answer_text or ""))


def _build_citation_suffix(citations: list[dict[str, Any]], limit: int = 2) -> str:
    suffix_parts: list[str] = []
    for citation in citations[:limit]:
        citation_id = str(citation.get("citation_id", "")).strip()
        if citation_id and citation_id not in suffix_parts:
            suffix_parts.append(citation_id)
    return "".join(suffix_parts)


def _append_citation_suffix(answer_text: str, citation_suffix: str) -> str:
    if not answer_text.strip() or not citation_suffix:
        return answer_text.strip()

    rebuilt_lines: list[str] = []
    for line in answer_text.splitlines():
        stripped = line.strip()
        if not stripped:
            rebuilt_lines.append("")
            continue
        if _answer_has_citation_markers(stripped):
            rebuilt_lines.append(stripped)
            continue

        sentence_parts = [part.strip() for part in re.findall(r"[^。！？!?]+[。！？!?]?", stripped) if part.strip()]
        if not sentence_parts:
            rebuilt_lines.append(f"{stripped}{citation_suffix}")
            continue
        rebuilt_lines.append("".join(
            part if _answer_has_citation_markers(part) else f"{part}{citation_suffix}"
            for part in sentence_parts
        ))
    return "\n".join(rebuilt_lines).strip()


def _split_answer_sentences(answer_text: str) -> list[str]:
    sentences: list[str] = []
    for line in answer_text.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        stripped = re.sub(r"^[\-*•]\s*", "", stripped)
        parts = [
            part.strip()
            for part in re.findall(r"[^。！？!?]+(?:[。！？!?](?:\[\d+\])*)?", stripped)
            if part.strip()
        ]
        if parts:
            sentences.extend(parts)
        else:
            sentences.append(stripped)
    return sentences


def _tokenize_fallback_focus_text(text: str) -> list[str]:
    normalized = re.sub(r"\[\d+\]", "", text or "")
    normalized = re.sub(
        r"(について|に関して|を教えてください|教えてください|要点を|要点|概要を|概要|説明して|説明)",
        " ",
        normalized,
    )
    normalized = re.sub(r"[、。,\n\r\t/（）()「」『』【】・:：]+", " ", normalized)
    normalized = re.sub(r"(の|に|は|を|が|で|と|や|へ|も|から|まで|より|など|ため|として|する|した)", " ", normalized)
    normalized = re.sub(r"\s+", " ", normalized).strip()

    tokens: list[str] = []
    for raw_token in normalized.split(" "):
        token = raw_token.strip()
        if len(token) < 2 or len(token) > 20:
            continue
        if token in FALLBACK_FOCUS_STOPWORDS:
            continue
        if "令和" in token or "年度" in token:
            continue
        if re.fullmatch(r"[+＋]?[0-9０-９.,．]+(兆円|億円|円|％|%)", token):
            continue
        if token.endswith(("しています", "されます", "できます", "なります")):
            continue
        if token.endswith("等"):
            continue
        if re.fullmatch(r"[ぁ-んァ-ンー]{2,4}", token):
            continue
        tokens.append(token)
    return tokens


def _detect_fallback_focus_themes(query: str) -> list[str]:
    active_themes: list[str] = []
    for theme_name, rule in FALLBACK_FOCUS_THEME_RULES.items():
        if any(trigger in query for trigger in rule["triggers"]):
            active_themes.append(theme_name)
    return active_themes


def _is_blacklisted_fallback_focus_term(token: str, active_themes: list[str] | None = None) -> bool:
    if token in FALLBACK_FOCUS_BLACKLIST:
        return True
    for theme_name in active_themes or []:
        rule = FALLBACK_FOCUS_THEME_RULES.get(theme_name)
        if rule and token in rule["blacklist"]:
            return True
    if token.endswith(("会計", "勘定")):
        return True
    if token.endswith("予算") and token != "予算":
        return True
    if re.search(r"(庁|省|府)予算$", token):
        return True
    return False


def _build_fallback_focus_terms(query: str, citations: list[dict[str, Any]] | None = None) -> dict[str, int]:
    weights: dict[str, int] = {}
    active_themes = _detect_fallback_focus_themes(query)
    for token in _tokenize_fallback_focus_text(query):
        if _is_blacklisted_fallback_focus_term(token, active_themes):
            continue
        weights[token] = max(weights.get(token, 0), 3)

    citation_counter: Counter[str] = Counter()
    for citation in (citations or [])[:3]:
        source_text = " ".join(
            part for part in [
                citation.get("file_name", ""),
                citation.get("snippet", ""),
                str(citation.get("content", ""))[:500],
            ] if part
        )
        citation_counter.update(_tokenize_fallback_focus_text(source_text))

    for token, count in citation_counter.most_common(12):
        if token in FALLBACK_FOCUS_STOPWORDS:
            continue
        if _is_blacklisted_fallback_focus_term(token, active_themes):
            continue
        if count < 2 and token not in query:
            continue
        weights[token] = max(weights.get(token, 0), 2 if count >= 2 else 1)

    return weights


def _score_citation_fallback_sentence(sentence: str, focus_terms: dict[str, int]) -> int:
    score = 0
    normalized = re.sub(r"\[\d+\]", "", sentence)

    if re.search(r"[0-9０-９]", normalized):
        score += 3
    if any(token in normalized for token in ["兆円", "億円", "%", "％"]):
        score += 3

    for term, weight in focus_terms.items():
        if term in normalized:
            score += weight

    for keyword in ["予算", "増", "減", "拡充", "支援", "処遇改善", "保育", "総額", "前年度比"]:
        if keyword in normalized:
            score += 1

    for generic_phrase in [
        "重要な施策",
        "社会の実現",
        "社会の構築",
        "構築に向けた",
        "健やかな成長",
        "質の高い施策",
    ]:
        if generic_phrase in normalized:
            score -= 2

    if normalized.startswith("これは"):
        score -= 1
    if len(normalized) > 140:
        score -= 1

    return score


def _summarize_fallback_focus_terms(focus_terms: dict[str, int], limit: int = 8) -> list[dict[str, Any]]:
    ranked_terms = sorted(focus_terms.items(), key=lambda item: (-item[1], item[0]))
    return [
        {"term": term, "weight": weight}
        for term, weight in ranked_terms[:limit]
    ]


def _is_amount_line(text: str) -> bool:
    return bool(re.fullmatch(r"[+＋]?[0-9０-９.,，．]+(?:兆円|億円|百万円|万円|円|％|%)?(?:（[^）]+）)?", text.strip()))


def _extract_citation_fallback_candidates(citation: dict[str, Any]) -> list[str]:
    candidates: list[str] = []
    citation_id = str(citation.get("citation_id", "")).strip()
    lines = [
        re.sub(r"\s+", " ", line).strip()
        for line in str(citation.get("content", "")).splitlines()
    ]

    for index, line in enumerate(lines):
        if not line or line in {"-", "・", "•"}:
            continue
        candidate = line
        if _is_amount_line(line):
            title_line = ""
            for next_line in lines[index + 1 : index + 4]:
                if not next_line or _is_amount_line(next_line):
                    continue
                if len(next_line) < 6:
                    continue
                if any(label in next_line for label in {"長官官房", "参事官", "担当", "室"}):
                    continue
                title_line = next_line
                break
            if title_line:
                candidate = f"{title_line} {line}"
        if index + 1 < len(lines):
            next_line = lines[index + 1]
            if _is_amount_line(next_line):
                candidate = f"{candidate} {next_line}"
        if citation_id and citation_id not in candidate:
            candidate = f"{candidate}{citation_id}"
        candidates.append(candidate)

    return candidates


def _format_citation_fallback_answer(
    answer_text: str,
    max_sentences: int,
    query: str,
    citations: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    candidates: list[dict[str, Any]] = []
    seen_keys: set[str] = set()
    active_themes = _detect_fallback_focus_themes(query)
    focus_terms = _build_fallback_focus_terms(query, citations)

    for index, sentence in enumerate(_split_answer_sentences(answer_text)):
        normalized = re.sub(r"\s+", " ", sentence).strip()
        if not normalized:
            continue
        dedupe_key = re.sub(r"\[\d+\]", "", normalized)
        dedupe_key = re.sub(r"\s+", " ", dedupe_key).strip()
        if not dedupe_key or dedupe_key in seen_keys:
            continue
        seen_keys.add(dedupe_key)
        candidates.append({
            "index": index,
            "text": normalized,
            "score": _score_citation_fallback_sentence(normalized, focus_terms),
        })

    for citation_index, citation in enumerate(citations or [], start=1):
        for line_index, sentence in enumerate(_extract_citation_fallback_candidates(citation), start=1):
            normalized = re.sub(r"\s+", " ", sentence).strip()
            if not normalized:
                continue
            dedupe_key = re.sub(r"\[\d+\]", "", normalized)
            dedupe_key = re.sub(r"\s+", " ", dedupe_key).strip()
            if not dedupe_key or dedupe_key in seen_keys:
                continue
            high_weight_hits = sum(
                1 for term, weight in focus_terms.items()
                if weight >= 3 and term in normalized
            )
            amount_hit = bool(re.search(r"[0-9０-９][0-9０-９.,，．]*(兆円|億円|百万円|万円|円|％|%)", normalized))
            if not high_weight_hits and not amount_hit:
                continue
            seen_keys.add(dedupe_key)
            citation_bonus = 2
            if high_weight_hits:
                citation_bonus += 2
            if amount_hit:
                citation_bonus += 3
            candidates.append({
                "index": 1000 + (citation_index * 100) + line_index,
                "text": normalized,
                "score": _score_citation_fallback_sentence(normalized, focus_terms) + citation_bonus,
            })

    if not candidates:
        return {
            "answer": answer_text.strip(),
            "focus_terms": _summarize_fallback_focus_terms(focus_terms),
            "selected_count": 0,
            "themes": active_themes,
        }

    positive_candidates = [candidate for candidate in candidates if candidate["score"] > 0]
    selected_pool = positive_candidates if positive_candidates else candidates
    selected = sorted(selected_pool, key=lambda item: (-item["score"], item["index"]))[:max_sentences]
    selected = sorted(selected, key=lambda item: item["index"])
    return {
        "answer": "\n".join(f"- {item['text']}" for item in selected).strip() or answer_text.strip(),
        "focus_terms": _summarize_fallback_focus_terms(focus_terms),
        "selected_count": len(selected),
        "themes": active_themes,
    }


def _extract_search_phrase(query: str) -> str:
    phrase = re.sub(
        r"(について|に関して|を教えてください|教えてください|要点を|要点|概要を|概要|説明して|説明)",
        " ",
        query or "",
    )
    phrase = re.sub(r"[？?\n\r\t]+", " ", phrase)
    phrase = re.sub(r"\s+", " ", phrase).strip()
    return phrase


def _expand_search_term_variants(token: str) -> dict[str, int]:
    variants: dict[str, int] = {token: 4}

    trimmed = token[:-1] if token.endswith("等") and len(token) > 2 else token
    if trimmed != token and len(trimmed) >= 2:
        variants[trimmed] = max(variants.get(trimmed, 0), 3)

    if token.endswith("費") and len(token) > 2:
        stem = token[:-1]
        if len(stem) >= 2 and stem not in FALLBACK_FOCUS_STOPWORDS:
            variants[stem] = max(variants.get(stem, 0), 3)

    for suffix in SEARCH_TERM_COMPONENT_SUFFIXES:
        if not token.endswith(suffix):
            continue
        stem = token[:-len(suffix)]
        if len(stem) >= 2 and stem not in FALLBACK_FOCUS_STOPWORDS:
            variants[stem] = max(variants.get(stem, 0), 3)
        variants[suffix] = max(variants.get(suffix, 0), 2)

    return variants


def _build_search_term_weights(query: str) -> dict[str, int]:
    weights: dict[str, int] = {}
    active_themes = _detect_fallback_focus_themes(query)

    for token in _tokenize_fallback_focus_text(query):
        if _is_blacklisted_fallback_focus_term(token, active_themes):
            continue
        for term, weight in _expand_search_term_variants(token).items():
            if len(term) < 2 or term in FALLBACK_FOCUS_STOPWORDS:
                continue
            weights[term] = max(weights.get(term, 0), weight)

    phrase = _extract_search_phrase(query)
    if 2 <= len(phrase) <= 24:
        weights[phrase] = max(weights.get(phrase, 0), 5)

    return dict(sorted(weights.items(), key=lambda item: (-item[1], -len(item[0]), item[0])))


def _score_lexical_match(
    content: str,
    query: str,
    term_weights: dict[str, int],
) -> tuple[float, list[str]]:
    normalized = _normalize_search_text(content)
    lower_content = normalized.lower()
    matched_terms: list[str] = []
    score = 0.0

    for term, weight in term_weights.items():
        count = lower_content.count(term.lower())
        if count <= 0:
            continue
        matched_terms.append(term)
        score += float(weight)
        if count > 1:
            score += float(weight * 0.5)

    strong_match_count = sum(1 for term in matched_terms if term_weights.get(term, 0) >= 4)
    if len(matched_terms) >= 3:
        score += 6.0
    elif len(matched_terms) == 2:
        score += 3.0
    elif len(matched_terms) == 1:
        score -= 2.0

    if strong_match_count >= 2:
        score += 4.0
    elif strong_match_count == 1 and len(matched_terms) >= 2:
        score += 2.0

    phrase = _extract_search_phrase(query)
    if phrase and phrase.lower() in lower_content:
        score += 6.0

    if matched_terms and re.search(r"[0-9０-９][0-9０-９.,，．]*(兆円|億円|百万円|万円|円|％|%)", normalized):
        if any(anchor in term_weights for anchor in {"予算", "負担軽減", "軽減", "拡充", "無償化"}):
            score += 3.0

    if matched_terms and any(marker in normalized for marker in {"全体像", "概要", "主な増要因", "主なポイント"}):
        score += 1.5

    first_window = normalized[:240]
    early_match_count = sum(1 for term in matched_terms if term in first_window)
    if early_match_count >= 2:
        score += 2.5
    if matched_terms and re.search(r"[0-9０-９][0-9０-９.,，．]*(兆円|億円|百万円|万円|円|％|%)", first_window):
        score += 2.5

    top_lines = [line.strip() for line in content.splitlines() if line.strip()][:6]
    if matched_terms and any(_is_amount_line(line) for line in top_lines):
        score += 4.0
    if sum(1 for line in top_lines if any(term in line for term in matched_terms)) >= 2:
        score += 2.0

    if "予算" in term_weights and normalized.count("内数") >= 2:
        score -= 4.0

    score -= min(3.0, len(normalized) / 1500.0)

    return score, matched_terms


def _extract_openai_compatible_content(content: Any) -> str:
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict):
                text = item.get("text")
                if text:
                    parts.append(str(text))
        return "\n".join(part.strip() for part in parts if part).strip()
    return ""


def _generate_answer_with_llm(
    prompt: str,
    provider_override: str | None = None,
    model_override: str | None = None,
    temperature: float | None = None,
    max_output_tokens: int | None = None,
) -> dict[str, Any]:
    provider = (provider_override or ANSWER_LLM_PROVIDER or "none").strip().lower()
    model = (model_override or ANSWER_LLM_MODEL).strip()
    temperature_value = ANSWER_LLM_TEMPERATURE if temperature is None else float(temperature)
    max_tokens_value = ANSWER_LLM_MAX_OUTPUT_TOKENS if max_output_tokens is None else int(max_output_tokens)

    if provider in {"", "none"}:
        return {
            "status": "skipped",
            "reason": "ANSWER_LLM_PROVIDER is not configured",
        }
    if not httpx:
        raise RuntimeError(f"httpx unavailable: {HTTPX_IMPORT_ERROR or 'not installed'}")
    if not model:
        return {
            "status": "skipped",
            "reason": "ANSWER_LLM_MODEL is not configured",
            "provider": provider,
        }

    if provider == "ollama":
        response = httpx.post(
            f"{ANSWER_LLM_API_BASE}/api/chat",
            json={
                "model": model,
                "messages": [{"role": "user", "content": prompt}],
                "stream": False,
                "options": {
                    "temperature": temperature_value,
                    "num_predict": max_tokens_value,
                },
            },
            timeout=ANSWER_LLM_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        data = response.json()
        answer_text = str(data.get("message", {}).get("content", "")).strip()
        if not answer_text:
            raise RuntimeError("Ollama response did not contain message.content")
        return {
            "status": "generated",
            "provider": provider,
            "model": model,
            "answer": answer_text,
            "raw_response": {
                "eval_count": data.get("eval_count"),
                "prompt_eval_count": data.get("prompt_eval_count"),
                "done": data.get("done"),
            },
        }

    if provider == "openai_compatible":
        headers = {"Content-Type": "application/json"}
        if ANSWER_LLM_API_KEY:
            headers["Authorization"] = f"Bearer {ANSWER_LLM_API_KEY}"
        response = httpx.post(
            f"{ANSWER_LLM_API_BASE}/chat/completions",
            headers=headers,
            json={
                "model": model,
                "messages": [{"role": "user", "content": prompt}],
                "temperature": temperature_value,
                "max_tokens": max_tokens_value,
            },
            timeout=ANSWER_LLM_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        data = response.json()
        choice = (data.get("choices") or [{}])[0]
        message = choice.get("message", {})
        answer_text = _extract_openai_compatible_content(message.get("content"))
        if not answer_text:
            raise RuntimeError("OpenAI-compatible response did not contain message content")
        return {
            "status": "generated",
            "provider": provider,
            "model": model,
            "answer": answer_text,
            "raw_response": {
                "finish_reason": choice.get("finish_reason"),
                "usage": data.get("usage"),
            },
        }

    raise RuntimeError(f"Unsupported answer provider: {provider}")


def _run_lexical_search(
    conn: sqlite3.Connection,
    query: str,
    limit: int,
    document_id: int | None = None,
) -> list[dict[str, Any]]:
    term_weights = _build_search_term_weights(query)
    terms = list(term_weights.keys())
    if not term_weights:
        return []

    lexical_conditions = ["c.content LIKE ?" for _ in terms]
    params: list[Any] = [f"%{term}%" for term in terms]
    where_clauses = [f"({' OR '.join(lexical_conditions)})"]
    if document_id is not None:
        where_clauses.append("c.document_id = ?")
        params.append(document_id)
    params.append(max(limit, LEXICAL_TOP_K) * 8)

    sql = f"""
        SELECT c.id AS chunk_id, c.document_id, c.page_number, c.chunk_index, c.content,
               d.source_url, d.file_name
        FROM document_chunks c
        JOIN crawl_documents d ON d.id = c.document_id
        WHERE {' AND '.join(where_clauses)}
        LIMIT ?
    """
    rows = rows_to_dicts(conn.execute(sql, params).fetchall())
    ranked: list[dict[str, Any]] = []
    for row in rows:
        content = row["content"]
        score, matched_terms = _score_lexical_match(content, query, term_weights)
        if row.get("page_number") is None:
            score -= 4.0
        if score <= 0:
            continue
        ranked.append({
            "chunk_id": row["chunk_id"],
            "document_id": row["document_id"],
            "source_url": row["source_url"],
            "file_name": row["file_name"],
            "page_number": row["page_number"],
            "chunk_index": row["chunk_index"],
            "score": score,
            "retrieval_mode": "lexical",
            "snippet": _build_snippet(content, terms),
            "matched_terms": matched_terms,
            "dedupe_key": _build_result_dedupe_key(
                row["source_url"],
                row["page_number"],
                row["chunk_index"],
                content,
            ),
        })
    ranked.sort(key=lambda item: item["score"], reverse=True)
    return ranked[:limit]


def _run_semantic_search(
    conn: sqlite3.Connection,
    query: str,
    limit: int,
    document_id: int | None = None,
) -> list[dict[str, Any]]:
    snippet_terms = list(_build_search_term_weights(query).keys())
    query_embedding = _embed_texts([query], input_kind="query")[0]

    sql = """
        SELECT c.id AS chunk_id, c.document_id, c.page_number, c.chunk_index, c.content,
               d.source_url, d.file_name, e.embedding_blob, e.embedding_dim
        FROM chunk_embeddings e
        JOIN document_chunks c ON c.id = e.chunk_id
        JOIN crawl_documents d ON d.id = c.document_id
        WHERE e.model_name = ?
    """
    params: list[Any] = [EMBEDDING_MODEL]
    if document_id is not None:
        sql += " AND c.document_id = ?"
        params.append(document_id)

    rows = rows_to_dicts(conn.execute(sql, params).fetchall())
    ranked: list[dict[str, Any]] = []
    for row in rows:
        vector = _unpack_embedding(row["embedding_blob"])
        if row.get("embedding_dim") and len(vector) != row["embedding_dim"]:
            continue
        score = _cosine_similarity(query_embedding, vector)
        ranked.append({
            "chunk_id": row["chunk_id"],
            "document_id": row["document_id"],
            "source_url": row["source_url"],
            "file_name": row["file_name"],
            "page_number": row["page_number"],
            "chunk_index": row["chunk_index"],
            "score": score,
            "retrieval_mode": "semantic",
            "snippet": _build_snippet(row["content"], snippet_terms),
            "dedupe_key": _build_result_dedupe_key(
                row["source_url"],
                row["page_number"],
                row["chunk_index"],
                row["content"],
            ),
        })
    ranked.sort(key=lambda item: item["score"], reverse=True)
    return ranked[:limit]


def _fuse_search_results(
    lexical_results: list[dict[str, Any]],
    semantic_results: list[dict[str, Any]],
    limit: int,
) -> list[dict[str, Any]]:
    combined: dict[str, dict[str, Any]] = {}

    for rank, row in enumerate(lexical_results, start=1):
        entry = combined.setdefault(row["dedupe_key"], dict(row))
        if _is_better_ranked_result(row, entry):
            accumulated_score = entry.get("score", 0.0)
            entry.update(row)
            entry["score"] = accumulated_score
        entry["score"] = entry.get("score", 0.0) + 1.0 / (RRF_K + rank)
        entry["retrieval_mode"] = "hybrid"

    for rank, row in enumerate(semantic_results, start=1):
        entry = combined.setdefault(row["dedupe_key"], dict(row))
        if _is_better_ranked_result(row, entry):
            accumulated_score = entry.get("score", 0.0)
            entry.update(row)
            entry["score"] = accumulated_score
        entry["score"] = entry.get("score", 0.0) + 1.0 / (RRF_K + rank)
        entry["retrieval_mode"] = "hybrid"

    ranked = sorted(combined.values(), key=lambda item: item["score"], reverse=True)
    for row in ranked:
        row["score"] = round(row["score"], 6)
    return ranked[:limit]


# ─── MCP Server ───

server = Server("money-flow")


@server.list_tools()
async def list_tools() -> list[Tool]:
    return [
        # ── Data Management ──
        Tool(
            name="list_sources",
            description="日本政府のオープンデータソース一覧を表示。省庁コード、URL、形式、優先度、最終クロール日時を含む。",
            inputSchema={
                "type": "object",
                "properties": {
                    "priority": {"type": "string", "enum": ["critical", "high", "medium", "all"], "description": "優先度でフィルタ (default: all)"},
                    "agency_code": {"type": "string", "description": "省庁コードでフィルタ (例: MIN_CFA, MIN_MHLW)"}
                }
            }
        ),
        Tool(
            name="register_source_candidate",
            description="検索や手動調査で見つけた候補 URL を source_candidates に登録または更新する。",
            inputSchema={
                "type": "object",
                "properties": {
                    "candidate_url": {"type": "string", "description": "候補 URL"},
                    "title": {"type": "string", "description": "候補タイトル"},
                    "publisher": {"type": "string", "description": "発行主体"},
                    "file_type": {"type": "string", "description": "pdf/html などの想定ファイル種別"},
                    "discovered_by": {"type": "string", "description": "manual / search_engine / llm などの発見元"},
                    "discovery_query": {"type": "string", "description": "候補を見つけた検索クエリ"},
                    "llm_classification": {"type": "string", "description": "primary_official_document などの LLM 分類"},
                    "llm_confidence": {"type": "number", "description": "LLM 判定信頼度 0.0-1.0"},
                    "is_primary_source": {"type": "boolean", "description": "一次資料か"},
                    "is_official_site": {"type": "boolean", "description": "公式サイトか"},
                    "is_stable_url": {"type": "boolean", "description": "安定した URL か"},
                    "review_status": {"type": "string", "enum": ["pending", "approved", "rejected", "blocked"], "description": "review 状態"},
                    "review_note": {"type": "string", "description": "review メモ"}
                },
                "required": ["candidate_url", "discovered_by"]
            }
        ),
        Tool(
            name="list_source_candidates",
            description="source_candidates に登録された候補 URL を一覧表示する。",
            inputSchema={
                "type": "object",
                "properties": {
                    "domain": {"type": "string", "description": "ドメインでフィルタ"},
                    "review_status": {"type": "string", "enum": ["pending", "approved", "rejected", "blocked", "all"], "description": "review 状態でフィルタ"},
                    "llm_classification": {"type": "string", "description": "LLM 分類でフィルタ"},
                    "discovered_by": {"type": "string", "description": "発見元でフィルタ"},
                    "query": {"type": "string", "description": "title / publisher / URL の検索"},
                    "limit": {"type": "integer", "description": "最大件数 (default: 50)"}
                }
            }
        ),
        Tool(
            name="review_source_candidates_report",
            description="pending source_candidates の review 用レポートを生成し、推奨 tier と推奨 policy を返す。",
            inputSchema={
                "type": "object",
                "properties": {
                    "review_status": {"type": "string", "enum": ["pending", "approved", "rejected", "blocked", "all"], "description": "対象 review 状態 (default: pending)"},
                    "domain": {"type": "string", "description": "ドメインでフィルタ"},
                    "discovered_by": {"type": "string", "description": "発見元でフィルタ"},
                    "query": {"type": "string", "description": "title / publisher / URL の検索"},
                    "limit": {"type": "integer", "description": "最大件数 (default: 50)"},
                    "include_markdown": {"type": "boolean", "description": "Markdown レポート文字列を含めるか"}
                }
            }
        ),
        Tool(
            name="bulk_review_source_candidates",
            description="review_source_candidates_report の推奨 action をまとめて適用する。既定では dry_run。",
            inputSchema={
                "type": "object",
                "properties": {
                    "review_status": {"type": "string", "enum": ["pending", "approved", "rejected", "blocked", "all"], "description": "対象 review 状態 (default: pending)"},
                    "domain": {"type": "string", "description": "ドメインでフィルタ"},
                    "discovered_by": {"type": "string", "description": "発見元でフィルタ"},
                    "query": {"type": "string", "description": "title / publisher / URL の検索"},
                    "limit": {"type": "integer", "description": "最大件数 (default: 50)"},
                    "candidate_ids": {"type": "array", "items": {"type": "integer"}, "description": "対象 candidate_id の限定リスト"},
                    "recommendation_filter": {
                        "type": "array",
                        "items": {
                            "type": "string",
                            "enum": ["approve_tier_a_auto", "approve_tier_b_review", "manual_review", "block_tier_c", "already_covered"]
                        },
                        "description": "適用対象 recommendation。未指定時は manual_review を除く"
                    },
                    "mark_already_covered": {"type": "boolean", "description": "already_covered を review 完了扱いにするか"},
                    "owner_note": {"type": "string", "description": "一括処理時の owner note"},
                    "dry_run": {"type": "boolean", "description": "既定 true。false で実際に candidate/policy を更新する"},
                    "include_markdown": {"type": "boolean", "description": "内部 report 生成時に markdown を含めるか"}
                }
            }
        ),
        Tool(
            name="discover_source_candidates_by_search",
            description="検索エンジン経由で候補 URL を見つけ、必要なら source_candidates に登録する。検索結果は Bing RSS を利用する。",
            inputSchema={
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "検索クエリ"},
                    "allowed_domains": {"type": "array", "items": {"type": "string"}, "description": "許可ドメインの allowlist"},
                    "limit": {"type": "integer", "description": "最大件数 (default: 10)"},
                    "register_candidates": {"type": "boolean", "description": "true の場合は source_candidates に登録する"},
                    "discovered_by": {"type": "string", "description": "登録時の discovered_by (default: search_engine)"},
                    "file_types": {"type": "array", "items": {"type": "string"}, "description": "pdf/html/csv/excel などの候補 file_type フィルタ"}
                },
                "required": ["query"]
            }
        ),
        Tool(
            name="discover_source_candidates_from_page",
            description="一覧ページのリンクを抽出して候補 URL を見つけ、必要なら source_candidates に登録する。",
            inputSchema={
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "リンク抽出元の一覧ページ URL"},
                    "allowed_domains": {"type": "array", "items": {"type": "string"}, "description": "許可ドメインの allowlist"},
                    "same_domain_only": {"type": "boolean", "description": "true の場合は一覧ページと同一ドメインのみ抽出する"},
                    "limit": {"type": "integer", "description": "最大件数 (default: 20)"},
                    "register_candidates": {"type": "boolean", "description": "true の場合は source_candidates に登録する"},
                    "discovered_by": {"type": "string", "description": "登録時の discovered_by (default: page_discovery)"},
                    "discovery_query": {"type": "string", "description": "登録時の discovery_query。未指定時は元 URL を使う"},
                    "file_types": {"type": "array", "items": {"type": "string"}, "description": "pdf/html/csv/excel などの候補 file_type フィルタ"}
                },
                "required": ["url"]
            }
        ),
        Tool(
            name="approve_source_candidate",
            description="candidate を承認し、必要に応じて source_policies に昇格させる。",
            inputSchema={
                "type": "object",
                "properties": {
                    "candidate_id": {"type": "integer", "description": "source_candidates.id"},
                    "candidate_url": {"type": "string", "description": "候補 URL"},
                    "allowed_path_regex": {"type": "string", "description": "承認後の path regex。未指定時は URL から推定"},
                    "trust_tier": {"type": "string", "enum": ["tier_a_auto", "tier_b_review", "tier_c_block"], "description": "trust tier"},
                    "auto_ingest": {"type": "boolean", "description": "自動 ingest を有効にするか"},
                    "allowed_mime_types": {"type": "array", "items": {"type": "string"}, "description": "許可する MIME type 一覧"},
                    "extract_strategy": {"type": "string", "description": "auto / pdf / html などの抽出戦略"},
                    "owner_note": {"type": "string", "description": "運用メモ"}
                }
            }
        ),
        Tool(
            name="register_source_policy",
            description="source policy を登録または更新する。自動 ingest の許可条件を固定する。",
            inputSchema={
                "type": "object",
                "properties": {
                    "domain": {"type": "string", "description": "対象ドメイン"},
                    "allowed_path_regex": {"type": "string", "description": "許可する path regex"},
                    "allowed_mime_types": {"type": "array", "items": {"type": "string"}, "description": "許可する MIME type 一覧"},
                    "trust_tier": {"type": "string", "enum": ["tier_a_auto", "tier_b_review", "tier_c_block"], "description": "trust tier"},
                    "auto_ingest": {"type": "boolean", "description": "自動 ingest の可否"},
                    "extract_strategy": {"type": "string", "description": "auto / pdf / html などの抽出戦略"},
                    "review_status": {"type": "string", "enum": ["approved", "paused", "deprecated"], "description": "policy 状態"},
                    "owner_note": {"type": "string", "description": "運用メモ"}
                },
                "required": ["domain", "allowed_path_regex", "trust_tier"]
            }
        ),
        Tool(
            name="list_source_policies",
            description="承認済み source policy を一覧表示する。",
            inputSchema={
                "type": "object",
                "properties": {
                    "domain": {"type": "string", "description": "ドメインでフィルタ"},
                    "trust_tier": {"type": "string", "enum": ["tier_a_auto", "tier_b_review", "tier_c_block", "all"], "description": "trust tier でフィルタ"},
                    "review_status": {"type": "string", "enum": ["approved", "paused", "deprecated", "all"], "description": "policy 状態でフィルタ"},
                    "auto_ingest": {"type": "boolean", "description": "自動 ingest 可否でフィルタ"},
                    "limit": {"type": "integer", "description": "最大件数 (default: 50)"}
                }
            }
        ),
        Tool(
            name="check_source_policy",
            description="URL が既存 source policy に一致するか判定し、auto ingest 可否を返す。",
            inputSchema={
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "判定対象 URL"}
                },
                "required": ["url"]
            }
        ),
        Tool(
            name="crawl_trusted_url",
            description="source policy に一致し、auto ingest を許可された URL だけをクロールして索引化する。",
            inputSchema={
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "クロール対象 URL"},
                    "max_text_length": {"type": "integer", "description": "返すテキストの最大長 (default: 8000)"},
                    "index_embeddings": {"type": "boolean", "description": "取得後に chunk embeddings を生成する (default: true)"},
                    "reindex_if_exists": {"type": "boolean", "description": "同一URLの既存索引を削除して再作成する (default: false)"},
                    "register_candidate_if_denied": {"type": "boolean", "description": "policy 不一致なら source_candidates に候補登録する"},
                    "discovered_by": {"type": "string", "description": "候補登録時の discovered_by"},
                    "discovery_query": {"type": "string", "description": "候補登録時の discovery_query"}
                },
                "required": ["url"]
            }
        ),
        Tool(
            name="bulk_ingest_trusted_candidates",
            description="approved candidate のうち allow_auto_ingest に一致した URL をまとめて crawl_trusted_url に流す。既定では dry_run。",
            inputSchema={
                "type": "object",
                "properties": {
                    "candidate_review_status": {"type": "string", "enum": ["approved", "pending", "rejected", "blocked", "all"], "description": "対象 candidate の review_status (default: approved)"},
                    "domain": {"type": "string", "description": "ドメインでフィルタ"},
                    "discovered_by": {"type": "string", "description": "発見元でフィルタ"},
                    "query": {"type": "string", "description": "title / publisher / URL の検索"},
                    "limit": {"type": "integer", "description": "最大件数 (default: 50)"},
                    "candidate_ids": {"type": "array", "items": {"type": "integer"}, "description": "対象 candidate_id の限定リスト"},
                    "max_text_length": {"type": "integer", "description": "返すテキストの最大長 (default: 8000)"},
                    "index_embeddings": {"type": "boolean", "description": "取得後に chunk embeddings を生成する (default: true)"},
                    "reindex_if_exists": {"type": "boolean", "description": "同一URLの既存索引を削除して再作成する (default: false)"},
                    "discovery_query": {"type": "string", "description": "crawl 時に引き継ぐ discovery_query"},
                    "dry_run": {"type": "boolean", "description": "既定 true。false で実際に ingest する"}
                }
            }
        ),
        Tool(
            name="ingest_and_eval_trusted_candidates",
            description="bulk_ingest_trusted_candidates の後に eval/questions.json ベースの品質評価を続けて実行する。既定では dry_run。",
            inputSchema={
                "type": "object",
                "properties": {
                    "candidate_review_status": {"type": "string", "enum": ["approved", "pending", "rejected", "blocked", "all"], "description": "対象 candidate の review_status (default: approved)"},
                    "domain": {"type": "string", "description": "ドメインでフィルタ"},
                    "discovered_by": {"type": "string", "description": "発見元でフィルタ"},
                    "query": {"type": "string", "description": "title / publisher / URL の検索"},
                    "limit": {"type": "integer", "description": "最大件数 (default: 50)"},
                    "candidate_ids": {"type": "array", "items": {"type": "integer"}, "description": "対象 candidate_id の限定リスト"},
                    "max_text_length": {"type": "integer", "description": "返すテキストの最大長 (default: 8000)"},
                    "index_embeddings": {"type": "boolean", "description": "取得後に chunk embeddings を生成する (default: true)"},
                    "reindex_if_exists": {"type": "boolean", "description": "同一URLの既存索引を削除して再作成する (default: false)"},
                    "discovery_query": {"type": "string", "description": "crawl 時に引き継ぐ discovery_query"},
                    "questions_path": {"type": "string", "description": "評価質問 JSON のパス"},
                    "output_json_path": {"type": "string", "description": "評価 JSON の出力先"},
                    "output_md_path": {"type": "string", "description": "評価 Markdown の出力先"},
                    "eval_sample": {"type": "integer", "description": "先頭 N 問だけ評価する"},
                    "provider": {"type": "string", "description": "評価時の回答生成 provider override"},
                    "model": {"type": "string", "description": "評価時の回答生成 model override"},
                    "mode": {"type": "string", "enum": ["lexical", "semantic", "hybrid"], "description": "評価時の検索モード (default: hybrid)"},
                    "eval_limit": {"type": "integer", "description": "評価時の citation limit (default: 2)"},
                    "max_output_tokens": {"type": "integer", "description": "評価時の生成 max output tokens (default: 240)"},
                    "temperature": {"type": "number", "description": "評価時の temperature (default: 0.1)"},
                    "citation_retry_limit": {"type": "integer", "description": "評価時の citation retry limit"},
                    "write_eval_files": {"type": "boolean", "description": "評価結果を latest_results/latest_report に書くか"},
                    "skip_eval_on_ingest_error": {"type": "boolean", "description": "ingest error がある場合に eval を skip するか"},
                    "dry_run": {"type": "boolean", "description": "既定 true。false で ingest 後に eval まで実行する"}
                }
            }
        ),
        Tool(
            name="daily_trusted_ingest_pipeline",
            description="discovery -> review -> bulk review -> trusted ingest -> eval を 1 ドメイン単位でまとめて実行する。既定では dry_run。",
            inputSchema={
                "type": "object",
                "properties": {
                    "listing_page_urls": {"type": "array", "items": {"type": "string"}, "description": "公式一覧ページ URL の配列"},
                    "search_queries": {"type": "array", "items": {"type": "string"}, "description": "必要なら追加で回す検索クエリ"},
                    "allowed_domains": {"type": "array", "items": {"type": "string"}, "description": "対象ドメイン。現状は 1 ドメインのみ対応"},
                    "candidate_limit_per_source": {"type": "integer", "description": "discovery ごとの最大候補数 (default: 20)"},
                    "file_types": {"type": "array", "items": {"type": "string"}, "description": "discovery 時の file_type フィルタ"},
                    "same_domain_only": {"type": "boolean", "description": "一覧ページ discovery を同一ドメインに限定する"},
                    "page_discovered_by": {"type": "string", "description": "一覧ページ discovery の discovered_by"},
                    "search_discovered_by": {"type": "string", "description": "検索 discovery の discovered_by"},
                    "discovery_query": {"type": "string", "description": "ingest 時に引き継ぐ discovery_query"},
                    "review_limit": {"type": "integer", "description": "review report の最大件数 (default: 50)"},
                    "review_recommendation_filter": {
                        "type": "array",
                        "items": {
                            "type": "string",
                            "enum": ["approve_tier_a_auto", "approve_tier_b_review", "manual_review", "block_tier_c", "already_covered"]
                        },
                        "description": "bulk review で自動適用する recommendation。既定は approve_tier_a_auto と already_covered"
                    },
                    "mark_already_covered": {"type": "boolean", "description": "already_covered を review 完了扱いにするか"},
                    "owner_note": {"type": "string", "description": "bulk review 時の owner note"},
                    "ingest_limit": {"type": "integer", "description": "trusted ingest の最大件数 (default: 50)"},
                    "max_text_length": {"type": "integer", "description": "返すテキストの最大長 (default: 8000)"},
                    "index_embeddings": {"type": "boolean", "description": "取得後に chunk embeddings を生成する (default: true)"},
                    "reindex_if_exists": {"type": "boolean", "description": "同一URLの既存索引を削除して再作成する (default: false)"},
                    "questions_path": {"type": "string", "description": "評価質問 JSON のパス"},
                    "output_json_path": {"type": "string", "description": "評価 JSON の出力先"},
                    "output_md_path": {"type": "string", "description": "評価 Markdown の出力先"},
                    "eval_sample": {"type": "integer", "description": "先頭 N 問だけ評価する"},
                    "provider": {"type": "string", "description": "評価時の回答生成 provider override"},
                    "model": {"type": "string", "description": "評価時の回答生成 model override"},
                    "mode": {"type": "string", "enum": ["lexical", "semantic", "hybrid"], "description": "評価時の検索モード (default: hybrid)"},
                    "eval_limit": {"type": "integer", "description": "評価時の citation limit (default: 2)"},
                    "max_output_tokens": {"type": "integer", "description": "評価時の生成 max output tokens (default: 240)"},
                    "temperature": {"type": "number", "description": "評価時の temperature (default: 0.1)"},
                    "citation_retry_limit": {"type": "integer", "description": "評価時の citation retry limit"},
                    "quality_gate_enabled": {"type": "boolean", "description": "品質ゲートを有効にするか。既定では non-dry-run で true"},
                    "quality_gate_min_pass_rate": {"type": "number", "description": "許容する最小 pass_rate。既定は 100.0"},
                    "quality_gate_max_failed_questions": {"type": "integer", "description": "許容する fail 件数。既定は 0"},
                    "quality_gate_max_fallback_used": {"type": "integer", "description": "許容する fallback_used 件数。未指定なら判定しない"},
                    "quality_gate_max_ingest_errors": {"type": "integer", "description": "許容する ingest error 件数。既定は 0"},
                    "quality_gate_require_eval_completed": {"type": "boolean", "description": "eval が completed であることを必須にするか。既定は true"},
                    "quality_gate_fail_when_no_ingest": {"type": "boolean", "description": "新規 ingest が 0 件でも fail にするか。既定は false"},
                    "write_eval_files": {"type": "boolean", "description": "評価結果を latest_results/latest_report に書くか"},
                    "skip_eval_on_ingest_error": {"type": "boolean", "description": "ingest error がある場合に eval を skip するか"},
                    "include_markdown": {"type": "boolean", "description": "review report markdown を含めるか"},
                    "write_log_file": {"type": "boolean", "description": "pipeline 結果を JSON に保存するか"},
                    "pipeline_output_json_path": {"type": "string", "description": "pipeline 実行ログの JSON 出力先"},
                    "dry_run": {"type": "boolean", "description": "既定 true。false で discovery 登録から eval まで実行する"}
                }
            }
        ),
        Tool(
            name="search_flows",
            description="既存の資金フロー(edges)を検索。source/target/category/年度で絞り込み可能。重複登録を避けるため、新しいフローを追加する前に必ず既存データを確認すること。",
            inputSchema={
                "type": "object",
                "properties": {
                    "source_id": {"type": "string", "description": "フロー元のnode ID (部分一致)"},
                    "target_id": {"type": "string", "description": "フロー先のnode ID (部分一致)"},
                    "category": {"type": "string", "description": "カテゴリ (welfare, tax, education等)"},
                    "fiscal_year": {"type": "integer", "description": "会計年度 (西暦)"},
                    "keyword": {"type": "string", "description": "source_dataset や description のキーワード検索"},
                    "limit": {"type": "integer", "description": "最大件数 (default: 50)"}
                }
            }
        ),
        Tool(
            name="store_flow",
            description="新しい資金フロー(edge)をDBに保存。source/targetノードが存在しない場合は自動作成。出典情報(provenance)も同時に記録。金額は億円単位で指定。",
            inputSchema={
                "type": "object",
                "properties": {
                    "source_id": {"type": "string", "description": "フロー元のnode ID (例: MIN_CFA)"},
                    "source_name": {"type": "string", "description": "フロー元の表示名"},
                    "source_type": {"type": "string", "description": "ノードタイプ (ministry, recipient, corporation_jp等)"},
                    "target_id": {"type": "string", "description": "フロー先のnode ID"},
                    "target_name": {"type": "string", "description": "フロー先の表示名"},
                    "target_type": {"type": "string", "description": "ノードタイプ"},
                    "amount_oku_yen": {"type": "number", "description": "金額 (億円単位)"},
                    "category": {"type": "string", "description": "カテゴリ"},
                    "sub_category": {"type": "string", "description": "サブカテゴリ"},
                    "fiscal_year": {"type": "integer", "description": "会計年度 (西暦)"},
                    "confidence": {"type": "number", "description": "信頼度 0.0-1.0"},
                    "source_dataset": {"type": "string", "description": "データソース名"},
                    "description": {"type": "string", "description": "説明・根拠テキスト"},
                    "provenance_url": {"type": "string", "description": "出典URL"},
                    "provenance_title": {"type": "string", "description": "出典文書タイトル"},
                    "provenance_page": {"type": "integer", "description": "出典ページ番号"},
                    "evidence_text": {"type": "string", "description": "出典からの引用テキスト"}
                },
                "required": ["source_id", "source_name", "target_id", "target_name", "amount_oku_yen", "category", "fiscal_year"]
            }
        ),
        Tool(
            name="store_node",
            description="新しいエンティティ(node)をDBに保存。同じIDが存在する場合はスキップ。",
            inputSchema={
                "type": "object",
                "properties": {
                    "id": {"type": "string", "description": "ノードID"},
                    "name": {"type": "string", "description": "表示名"},
                    "name_en": {"type": "string", "description": "英語名"},
                    "type": {"type": "string", "description": "タイプ"},
                    "lat": {"type": "number"}, "lng": {"type": "number"},
                    "region": {"type": "string"}
                },
                "required": ["id", "name", "type"]
            }
        ),
        Tool(
            name="list_nodes",
            description="登録済みノード一覧。タイプやキーワードでフィルタ可能。",
            inputSchema={
                "type": "object",
                "properties": {
                    "type": {"type": "string", "description": "ノードタイプでフィルタ"},
                    "keyword": {"type": "string", "description": "名前のキーワード検索"},
                    "limit": {"type": "integer", "description": "最大件数 (default: 100)"}
                }
            }
        ),
        # ── Provenance ──
        Tool(
            name="get_provenance",
            description="フロー(edge)の出典情報を取得。",
            inputSchema={
                "type": "object",
                "properties": {
                    "edge_id": {"type": "integer"},
                    "source_id": {"type": "string"},
                    "target_id": {"type": "string"}
                }
            }
        ),
        Tool(
            name="get_db_summary",
            description="データベースの概要統計。ノード数、エッジ数、カテゴリ別・年度別集計、登録クロールルート数。",
            inputSchema={"type": "object", "properties": {}}
        ),
        # ── Smart Crawl ──
        Tool(
            name="crawl_url",
            description="URLからデータを取得・解析。HTML/PDF/CSV/Excelを自動判別し、全文保存・チャンク化・任意の embedding 索引まで行う。",
            inputSchema={
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "取得するURL"},
                    "max_text_length": {"type": "integer", "description": "返すテキストの最大長 (default: 8000)"},
                    "index_embeddings": {"type": "boolean", "description": "取得後に chunk embeddings を生成する (default: true)"},
                    "reindex_if_exists": {"type": "boolean", "description": "同一URLの既存索引を削除して再作成する (default: false)"}
                },
                "required": ["url"]
            }
        ),
        Tool(
            name="register_crawl_route",
            description="データ取得に成功したルートをDBに登録。次回以降、同じルートで再クロールできる。URLや抽出設定、取得サンプルデータを保存。",
            inputSchema={
                "type": "object",
                "properties": {
                    "route_id": {"type": "string", "description": "ルートID (例: cfa_r7_budget_pdf)"},
                    "source_id": {"type": "string", "description": "data_sourcesのsource_id (紐付け用)"},
                    "name": {"type": "string", "description": "ルートの説明名 (例: こども家庭庁R7予算PDF)"},
                    "url": {"type": "string", "description": "クロール対象URL"},
                    "file_type": {"type": "string", "enum": ["html", "pdf", "csv", "excel", "api"], "description": "ファイル種別"},
                    "extraction_config": {"type": "string", "description": "抽出設定メモ (JSON文字列可)。テーブルの位置、ページ番号、CSSセレクタなど"},
                    "table_path": {"type": "string", "description": "テーブルの場所 (例: page:3,table:0 や table_index:2)"},
                    "sample_data": {"type": "string", "description": "取得成功時のサンプルデータ (JSON文字列)"},
                    "last_values": {"type": "string", "description": "最新の抽出値 (JSON文字列、前回との比較用)"}
                },
                "required": ["route_id", "name", "url", "file_type"]
            }
        ),
        Tool(
            name="list_crawl_routes",
            description="登録済みクロールルート一覧。再クロール時に参照。",
            inputSchema={
                "type": "object",
                "properties": {
                    "source_id": {"type": "string", "description": "data_sourcesのsource_idでフィルタ"},
                    "status": {"type": "string", "enum": ["verified", "outdated", "failed", "all"], "description": "ステータスフィルタ"}
                }
            }
        ),
        Tool(
            name="recrawl_route",
            description="登録済みルートを再クロール。前回と同じURLからデータを取得し、既存索引を置き換えて再チャンク化・再埋め込みする。",
            inputSchema={
                "type": "object",
                "properties": {
                    "route_id": {"type": "string", "description": "再クロールするルートID"},
                    "index_embeddings": {"type": "boolean", "description": "再クロール後に chunk embeddings を生成する (default: true)"}
                },
                "required": ["route_id"]
            }
        ),
        Tool(
            name="search_documents",
            description="クロール済み文書を lexical / semantic / hybrid で検索し、出典付きチャンクを返す。",
            inputSchema={
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "検索キーワード (例: 児童手当 予算)"},
                    "limit": {"type": "integer", "description": "最大件数 (default: 10)"},
                    "mode": {"type": "string", "enum": ["lexical", "semantic", "hybrid"], "description": "検索モード (default: hybrid)"},
                    "document_id": {"type": "integer", "description": "対象 document_id を限定する"}
                },
                "required": ["query"]
            }
        ),
        Tool(
            name="answer_documents",
            description="検索結果から引用付き context pack を組み立て、外部 LLM に渡せる prompt を返す。",
            inputSchema={
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "質問文"},
                    "limit": {"type": "integer", "description": "取得するチャンク数 (default: 5)"},
                    "mode": {"type": "string", "enum": ["lexical", "semantic", "hybrid"], "description": "検索モード (default: hybrid)"},
                    "document_id": {"type": "integer", "description": "対象 document_id を限定する"},
                    "max_context_chars": {"type": "integer", "description": "context 全体の最大文字数 (default: 6000)"},
                    "max_chunk_chars": {"type": "integer", "description": "1チャンクあたりの最大文字数 (default: 1200)"}
                },
                "required": ["query"]
            }
        ),
        Tool(
            name="generate_document_answer",
            description="answer_documents で作った context pack を使って最終回答を生成する。ollama または OpenAI 互換 endpoint を利用できる。",
            inputSchema={
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "質問文"},
                    "limit": {"type": "integer", "description": "取得するチャンク数 (default: 5)"},
                    "mode": {"type": "string", "enum": ["lexical", "semantic", "hybrid"], "description": "検索モード (default: hybrid)"},
                    "document_id": {"type": "integer", "description": "対象 document_id を限定する"},
                    "max_context_chars": {"type": "integer", "description": "context 全体の最大文字数 (default: 6000)"},
                    "max_chunk_chars": {"type": "integer", "description": "1チャンクあたりの最大文字数 (default: 1200)"},
                    "provider": {"type": "string", "enum": ["ollama", "openai_compatible"], "description": "回答生成 provider。未指定時は環境変数を使用"},
                    "model": {"type": "string", "description": "回答生成 model。未指定時は環境変数を使用"},
                    "temperature": {"type": "number", "description": "生成 temperature"},
                    "max_output_tokens": {"type": "integer", "description": "生成の最大出力トークン数"},
                    "citation_retry_limit": {"type": "integer", "description": "引用番号が欠けた場合の再生成回数 (default: 1)"}
                },
                "required": ["query"]
            }
        ),
        Tool(
            name="index_document_embeddings",
            description="既存の crawl document に対して chunk embeddings を生成または再生成する。",
            inputSchema={
                "type": "object",
                "properties": {
                    "document_id": {"type": "integer", "description": "対象 document_id。未指定時は複数文書を対象とする"},
                    "limit": {"type": "integer", "description": "複数文書処理時の最大件数"},
                    "force": {"type": "boolean", "description": "既存 embedding があっても再生成する"}
                }
            }
        ),
    ]


@server.call_tool()
async def call_tool(name: str, arguments: dict[str, Any]) -> list[TextContent]:
    conn = get_db()
    try:
        result = _dispatch(name, arguments, conn)
        return [TextContent(type="text", text=json.dumps(result, ensure_ascii=False, indent=2, default=str))]
    except Exception as e:
        import traceback
        return [TextContent(type="text", text=json.dumps({
            "error": str(e), "traceback": traceback.format_exc()
        }, ensure_ascii=False))]
    finally:
        conn.close()


def _dispatch(name: str, args: dict[str, Any], conn: sqlite3.Connection) -> Any:
    handlers = {
        "list_sources": _list_sources,
        "register_source_candidate": _register_source_candidate,
        "list_source_candidates": _list_source_candidates,
        "review_source_candidates_report": _review_source_candidates_report,
        "bulk_review_source_candidates": _bulk_review_source_candidates,
        "discover_source_candidates_by_search": _discover_source_candidates_by_search,
        "discover_source_candidates_from_page": _discover_source_candidates_from_page,
        "approve_source_candidate": _approve_source_candidate,
        "register_source_policy": _register_source_policy,
        "list_source_policies": _list_source_policies,
        "check_source_policy": _check_source_policy,
        "crawl_trusted_url": _crawl_trusted_url,
        "bulk_ingest_trusted_candidates": _bulk_ingest_trusted_candidates,
        "ingest_and_eval_trusted_candidates": _ingest_and_eval_trusted_candidates,
        "daily_trusted_ingest_pipeline": _daily_trusted_ingest_pipeline,
        "search_flows": _search_flows,
        "store_flow": _store_flow,
        "store_node": _store_node,
        "list_nodes": _list_nodes,
        "get_provenance": _get_provenance,
        "get_db_summary": _get_db_summary,
        "crawl_url": _crawl_url,
        "register_crawl_route": _register_crawl_route,
        "list_crawl_routes": _list_crawl_routes,
        "recrawl_route": _recrawl_route,
        "search_documents": _search_documents,
        "answer_documents": _answer_documents,
        "generate_document_answer": _generate_document_answer,
        "index_document_embeddings": _index_document_embeddings,
    }
    handler = handlers.get(name)
    if not handler:
        raise ValueError(f"Unknown tool: {name}")
    if name in ("get_db_summary",):
        return handler(conn)
    return handler(args, conn)


# ─── Data Management implementations ───

def _list_sources(args: dict, conn: sqlite3.Connection) -> dict:
    query = "SELECT source_id, name, name_ja, agency_code, url, data_format, priority, crawl_frequency, last_crawled_at FROM data_sources"
    conditions, params = [], []
    if args.get("priority") and args["priority"] != "all":
        conditions.append("priority = ?"); params.append(args["priority"])
    if args.get("agency_code"):
        conditions.append("agency_code = ?"); params.append(args["agency_code"])
    if conditions:
        query += " WHERE " + " AND ".join(conditions)
    query += " ORDER BY priority, name"
    rows = rows_to_dicts(conn.execute(query, params).fetchall())
    return {"count": len(rows), "sources": rows}


def _normalize_domain(value: str) -> str:
    raw = (value or "").strip().lower()
    if not raw:
        return ""
    parsed = urlparse(raw if "://" in raw else f"https://{raw}")
    host = parsed.netloc or parsed.path.split("/")[0]
    host = host.strip().lower()
    if host.startswith("www."):
        host = host[4:]
    if ":" in host:
        host = host.split(":", 1)[0]
    return host


def _coerce_bool(value: Any, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    return str(value).strip().lower() not in {"", "0", "false", "no", "off"}


def _serialize_string_list(values: Any) -> str | None:
    if values is None:
        return None
    normalized: list[str] = []
    if isinstance(values, str):
        raw = values.strip()
        if not raw:
            return None
        if raw.startswith("["):
            try:
                parsed = json.loads(raw)
                if isinstance(parsed, list):
                    normalized = [str(item).strip() for item in parsed if str(item).strip()]
                else:
                    normalized = [str(parsed).strip()]
            except json.JSONDecodeError:
                normalized = [part.strip() for part in raw.split(",") if part.strip()]
        else:
            normalized = [part.strip() for part in raw.split(",") if part.strip()]
    elif isinstance(values, (list, tuple, set)):
        normalized = [str(item).strip() for item in values if str(item).strip()]
    else:
        normalized = [str(values).strip()]
    if not normalized:
        return None
    return json.dumps(sorted(dict.fromkeys(normalized)), ensure_ascii=False)


def _deserialize_string_list(value: Any) -> list[str]:
    if not value:
        return []
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    raw = str(value).strip()
    if not raw:
        return []
    if raw.startswith("["):
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, list):
                return [str(item).strip() for item in parsed if str(item).strip()]
        except json.JSONDecodeError:
            pass
    return [part.strip() for part in raw.split(",") if part.strip()]


def _hydrate_source_candidate(row: sqlite3.Row | dict[str, Any]) -> dict[str, Any]:
    item = dict(row)
    for field_name in ("is_primary_source", "is_official_site", "is_stable_url"):
        item[field_name] = bool(item.get(field_name))
    return item


def _hydrate_source_policy(row: sqlite3.Row | dict[str, Any]) -> dict[str, Any]:
    item = dict(row)
    item["auto_ingest"] = bool(item.get("auto_ingest"))
    item["allowed_mime_types"] = _deserialize_string_list(item.get("allowed_mime_types"))
    return item


def _guess_candidate_file_type_from_url(url: str) -> str | None:
    path = urlparse(str(url).strip()).path.lower()
    for extension, file_type in DISCOVERY_DOCUMENT_EXTENSIONS.items():
        if path.endswith(extension):
            return file_type
    suffix_match = re.search(r"(\.[a-z0-9]+)$", path)
    if not suffix_match:
        return "html" if path.endswith("/") or "." not in path.rsplit("/", 1)[-1] else None
    if suffix_match.group(1) in DISCOVERY_ALLOWED_HTML_EXTENSIONS:
        return "html"
    return None


def _is_official_domain(domain: str) -> bool:
    normalized_domain = _normalize_domain(domain)
    if not normalized_domain:
        return False
    return normalized_domain.endswith(DISCOVERY_OFFICIAL_DOMAIN_SUFFIXES)


def _is_stable_candidate_url(url: str) -> bool:
    parsed = urlparse(str(url).strip())
    if parsed.scheme not in {"http", "https"}:
        return False
    if not parsed.netloc:
        return False
    if parsed.fragment:
        return False
    path = parsed.path or "/"
    if any(fragment in path.lower() for fragment in DISCOVERY_BLOCKED_PATH_FRAGMENTS):
        return False
    query_pairs = [part.split("=", 1)[0].lower() for part in parsed.query.split("&") if part]
    if any(key in DISCOVERY_BLOCKED_QUERY_KEYS for key in query_pairs):
        return False
    return True


def _normalize_discovery_text(value: Any) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    if BeautifulSoup and ("<" in raw and ">" in raw):
        raw = BeautifulSoup(raw, "html.parser").get_text(" ", strip=True)
    raw = re.sub(r"\s+", " ", raw)
    return raw.strip()


def _classify_discovered_candidate(
    url: str,
    *,
    title: str = "",
    snippet: str = "",
    publisher: str = "",
) -> dict[str, Any]:
    normalized_url = str(url).strip()
    domain = _normalize_domain(normalized_url)
    file_type = _guess_candidate_file_type_from_url(normalized_url)
    official = _is_official_domain(domain)
    stable_url = _is_stable_candidate_url(normalized_url)
    combined_text = " ".join(
        part for part in (
            _normalize_discovery_text(title),
            _normalize_discovery_text(snippet),
            _normalize_discovery_text(publisher),
            normalized_url,
        )
        if part
    ).lower()
    is_document = file_type in {"pdf", "csv", "excel", "json"}
    primary_keyword_hit = any(keyword.lower() in combined_text for keyword in DISCOVERY_PRIMARY_KEYWORDS)
    index_keyword_hit = any(keyword.lower() in combined_text for keyword in DISCOVERY_INDEX_KEYWORDS)

    if official and is_document and (primary_keyword_hit or "/budget" in normalized_url.lower()):
        classification = "primary_official_document"
        confidence = 0.92
        is_primary = True
    elif official and (file_type == "html" or file_type is None) and index_keyword_hit:
        classification = "official_index_page"
        confidence = 0.74
        is_primary = False
    elif official and is_document:
        classification = "official_document"
        confidence = 0.78
        is_primary = True
    elif official:
        classification = "official_page"
        confidence = 0.62
        is_primary = False
    elif is_document:
        classification = "secondary_document"
        confidence = 0.42
        is_primary = False
    else:
        classification = "secondary_summary"
        confidence = 0.32
        is_primary = False

    return {
        "domain": domain,
        "file_type": file_type,
        "llm_classification": classification,
        "llm_confidence": confidence,
        "is_primary_source": is_primary,
        "is_official_site": official,
        "is_stable_url": stable_url,
    }


def _matches_discovery_filters(
    *,
    url: str,
    allowed_domains: list[str],
    file_types: list[str],
    same_domain: str | None = None,
) -> bool:
    normalized_domain = _normalize_domain(url)
    if not normalized_domain:
        return False
    if allowed_domains and normalized_domain not in allowed_domains:
        return False
    if same_domain and normalized_domain != same_domain:
        return False
    if file_types:
        file_type = _guess_candidate_file_type_from_url(url)
        if file_type not in file_types:
            return False
    return True


def _search_bing_rss(
    query: str,
    *,
    allowed_domains: list[str],
    limit: int,
) -> list[dict[str, Any]]:
    if not httpx:
        raise RuntimeError(f"httpx unavailable: {HTTPX_IMPORT_ERROR or 'not installed'}")
    response = httpx.get(
        "https://www.bing.com/search",
        params={"q": query, "format": "rss"},
        headers={"User-Agent": "Mozilla/5.0 (compatible; MoneyFlowBot/1.0)"},
        timeout=30,
    )
    response.raise_for_status()
    root = ET.fromstring(response.text)

    discovered: list[dict[str, Any]] = []
    seen_urls: set[str] = set()
    for item in root.findall(".//item"):
        link = _normalize_discovery_text(item.findtext("link"))
        if not link or link in seen_urls:
            continue
        if not _matches_discovery_filters(url=link, allowed_domains=allowed_domains, file_types=[], same_domain=None):
            continue
        title = _normalize_discovery_text(item.findtext("title"))
        snippet = _normalize_discovery_text(item.findtext("description"))
        publisher = _normalize_domain(link)
        discovered.append({
            "candidate_url": link,
            "title": title,
            "publisher": publisher,
            "snippet": snippet,
            "published_at": _normalize_discovery_text(item.findtext("pubDate")),
            "provider": "bing_rss",
        })
        seen_urls.add(link)
        if len(discovered) >= limit:
            break
    return discovered


def _discover_candidates_from_page(
    url: str,
    *,
    allowed_domains: list[str],
    same_domain_only: bool,
    limit: int,
) -> list[dict[str, Any]]:
    if not BeautifulSoup:
        raise RuntimeError(f"beautifulsoup4 unavailable: {BEAUTIFULSOUP_IMPORT_ERROR or 'not installed'}")

    content, content_type, final_url = _fetch_url(url)
    soup = BeautifulSoup(content, "html.parser")
    root = _pick_listing_root(soup)
    base_domain = _normalize_domain(final_url)
    allowed = allowed_domains
    same_domain = base_domain if same_domain_only and not allowed else None

    discovered: list[dict[str, Any]] = []
    seen_urls: set[str] = set()
    for anchor in root.find_all("a", href=True):
        href = str(anchor.get("href") or "").strip()
        if not href or href.startswith(("#", "mailto:", "javascript:", "tel:")):
            continue
        candidate_url = urljoin(final_url, href)
        if candidate_url in seen_urls:
            continue
        if not _matches_discovery_filters(
            url=candidate_url,
            allowed_domains=allowed,
            file_types=[],
            same_domain=same_domain,
        ):
            continue
        title = _normalize_discovery_text(anchor.get_text(" ", strip=True))
        if not title:
            title = _normalize_discovery_text(anchor.get("title"))
        surrounding_text = _normalize_discovery_text(anchor.parent.get_text(" ", strip=True) if anchor.parent else "")
        discovered.append({
            "candidate_url": candidate_url,
            "title": title or candidate_url,
            "publisher": base_domain,
            "snippet": surrounding_text[:300],
            "provider": "listing_page",
            "listing_page_url": final_url,
            "listing_page_content_type": content_type,
            "relevance_score": _score_listing_candidate(
                candidate_url=candidate_url,
                title=title or candidate_url,
                snippet=surrounding_text[:300],
                listing_url=final_url,
            ),
        })
        seen_urls.add(candidate_url)
    discovered.sort(key=lambda item: (item.get("relevance_score", 0.0), item["candidate_url"]), reverse=True)
    return discovered[:limit]


def _prepare_discovery_candidate(
    item: dict[str, Any],
    *,
    discovered_by: str,
    discovery_query: str | None = None,
) -> dict[str, Any]:
    classification = _classify_discovered_candidate(
        item["candidate_url"],
        title=str(item.get("title") or ""),
        snippet=str(item.get("snippet") or ""),
        publisher=str(item.get("publisher") or ""),
    )
    return {
        "candidate_url": item["candidate_url"],
        "title": item.get("title"),
        "publisher": item.get("publisher"),
        "file_type": classification["file_type"],
        "discovered_by": discovered_by,
        "discovery_query": discovery_query,
        "llm_classification": classification["llm_classification"],
        "llm_confidence": classification["llm_confidence"],
        "is_primary_source": classification["is_primary_source"],
        "is_official_site": classification["is_official_site"],
        "is_stable_url": classification["is_stable_url"],
    }


def _pick_listing_root(soup: Any) -> Any:
    for selector in ("main", "[role=main]", "article", ".l-main", ".main", ".contents", ".content"):
        node = soup.select_one(selector)
        if node:
            return node
    return soup


def _score_listing_candidate(
    *,
    candidate_url: str,
    title: str,
    snippet: str,
    listing_url: str,
) -> float:
    parsed_listing = urlparse(listing_url)
    listing_path = parsed_listing.path or "/"
    listing_dir = listing_path.rstrip("/")
    candidate_path = (urlparse(candidate_url).path or "/").lower()
    score = 0.0
    file_type = _guess_candidate_file_type_from_url(candidate_url)
    combined_text = f"{title} {snippet} {candidate_url}".lower()

    if candidate_path.startswith(listing_dir.lower()):
        score += 4.0
    if "/budget" in candidate_path or "予算" in combined_text:
        score += 4.0
    if file_type in {"pdf", "csv", "excel", "json"}:
        score += 6.0
    elif file_type == "html":
        score += 1.0
    if any(keyword.lower() in combined_text for keyword in DISCOVERY_PRIMARY_KEYWORDS):
        score += 3.0
    if any(keyword.lower() in combined_text for keyword in DISCOVERY_INDEX_KEYWORDS):
        score += 1.0
    if _normalize_discovery_text(title).lower() in DISCOVERY_NAVIGATION_TITLES:
        score -= 8.0
    if any(fragment in candidate_path for fragment in DISCOVERY_BLOCKED_PATH_FRAGMENTS):
        score -= 6.0
    if not _is_stable_candidate_url(candidate_url):
        score -= 3.0
    if len(_normalize_discovery_text(title)) <= 2:
        score -= 2.0
    return score


def _derive_allowed_path_regex(candidate_url: str) -> str:
    path = urlparse(candidate_url).path or "/"
    if path == "/":
        return r"^/$"
    if path.endswith("/"):
        return f"^{re.escape(path)}.*$"
    directory, _, filename = path.rpartition("/")
    suffix_match = re.search(r"(\.[A-Za-z0-9]+)$", filename)
    if suffix_match:
        ext = suffix_match.group(1)
        directory_prefix = directory or ""
        return f"^{re.escape(directory_prefix)}/.*{re.escape(ext)}$"
    return f"^{re.escape(path)}$"


def _upsert_source_policy_record(
    conn: sqlite3.Connection,
    *,
    domain: str,
    allowed_path_regex: str,
    trust_tier: str,
    auto_ingest: bool,
    allowed_mime_types: Any = None,
    extract_strategy: str | None = None,
    review_status: str | None = None,
    owner_note: str | None = None,
) -> dict[str, Any]:
    normalized_domain = _normalize_domain(domain)
    if not normalized_domain:
        raise ValueError("domain is required")
    if not allowed_path_regex or not str(allowed_path_regex).strip():
        raise ValueError("allowed_path_regex is required")
    re.compile(str(allowed_path_regex))

    now = datetime.now().isoformat()
    mime_types_json = _serialize_string_list(allowed_mime_types)
    final_review_status = (review_status or "approved").strip()
    final_extract_strategy = (extract_strategy or "auto").strip()

    existing = conn.execute(
        "SELECT id FROM source_policies WHERE domain = ? AND allowed_path_regex = ?",
        (normalized_domain, allowed_path_regex),
    ).fetchone()

    if existing:
        conn.execute(
            """UPDATE source_policies
               SET allowed_mime_types = ?, trust_tier = ?, auto_ingest = ?,
                   extract_strategy = ?, review_status = ?, owner_note = ?,
                   last_reviewed_at = ?, updated_at = ?
               WHERE id = ?""",
            (
                mime_types_json,
                trust_tier,
                1 if auto_ingest else 0,
                final_extract_strategy,
                final_review_status,
                owner_note,
                now,
                now,
                int(existing["id"]),
            ),
        )
        policy_id = int(existing["id"])
        status = "updated"
    else:
        cursor = conn.execute(
            """INSERT INTO source_policies
               (domain, allowed_path_regex, allowed_mime_types, trust_tier, auto_ingest,
                extract_strategy, review_status, owner_note, last_reviewed_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                normalized_domain,
                allowed_path_regex,
                mime_types_json,
                trust_tier,
                1 if auto_ingest else 0,
                final_extract_strategy,
                final_review_status,
                owner_note,
                now,
                now,
            ),
        )
        policy_id = int(cursor.lastrowid)
        status = "created"

    policy_row = conn.execute(
        "SELECT * FROM source_policies WHERE id = ?",
        (policy_id,),
    ).fetchone()
    return {
        "status": status,
        "policy_id": policy_id,
        "policy": _hydrate_source_policy(policy_row),
    }


def _register_source_candidate(args: dict, conn: sqlite3.Connection) -> dict:
    candidate_url = str(args["candidate_url"]).strip()
    if not candidate_url:
        return {"error": "candidate_url is required"}

    domain = _normalize_domain(candidate_url)
    if not domain:
        return {"error": "candidate_url must include a valid domain"}

    llm_confidence = args.get("llm_confidence")
    if llm_confidence is not None:
        llm_confidence = float(llm_confidence)
        if llm_confidence < 0 or llm_confidence > 1:
            return {"error": "llm_confidence must be between 0.0 and 1.0"}

    now = datetime.now().isoformat()
    review_status = str(args.get("review_status", "pending")).strip()
    reviewed_at = now if review_status != "pending" else None

    existing = conn.execute(
        "SELECT id FROM source_candidates WHERE candidate_url = ?",
        (candidate_url,),
    ).fetchone()

    payload = (
        domain,
        args.get("title"),
        args.get("publisher"),
        args.get("file_type"),
        args["discovered_by"],
        args.get("discovery_query"),
        args.get("llm_classification"),
        llm_confidence,
        1 if _coerce_bool(args.get("is_primary_source")) else 0,
        1 if _coerce_bool(args.get("is_official_site")) else 0,
        1 if _coerce_bool(args.get("is_stable_url")) else 0,
        review_status,
        args.get("review_note"),
        reviewed_at,
        now,
    )

    if existing:
        conn.execute(
            """UPDATE source_candidates
               SET domain = ?, title = ?, publisher = ?, file_type = ?, discovered_by = ?,
                   discovery_query = ?, llm_classification = ?, llm_confidence = ?,
                   is_primary_source = ?, is_official_site = ?, is_stable_url = ?,
                   review_status = ?, review_note = ?, reviewed_at = ?, updated_at = ?
               WHERE candidate_url = ?""",
            payload + (candidate_url,),
        )
        candidate_id = int(existing["id"])
        status = "updated"
    else:
        cursor = conn.execute(
            """INSERT INTO source_candidates
               (candidate_url, domain, title, publisher, file_type, discovered_by,
                discovery_query, llm_classification, llm_confidence, is_primary_source,
                is_official_site, is_stable_url, review_status, review_note, reviewed_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (candidate_url,) + payload,
        )
        candidate_id = int(cursor.lastrowid)
        status = "created"

    conn.commit()
    candidate_row = conn.execute(
        "SELECT * FROM source_candidates WHERE id = ?",
        (candidate_id,),
    ).fetchone()
    return {
        "status": status,
        "candidate_id": candidate_id,
        "candidate": _hydrate_source_candidate(candidate_row),
    }


def _list_source_candidates(args: dict, conn: sqlite3.Connection) -> dict:
    query = "SELECT * FROM source_candidates"
    conditions: list[str] = []
    params: list[Any] = []
    if args.get("domain"):
        conditions.append("domain = ?")
        params.append(_normalize_domain(args["domain"]))
    if args.get("review_status") and args["review_status"] != "all":
        conditions.append("review_status = ?")
        params.append(args["review_status"])
    if args.get("llm_classification"):
        conditions.append("llm_classification = ?")
        params.append(args["llm_classification"])
    if args.get("discovered_by"):
        conditions.append("discovered_by = ?")
        params.append(args["discovered_by"])
    if args.get("query"):
        conditions.append("(candidate_url LIKE ? OR title LIKE ? OR publisher LIKE ?)")
        keyword = f"%{args['query']}%"
        params.extend([keyword, keyword, keyword])
    if conditions:
        query += " WHERE " + " AND ".join(conditions)
    query += " ORDER BY CASE review_status WHEN 'pending' THEN 0 ELSE 1 END, updated_at DESC LIMIT ?"
    params.append(int(args.get("limit", 50)))
    rows = conn.execute(query, params).fetchall()
    return {
        "count": len(rows),
        "candidates": [_hydrate_source_candidate(row) for row in rows],
    }


def _update_source_candidate_review(
    conn: sqlite3.Connection,
    *,
    candidate_id: int,
    review_status: str,
    review_note: str | None = None,
) -> dict[str, Any]:
    now = datetime.now().isoformat()
    conn.execute(
        """UPDATE source_candidates
           SET review_status = ?, review_note = ?, reviewed_at = ?, updated_at = ?
           WHERE id = ?""",
        (review_status, review_note, now, now, int(candidate_id)),
    )
    candidate_row = conn.execute(
        "SELECT * FROM source_candidates WHERE id = ?",
        (int(candidate_id),),
    ).fetchone()
    if not candidate_row:
        raise ValueError("source candidate not found")
    return _hydrate_source_candidate(candidate_row)


def _discover_source_candidates_by_search(args: dict, conn: sqlite3.Connection) -> dict:
    query = str(args.get("query", "")).strip()
    if not query:
        return {"error": "query is required"}

    allowed_domains = [_normalize_domain(value) for value in args.get("allowed_domains", []) or []]
    allowed_domains = [value for value in allowed_domains if value]
    register_candidates = _coerce_bool(args.get("register_candidates"), default=True)
    file_types = [str(value).strip().lower() for value in args.get("file_types", []) or [] if str(value).strip()]
    raw_results = _search_bing_rss(
        query,
        allowed_domains=allowed_domains,
        limit=int(args.get("limit", 10)),
    )

    discovered: list[dict[str, Any]] = []
    registrations: list[dict[str, Any]] = []
    for item in raw_results:
        prepared = _prepare_discovery_candidate(
            item,
            discovered_by=str(args.get("discovered_by", "search_engine")),
            discovery_query=query,
        )
        if file_types and prepared.get("file_type") not in file_types:
            continue
        discovered_item = {**item, **prepared}
        discovered.append(discovered_item)
        if register_candidates:
            registrations.append(_register_source_candidate(prepared, conn))

    return {
        "query": query,
        "provider": "bing_rss",
        "allowed_domains": allowed_domains,
        "discovered_count": len(discovered),
        "registered_count": len(registrations),
        "register_candidates": register_candidates,
        "candidates": discovered,
        "registrations": registrations,
    }


def _discover_source_candidates_from_page(args: dict, conn: sqlite3.Connection) -> dict:
    url = str(args.get("url", "")).strip()
    if not url:
        return {"error": "url is required"}

    allowed_domains = [_normalize_domain(value) for value in args.get("allowed_domains", []) or []]
    allowed_domains = [value for value in allowed_domains if value]
    same_domain_only = _coerce_bool(args.get("same_domain_only"), default=True)
    register_candidates = _coerce_bool(args.get("register_candidates"), default=True)
    file_types = [str(value).strip().lower() for value in args.get("file_types", []) or [] if str(value).strip()]
    raw_results = _discover_candidates_from_page(
        url,
        allowed_domains=allowed_domains,
        same_domain_only=same_domain_only,
        limit=int(args.get("limit", 20)),
    )

    discovered: list[dict[str, Any]] = []
    registrations: list[dict[str, Any]] = []
    for item in raw_results:
        prepared = _prepare_discovery_candidate(
            item,
            discovered_by=str(args.get("discovered_by", "page_discovery")),
            discovery_query=str(args.get("discovery_query") or url),
        )
        if file_types and prepared.get("file_type") not in file_types:
            continue
        discovered_item = {**item, **prepared}
        discovered.append(discovered_item)
        if register_candidates:
            registrations.append(_register_source_candidate(prepared, conn))

    return {
        "url": url,
        "allowed_domains": allowed_domains,
        "same_domain_only": same_domain_only,
        "discovered_count": len(discovered),
        "registered_count": len(registrations),
        "register_candidates": register_candidates,
        "candidates": discovered,
        "registrations": registrations,
    }


def _build_candidate_policy_suggestion(candidate: dict[str, Any]) -> dict[str, Any]:
    file_type = str(candidate.get("file_type") or "").strip().lower() or None
    allowed_path_regex = _derive_allowed_path_regex(candidate["candidate_url"])
    allowed_mime_types = SOURCE_POLICY_MIME_TYPE_MAP.get(file_type or "", [])
    extract_strategy = file_type if file_type in {"pdf", "html", "csv", "excel"} else "auto"
    classification = str(candidate.get("llm_classification") or "")
    official = bool(candidate.get("is_official_site"))
    primary = bool(candidate.get("is_primary_source"))
    stable = bool(candidate.get("is_stable_url"))

    if official and primary and stable and file_type in {"pdf", "csv", "excel", "json"}:
        recommendation = "approve_tier_a_auto"
        trust_tier = "tier_a_auto"
        auto_ingest = True
        review_priority = "high"
        reason = "official + primary + stable document"
    elif official and stable and classification in {"official_index_page", "official_page"}:
        recommendation = "approve_tier_b_review"
        trust_tier = "tier_b_review"
        auto_ingest = False
        review_priority = "medium"
        reason = "official stable page; keep manual review before auto ingest"
    elif not official and file_type == "html":
        recommendation = "block_tier_c"
        trust_tier = "tier_c_block"
        auto_ingest = False
        review_priority = "low"
        reason = "non-official HTML summary page"
    else:
        recommendation = "manual_review"
        trust_tier = "tier_b_review"
        auto_ingest = False
        review_priority = "medium"
        reason = "requires manual confirmation before policy promotion"

    suggestion = {
        "recommendation": recommendation,
        "review_priority": review_priority,
        "reason": reason,
        "trust_tier": trust_tier,
        "auto_ingest": auto_ingest,
        "allowed_path_regex": allowed_path_regex,
        "allowed_mime_types": allowed_mime_types,
        "extract_strategy": extract_strategy,
    }
    if recommendation != "manual_review":
        suggestion["suggested_approval_args"] = {
            "candidate_id": candidate["id"],
            "trust_tier": trust_tier,
            "auto_ingest": auto_ingest,
            "allowed_path_regex": allowed_path_regex,
            "allowed_mime_types": allowed_mime_types,
            "extract_strategy": extract_strategy,
        }
    return suggestion


def _candidate_review_sort_key(candidate: dict[str, Any]) -> tuple[int, int, int]:
    priority_rank = {"high": 0, "medium": 1, "low": 2}
    recommendation_rank = {
        "approve_tier_a_auto": 0,
        "approve_tier_b_review": 1,
        "manual_review": 2,
        "block_tier_c": 3,
        "already_covered": 4,
    }
    suggestion = candidate.get("suggestion", {})
    return (
        priority_rank.get(str(suggestion.get("review_priority", "medium")), 9),
        recommendation_rank.get(str(suggestion.get("recommendation", "manual_review")), 9),
        int(candidate.get("id", 0)),
    )


def _format_source_candidate_review_markdown(
    *,
    generated_at: str,
    filters: dict[str, Any],
    summary: dict[str, Any],
    domains: list[dict[str, Any]],
) -> str:
    lines = [
        "# Source Candidate Review Report",
        "",
        f"- generated_at: {generated_at}",
        f"- filters: {json.dumps(filters, ensure_ascii=False)}",
        f"- total_candidates: {summary['total_candidates']}",
        f"- domains: {summary['domain_count']}",
        f"- recommendation_counts: {json.dumps(summary['recommendation_counts'], ensure_ascii=False)}",
        "",
    ]
    if not domains:
        lines.append("pending candidate はありません。")
        return "\n".join(lines)

    for domain_summary in domains:
        lines.append(f"## {domain_summary['domain']}")
        lines.append(f"- candidate_count: {domain_summary['candidate_count']}")
        lines.append(f"- recommendation_counts: {json.dumps(domain_summary['recommendation_counts'], ensure_ascii=False)}")
        lines.append("")
        for candidate in domain_summary["candidates"]:
            suggestion = candidate["suggestion"]
            title = candidate.get("title") or candidate["candidate_url"]
            lines.append(f"### [{candidate['id']}] {title}")
            lines.append(f"- url: {candidate['candidate_url']}")
            lines.append(f"- recommendation: {suggestion['recommendation']}")
            lines.append(f"- reason: {suggestion['reason']}")
            lines.append(f"- review_priority: {suggestion['review_priority']}")
            lines.append(f"- file_type: {candidate.get('file_type') or 'unknown'}")
            lines.append(f"- policy_check: {candidate['policy_check']['decision']}")
            if candidate.get("existing_document"):
                lines.append(f"- existing_document_id: {candidate['existing_document']['id']}")
            if suggestion.get("suggested_approval_args"):
                lines.append(
                    "- suggested_approval_args: "
                    + json.dumps(suggestion["suggested_approval_args"], ensure_ascii=False)
                )
            lines.append("")
    return "\n".join(lines).strip()


def _review_source_candidates_report(args: dict, conn: sqlite3.Connection) -> dict:
    review_status = str(args.get("review_status", "pending")).strip() or "pending"
    limit = int(args.get("limit", 50))
    query = "SELECT * FROM source_candidates"
    conditions: list[str] = []
    params: list[Any] = []

    if review_status != "all":
        conditions.append("review_status = ?")
        params.append(review_status)
    if args.get("domain"):
        conditions.append("domain = ?")
        params.append(_normalize_domain(args["domain"]))
    if args.get("discovered_by"):
        conditions.append("discovered_by = ?")
        params.append(str(args["discovered_by"]).strip())
    if args.get("query"):
        conditions.append("(candidate_url LIKE ? OR title LIKE ? OR publisher LIKE ?)")
        keyword = f"%{args['query']}%"
        params.extend([keyword, keyword, keyword])
    if conditions:
        query += " WHERE " + " AND ".join(conditions)
    query += " ORDER BY updated_at DESC LIMIT ?"
    params.append(limit)

    rows = conn.execute(query, params).fetchall()
    reviewed_candidates: list[dict[str, Any]] = []
    for row in rows:
        candidate = _hydrate_source_candidate(row)
        policy_check = _evaluate_source_policy_for_url(conn, candidate["candidate_url"])
        existing_document_row = conn.execute(
            """SELECT id, source_url, file_name, downloaded_at
               FROM crawl_documents
               WHERE source_url = ?
               ORDER BY id DESC
               LIMIT 1""",
            (candidate["candidate_url"],),
        ).fetchone()
        suggestion = _build_candidate_policy_suggestion(candidate)
        if policy_check["decision"] in {"allow_auto_ingest", "review_required", "blocked"}:
            suggestion = {
                "recommendation": "already_covered",
                "review_priority": "low",
                "reason": f"already covered by policy decision: {policy_check['decision']}",
                "trust_tier": policy_check.get("effective_policy", {}).get("trust_tier"),
                "auto_ingest": bool(policy_check.get("effective_policy", {}).get("auto_ingest")),
                "allowed_path_regex": policy_check.get("effective_policy", {}).get("allowed_path_regex"),
                "allowed_mime_types": policy_check.get("effective_policy", {}).get("allowed_mime_types", []),
                "extract_strategy": policy_check.get("effective_policy", {}).get("extract_strategy"),
            }
        reviewed_candidates.append({
            **candidate,
            "policy_check": {
                "decision": policy_check["decision"],
                "reason": policy_check["reason"],
                "matched_count": policy_check["matched_count"],
                "effective_policy": policy_check.get("effective_policy"),
            },
            "existing_document": dict(existing_document_row) if existing_document_row else None,
            "suggestion": suggestion,
        })

    grouped_by_domain: dict[str, list[dict[str, Any]]] = {}
    for candidate in reviewed_candidates:
        grouped_by_domain.setdefault(candidate["domain"], []).append(candidate)

    domain_summaries: list[dict[str, Any]] = []
    recommendation_counter: Counter[str] = Counter()
    for domain, items in grouped_by_domain.items():
        items.sort(key=_candidate_review_sort_key)
        recommendation_counts = Counter(item["suggestion"]["recommendation"] for item in items)
        recommendation_counter.update(recommendation_counts)
        domain_summaries.append({
            "domain": domain,
            "candidate_count": len(items),
            "recommendation_counts": dict(recommendation_counts),
            "candidates": items,
        })
    domain_summaries.sort(key=lambda item: (-item["candidate_count"], item["domain"]))

    generated_at = datetime.now().isoformat()
    filters = {
        "review_status": review_status,
        "domain": _normalize_domain(args["domain"]) if args.get("domain") else None,
        "discovered_by": args.get("discovered_by"),
        "query": args.get("query"),
        "limit": limit,
    }
    summary = {
        "total_candidates": len(reviewed_candidates),
        "domain_count": len(domain_summaries),
        "recommendation_counts": dict(recommendation_counter),
    }
    result = {
        "generated_at": generated_at,
        "filters": filters,
        "summary": summary,
        "domains": domain_summaries,
    }
    if _coerce_bool(args.get("include_markdown"), default=True):
        result["report_markdown"] = _format_source_candidate_review_markdown(
            generated_at=generated_at,
            filters=filters,
            summary=summary,
            domains=domain_summaries,
        )
    return result


def _bulk_review_source_candidates(args: dict, conn: sqlite3.Connection) -> dict:
    dry_run = _coerce_bool(args.get("dry_run"), default=True)
    recommendation_filter = [
        str(value).strip()
        for value in args.get("recommendation_filter", []) or [
            "approve_tier_a_auto",
            "approve_tier_b_review",
            "block_tier_c",
            "already_covered",
        ]
        if str(value).strip()
    ]
    candidate_ids_filter = {
        int(value)
        for value in args.get("candidate_ids", []) or []
        if str(value).strip()
    }
    mark_already_covered = _coerce_bool(args.get("mark_already_covered"), default=True)

    report = _review_source_candidates_report(
        {
            "review_status": args.get("review_status", "pending"),
            "domain": args.get("domain"),
            "discovered_by": args.get("discovered_by"),
            "query": args.get("query"),
            "limit": args.get("limit", 50),
            "include_markdown": args.get("include_markdown", False),
        },
        conn,
    )

    selected_candidates: list[dict[str, Any]] = []
    for domain_summary in report["domains"]:
        for candidate in domain_summary["candidates"]:
            candidate_id = int(candidate["id"])
            recommendation = str(candidate["suggestion"]["recommendation"])
            if candidate_ids_filter and candidate_id not in candidate_ids_filter:
                continue
            if recommendation_filter and recommendation not in recommendation_filter:
                continue
            selected_candidates.append(candidate)

    results: list[dict[str, Any]] = []
    applied_count = 0
    skipped_count = 0

    for candidate in selected_candidates:
        candidate_id = int(candidate["id"])
        recommendation = str(candidate["suggestion"]["recommendation"])
        action_result: dict[str, Any] = {
            "candidate_id": candidate_id,
            "candidate_url": candidate["candidate_url"],
            "recommendation": recommendation,
            "dry_run": dry_run,
        }

        if recommendation == "manual_review":
            action_result["status"] = "skipped"
            action_result["reason"] = "manual_review candidates are not auto-applied"
            skipped_count += 1
            results.append(action_result)
            continue

        if recommendation == "already_covered":
            if not mark_already_covered:
                action_result["status"] = "skipped"
                action_result["reason"] = "already_covered handling is disabled"
                skipped_count += 1
                results.append(action_result)
                continue
            target_status = "blocked" if candidate["policy_check"]["decision"] == "blocked" else "approved"
            review_note = args.get("owner_note") or f"Bulk review closed candidate as {target_status}: already covered by existing policy"
            if dry_run:
                action_result["status"] = "would_update_candidate"
                action_result["review_status"] = target_status
                action_result["review_note"] = review_note
            else:
                updated_candidate = _update_source_candidate_review(
                    conn,
                    candidate_id=candidate_id,
                    review_status=target_status,
                    review_note=review_note,
                )
                action_result["status"] = "updated_candidate"
                action_result["candidate"] = updated_candidate
                applied_count += 1
            results.append(action_result)
            continue

        approval_args = dict(candidate["suggestion"].get("suggested_approval_args") or {})
        if not approval_args:
            action_result["status"] = "skipped"
            action_result["reason"] = "no suggested approval args available"
            skipped_count += 1
            results.append(action_result)
            continue

        if args.get("owner_note"):
            approval_args["owner_note"] = args["owner_note"]

        if dry_run:
            action_result["status"] = "would_approve"
            action_result["approval_args"] = approval_args
        else:
            approval_result = _approve_source_candidate(approval_args, conn)
            action_result["status"] = "approved"
            action_result["approval_result"] = approval_result
            applied_count += 1
        results.append(action_result)

    if not dry_run:
        conn.commit()

    summary = {
        "selected_count": len(selected_candidates),
        "applied_count": applied_count,
        "skipped_count": skipped_count,
        "recommendation_filter": recommendation_filter,
        "dry_run": dry_run,
    }
    if candidate_ids_filter:
        summary["candidate_ids"] = sorted(candidate_ids_filter)
    return {
        "summary": summary,
        "report_summary": report["summary"],
        "results": results,
    }


def _bulk_ingest_trusted_candidates(args: dict, conn: sqlite3.Connection) -> dict:
    candidate_review_status = str(args.get("candidate_review_status", "approved")).strip() or "approved"
    dry_run = _coerce_bool(args.get("dry_run"), default=True)
    candidate_ids_filter = {
        int(value)
        for value in args.get("candidate_ids", []) or []
        if str(value).strip()
    }

    query = "SELECT * FROM source_candidates"
    conditions: list[str] = []
    params: list[Any] = []
    if candidate_review_status != "all":
        conditions.append("review_status = ?")
        params.append(candidate_review_status)
    if args.get("domain"):
        conditions.append("domain = ?")
        params.append(_normalize_domain(args["domain"]))
    if args.get("discovered_by"):
        conditions.append("discovered_by = ?")
        params.append(str(args["discovered_by"]).strip())
    if args.get("query"):
        conditions.append("(candidate_url LIKE ? OR title LIKE ? OR publisher LIKE ?)")
        keyword = f"%{args['query']}%"
        params.extend([keyword, keyword, keyword])
    if conditions:
        query += " WHERE " + " AND ".join(conditions)
    query += " ORDER BY updated_at DESC LIMIT ?"
    params.append(int(args.get("limit", 50)))

    rows = conn.execute(query, params).fetchall()
    selected_candidates: list[dict[str, Any]] = []
    skipped_results: list[dict[str, Any]] = []
    for row in rows:
        candidate = _hydrate_source_candidate(row)
        candidate_id = int(candidate["id"])
        if candidate_ids_filter and candidate_id not in candidate_ids_filter:
            continue
        policy_check = _evaluate_source_policy_for_url(conn, candidate["candidate_url"])
        existing_document_row = conn.execute(
            """SELECT id, source_url, file_name, downloaded_at
               FROM crawl_documents
               WHERE source_url = ?
               ORDER BY id DESC
               LIMIT 1""",
            (candidate["candidate_url"],),
        ).fetchone()
        candidate_with_context = {
            **candidate,
            "policy_check": {
                "decision": policy_check["decision"],
                "reason": policy_check["reason"],
                "effective_policy": policy_check.get("effective_policy"),
            },
            "existing_document": dict(existing_document_row) if existing_document_row else None,
        }
        if policy_check["decision"] != "allow_auto_ingest":
            skipped_results.append({
                "candidate_id": candidate_id,
                "candidate_url": candidate["candidate_url"],
                "status": "skipped",
                "reason": f"policy decision is {policy_check['decision']}",
                "policy_check": candidate_with_context["policy_check"],
            })
            continue
        selected_candidates.append(candidate_with_context)

    results: list[dict[str, Any]] = []
    applied_count = 0
    error_count = 0
    skipped_count = len(skipped_results)
    for skipped in skipped_results:
        results.append(skipped)

    for candidate in selected_candidates:
        action_result: dict[str, Any] = {
            "candidate_id": int(candidate["id"]),
            "candidate_url": candidate["candidate_url"],
            "policy_check": candidate["policy_check"],
            "existing_document": candidate["existing_document"],
            "dry_run": dry_run,
        }
        crawl_args = {
            "url": candidate["candidate_url"],
            "max_text_length": args.get("max_text_length", 8000),
            "index_embeddings": args.get("index_embeddings", DEFAULT_INDEX_EMBEDDINGS),
            "reindex_if_exists": args.get("reindex_if_exists", False),
            "discovered_by": args.get("discovered_by") or candidate.get("discovered_by") or "bulk_ingest",
            "discovery_query": args.get("discovery_query") or candidate.get("discovery_query"),
        }

        if dry_run:
            action_result["status"] = "would_ingest"
            action_result["crawl_args"] = crawl_args
            results.append(action_result)
            continue

        ingest_result = _crawl_trusted_url(crawl_args, conn)
        if ingest_result.get("error"):
            action_result["status"] = "error"
            action_result["error"] = ingest_result["error"]
            action_result["result"] = ingest_result
            error_count += 1
        else:
            action_result["status"] = "ingested"
            action_result["result"] = {
                "document_id": ingest_result.get("document_id"),
                "indexed_chunk_count": ingest_result.get("indexed_chunk_count"),
                "reused_existing": ingest_result.get("reused_existing"),
                "embedding_index": ingest_result.get("embedding_index"),
                "final_url": ingest_result.get("final_url"),
            }
            applied_count += 1
        results.append(action_result)

    summary = {
        "candidate_review_status": candidate_review_status,
        "selected_count": len(selected_candidates),
        "applied_count": applied_count,
        "skipped_count": skipped_count,
        "error_count": error_count,
        "dry_run": dry_run,
    }
    if candidate_ids_filter:
        summary["candidate_ids"] = sorted(candidate_ids_filter)
    return {
        "summary": summary,
        "results": results,
    }


def _ingest_and_eval_trusted_candidates(args: dict, conn: sqlite3.Connection) -> dict:
    dry_run = _coerce_bool(args.get("dry_run"), default=True)
    ingest_result = _bulk_ingest_trusted_candidates(
        {
            "candidate_review_status": args.get("candidate_review_status", "approved"),
            "domain": args.get("domain"),
            "discovered_by": args.get("discovered_by"),
            "query": args.get("query"),
            "limit": args.get("limit", 50),
            "candidate_ids": args.get("candidate_ids"),
            "max_text_length": args.get("max_text_length", 8000),
            "index_embeddings": args.get("index_embeddings", DEFAULT_INDEX_EMBEDDINGS),
            "reindex_if_exists": args.get("reindex_if_exists", False),
            "discovery_query": args.get("discovery_query"),
            "dry_run": dry_run,
        },
        conn,
    )

    eval_plan = {
        "questions_path": str(args.get("questions_path") or DEFAULT_EVAL_QUESTIONS_FILE),
        "output_json_path": str(args.get("output_json_path") or DEFAULT_EVAL_RESULTS_FILE),
        "output_md_path": str(args.get("output_md_path") or DEFAULT_EVAL_REPORT_FILE),
        "sample": args.get("eval_sample"),
        "provider": args.get("provider"),
        "model": args.get("model"),
        "mode": args.get("mode", "hybrid"),
        "limit": int(args.get("eval_limit", 2)),
        "max_output_tokens": int(args.get("max_output_tokens", 240)),
        "temperature": float(args.get("temperature", 0.1)),
        "citation_retry_limit": args.get("citation_retry_limit"),
        "write_eval_files": _coerce_bool(args.get("write_eval_files"), default=not dry_run),
    }

    if dry_run:
        return {
            "dry_run": True,
            "ingest": ingest_result,
            "eval": {
                "status": "skipped",
                "reason": "dry_run enabled",
                "plan": eval_plan,
            },
        }

    ingest_summary = ingest_result["summary"]
    if ingest_summary["selected_count"] == 0:
        return {
            "dry_run": False,
            "ingest": ingest_result,
            "eval": {
                "status": "skipped",
                "reason": "no trusted candidates selected for ingest",
                "plan": eval_plan,
            },
        }

    if ingest_summary["error_count"] > 0 and _coerce_bool(args.get("skip_eval_on_ingest_error"), default=True):
        return {
            "dry_run": False,
            "ingest": ingest_result,
            "eval": {
                "status": "skipped",
                "reason": "ingest produced errors and skip_eval_on_ingest_error=true",
                "plan": eval_plan,
            },
        }

    try:
        import run_rag_eval  # pylint: disable=import-error
    except ImportError as exc:
        return {
            "dry_run": False,
            "ingest": ingest_result,
            "eval": {
                "status": "error",
                "error": f"run_rag_eval import failed: {exc}",
                "plan": eval_plan,
            },
        }

    if os.path.exists(DEFAULT_ENV_FILE):
        run_rag_eval.load_env_file(Path(DEFAULT_ENV_FILE))  # type: ignore[name-defined]

    questions_path = Path(eval_plan["questions_path"])  # type: ignore[name-defined]
    output_json_path = Path(eval_plan["output_json_path"])  # type: ignore[name-defined]
    output_md_path = Path(eval_plan["output_md_path"])  # type: ignore[name-defined]
    payload = run_rag_eval.execute_eval(
        conn=conn,
        questions_path=questions_path,
        provider=eval_plan["provider"],
        model=eval_plan["model"],
        mode=eval_plan["mode"],
        limit=eval_plan["limit"],
        max_output_tokens=eval_plan["max_output_tokens"],
        temperature=eval_plan["temperature"],
        citation_retry_limit=(
            int(eval_plan["citation_retry_limit"])
            if eval_plan["citation_retry_limit"] is not None
            else None
        ),
        sample=(int(eval_plan["sample"]) if eval_plan["sample"] is not None else None),
        output_json_path=(output_json_path if eval_plan["write_eval_files"] else None),
        output_md_path=(output_md_path if eval_plan["write_eval_files"] else None),
    )
    return {
        "dry_run": False,
        "ingest": ingest_result,
        "eval": {
            "status": "completed",
            "summary": payload["summary"],
            "config": payload["config"],
            "output_json_path": str(output_json_path) if eval_plan["write_eval_files"] else None,
            "output_md_path": str(output_md_path) if eval_plan["write_eval_files"] else None,
            "failed_ids": payload["summary"]["failed_ids"],
        },
    }


def _evaluate_pipeline_quality_gate(args: dict, ingest_eval_result: dict[str, Any], dry_run: bool) -> dict[str, Any]:
    enabled = _coerce_bool(args.get("quality_gate_enabled"), default=not dry_run)
    thresholds = {
        "min_pass_rate": float(args.get("quality_gate_min_pass_rate", 100.0)),
        "max_failed_questions": int(args.get("quality_gate_max_failed_questions", 0)),
        "max_fallback_used": (
            int(args["quality_gate_max_fallback_used"])
            if args.get("quality_gate_max_fallback_used") is not None
            else None
        ),
        "max_ingest_errors": int(args.get("quality_gate_max_ingest_errors", 0)),
        "require_eval_completed": _coerce_bool(args.get("quality_gate_require_eval_completed"), default=True),
        "fail_when_no_ingest": _coerce_bool(args.get("quality_gate_fail_when_no_ingest"), default=False),
    }
    gate = {
        "enabled": enabled,
        "thresholds": thresholds,
        "status": "disabled",
        "passed": True,
    }

    if dry_run:
        gate["status"] = "skipped"
        gate["reason"] = "dry_run enabled"
        return gate

    if not enabled:
        gate["reason"] = "quality gate disabled"
        return gate

    ingest_summary = ingest_eval_result.get("ingest", {}).get("summary", {})
    eval_result = ingest_eval_result.get("eval", {})
    applied_count = int(ingest_summary.get("applied_count", 0) or 0)
    error_count = int(ingest_summary.get("error_count", 0) or 0)
    selected_count = int(ingest_summary.get("selected_count", 0) or 0)
    observed = {
        "selected_count": selected_count,
        "applied_count": applied_count,
        "error_count": error_count,
        "eval_status": eval_result.get("status"),
    }
    gate["observed"] = observed

    if applied_count == 0 and error_count == 0 and not thresholds["fail_when_no_ingest"]:
        gate["status"] = "not_applicable"
        gate["reason"] = "no new documents were ingested"
        return gate

    failures: list[dict[str, Any]] = []
    if error_count > thresholds["max_ingest_errors"]:
        failures.append(
            {
                "check": "ingest_errors",
                "actual": error_count,
                "expected_max": thresholds["max_ingest_errors"],
            }
        )

    if eval_result.get("status") != "completed":
        if thresholds["require_eval_completed"]:
            failures.append(
                {
                    "check": "eval_status",
                    "actual": eval_result.get("status"),
                    "expected": "completed",
                    "reason": eval_result.get("reason") or eval_result.get("error"),
                }
            )
    else:
        summary = eval_result.get("summary", {})
        pass_rate = float(summary.get("pass_rate", 0.0) or 0.0)
        failed_questions = len(summary.get("failed_ids", []) or [])
        fallback_used = int(summary.get("fallback_used", 0) or 0)
        observed.update(
            {
                "pass_rate": pass_rate,
                "failed_questions": failed_questions,
                "fallback_used": fallback_used,
            }
        )

        if pass_rate < thresholds["min_pass_rate"]:
            failures.append(
                {
                    "check": "pass_rate",
                    "actual": pass_rate,
                    "expected_min": thresholds["min_pass_rate"],
                }
            )
        if failed_questions > thresholds["max_failed_questions"]:
            failures.append(
                {
                    "check": "failed_questions",
                    "actual": failed_questions,
                    "expected_max": thresholds["max_failed_questions"],
                    "failed_ids": summary.get("failed_ids", []),
                }
            )
        max_fallback_used = thresholds["max_fallback_used"]
        if max_fallback_used is not None and fallback_used > max_fallback_used:
            failures.append(
                {
                    "check": "fallback_used",
                    "actual": fallback_used,
                    "expected_max": max_fallback_used,
                }
            )

    if failures:
        gate["status"] = "failed"
        gate["passed"] = False
        gate["failures"] = failures
        gate["reason"] = "quality gate conditions were not met"
        return gate

    gate["status"] = "passed"
    gate["reason"] = "quality gate conditions satisfied"
    return gate


def _daily_trusted_ingest_pipeline(args: dict, conn: sqlite3.Connection) -> dict:
    listing_page_urls = [str(value).strip() for value in args.get("listing_page_urls", []) or [] if str(value).strip()]
    search_queries = [str(value).strip() for value in args.get("search_queries", []) or [] if str(value).strip()]
    if not listing_page_urls and not search_queries:
        return {"error": "listing_page_urls or search_queries is required"}

    allowed_domains = [_normalize_domain(value) for value in args.get("allowed_domains", []) or []]
    allowed_domains = [value for value in allowed_domains if value]
    if not allowed_domains:
        allowed_domains = sorted({_normalize_domain(url) for url in listing_page_urls if _normalize_domain(url)})
    if search_queries and not allowed_domains:
        return {"error": "allowed_domains is required when search_queries are provided"}
    if len(allowed_domains) != 1:
        return {"error": "daily_trusted_ingest_pipeline currently supports exactly one domain per run"}

    dry_run = _coerce_bool(args.get("dry_run"), default=True)
    discovery_limit = int(args.get("candidate_limit_per_source", 20))
    review_recommendation_filter = [
        str(value).strip()
        for value in args.get("review_recommendation_filter", []) or [
            "approve_tier_a_auto",
            "already_covered",
        ]
        if str(value).strip()
    ]

    discovery_results = {
        "listing_pages": [],
        "search_queries": [],
    }
    for url in listing_page_urls:
        discovery_results["listing_pages"].append(
            _discover_source_candidates_from_page(
                {
                    "url": url,
                    "allowed_domains": allowed_domains,
                    "same_domain_only": args.get("same_domain_only", True),
                    "limit": discovery_limit,
                    "register_candidates": not dry_run,
                    "discovered_by": args.get("page_discovered_by", "daily_pipeline_page"),
                    "discovery_query": args.get("discovery_query") or url,
                    "file_types": args.get("file_types"),
                },
                conn,
            )
        )
    for query in search_queries:
        discovery_results["search_queries"].append(
            _discover_source_candidates_by_search(
                {
                    "query": query,
                    "allowed_domains": allowed_domains,
                    "limit": discovery_limit,
                    "register_candidates": not dry_run,
                    "discovered_by": args.get("search_discovered_by", "daily_pipeline_search"),
                    "file_types": args.get("file_types"),
                },
                conn,
            )
        )

    review_filters = {
        "review_status": "pending",
        "domain": allowed_domains[0],
        "limit": int(args.get("review_limit", 50)),
        "include_markdown": _coerce_bool(args.get("include_markdown"), default=True),
    }
    review_report = _review_source_candidates_report(review_filters, conn)

    bulk_review_result = _bulk_review_source_candidates(
        {
            "review_status": "pending",
            "domain": review_filters.get("domain"),
            "limit": int(args.get("review_limit", 50)),
            "recommendation_filter": review_recommendation_filter,
            "mark_already_covered": args.get("mark_already_covered", True),
            "owner_note": args.get("owner_note"),
            "dry_run": dry_run,
            "include_markdown": False,
        },
        conn,
    )

    ingest_eval_result = _ingest_and_eval_trusted_candidates(
        {
            "candidate_review_status": "approved",
            "domain": review_filters.get("domain"),
            "limit": int(args.get("ingest_limit", 50)),
            "max_text_length": args.get("max_text_length", 8000),
            "index_embeddings": args.get("index_embeddings", DEFAULT_INDEX_EMBEDDINGS),
            "reindex_if_exists": args.get("reindex_if_exists", False),
            "discovery_query": args.get("discovery_query"),
            "questions_path": args.get("questions_path"),
            "output_json_path": args.get("output_json_path"),
            "output_md_path": args.get("output_md_path"),
            "eval_sample": args.get("eval_sample"),
            "provider": args.get("provider"),
            "model": args.get("model"),
            "mode": args.get("mode", "hybrid"),
            "eval_limit": args.get("eval_limit", 2),
            "max_output_tokens": args.get("max_output_tokens", 240),
            "temperature": args.get("temperature", 0.1),
            "citation_retry_limit": args.get("citation_retry_limit"),
            "write_eval_files": args.get("write_eval_files", not dry_run),
            "skip_eval_on_ingest_error": args.get("skip_eval_on_ingest_error", True),
            "dry_run": dry_run,
        },
        conn,
    )

    pipeline_result = {
        "generated_at": datetime.now().isoformat(),
        "dry_run": dry_run,
        "config": {
            "allowed_domains": allowed_domains,
            "listing_page_urls": listing_page_urls,
            "search_queries": search_queries,
            "candidate_limit_per_source": discovery_limit,
            "review_recommendation_filter": review_recommendation_filter,
        },
        "discovery": discovery_results,
        "review_report_summary": review_report["summary"],
        "bulk_review": bulk_review_result,
        "ingest_and_eval": ingest_eval_result,
    }
    quality_gate = _evaluate_pipeline_quality_gate(args, ingest_eval_result, dry_run)
    pipeline_result["quality_gate"] = quality_gate
    pipeline_result["status"] = "dry_run" if dry_run else "completed"
    if quality_gate["status"] == "failed":
        pipeline_result["status"] = "quality_gate_failed"
        pipeline_result["error"] = "quality gate failed"
    if _coerce_bool(args.get("include_markdown"), default=True) and review_report.get("report_markdown"):
        pipeline_result["review_report_markdown"] = review_report["report_markdown"]

    if not dry_run and _coerce_bool(args.get("write_log_file"), default=True):
        log_path = Path(str(args.get("pipeline_output_json_path") or DEFAULT_PIPELINE_LOG_FILE))
        log_path.parent.mkdir(parents=True, exist_ok=True)
        log_path.write_text(
            json.dumps(pipeline_result, ensure_ascii=False, indent=2, default=str) + "\n",
            encoding="utf-8",
        )
        pipeline_result["pipeline_output_json_path"] = str(log_path)
    return pipeline_result


def _register_source_policy(args: dict, conn: sqlite3.Connection) -> dict:
    result = _upsert_source_policy_record(
        conn,
        domain=args["domain"],
        allowed_path_regex=args["allowed_path_regex"],
        trust_tier=args["trust_tier"],
        auto_ingest=_coerce_bool(args.get("auto_ingest"), default=args["trust_tier"] == "tier_a_auto"),
        allowed_mime_types=args.get("allowed_mime_types"),
        extract_strategy=args.get("extract_strategy"),
        review_status=args.get("review_status"),
        owner_note=args.get("owner_note"),
    )
    conn.commit()
    return result


def _list_source_policies(args: dict, conn: sqlite3.Connection) -> dict:
    query = "SELECT * FROM source_policies"
    conditions: list[str] = []
    params: list[Any] = []
    if args.get("domain"):
        conditions.append("domain = ?")
        params.append(_normalize_domain(args["domain"]))
    if args.get("trust_tier") and args["trust_tier"] != "all":
        conditions.append("trust_tier = ?")
        params.append(args["trust_tier"])
    if args.get("review_status") and args["review_status"] != "all":
        conditions.append("review_status = ?")
        params.append(args["review_status"])
    if args.get("auto_ingest") is not None:
        conditions.append("auto_ingest = ?")
        params.append(1 if _coerce_bool(args.get("auto_ingest")) else 0)
    if conditions:
        query += " WHERE " + " AND ".join(conditions)
    query += " ORDER BY auto_ingest DESC, updated_at DESC LIMIT ?"
    params.append(int(args.get("limit", 50)))
    rows = conn.execute(query, params).fetchall()
    return {
        "count": len(rows),
        "policies": [_hydrate_source_policy(row) for row in rows],
    }


def _policy_match_sort_key(policy: dict[str, Any]) -> tuple[int, int, int, str]:
    return (
        0 if policy.get("trust_tier") == "tier_c_block" else 1,
        0 if policy.get("auto_ingest") else 1,
        -len(str(policy.get("allowed_path_regex", ""))),
        str(policy.get("allowed_path_regex", "")),
    )


def _evaluate_source_policy_for_url(conn: sqlite3.Connection, url: str) -> dict[str, Any]:
    normalized_url = str(url).strip()
    domain = _normalize_domain(normalized_url)
    path = urlparse(normalized_url).path or "/"
    if not domain:
        return {
            "url": normalized_url,
            "decision": "invalid_url",
            "matched_policies": [],
            "policy_count": 0,
            "matched_count": 0,
            "reason": "URL must include a valid domain",
        }

    policy_rows = conn.execute(
        "SELECT * FROM source_policies WHERE domain = ? ORDER BY updated_at DESC",
        (domain,),
    ).fetchall()
    matched_policies: list[dict[str, Any]] = []
    invalid_policies: list[dict[str, Any]] = []
    for row in policy_rows:
        policy = _hydrate_source_policy(row)
        regex = str(policy.get("allowed_path_regex", ""))
        try:
            if re.search(regex, path):
                matched_policies.append(policy)
        except re.error as exc:
            policy["regex_error"] = str(exc)
            invalid_policies.append(policy)

    matched_policies.sort(key=_policy_match_sort_key)
    effective_policy = matched_policies[0] if matched_policies else None

    active_matched = [policy for policy in matched_policies if policy.get("review_status") != "deprecated"]
    blocking_policy = next((policy for policy in active_matched if policy.get("trust_tier") == "tier_c_block"), None)
    auto_policy = next(
        (
            policy for policy in active_matched
            if policy.get("review_status") == "approved" and policy.get("auto_ingest")
        ),
        None,
    )
    review_policy = next((policy for policy in active_matched if policy.get("review_status") == "approved"), None)

    if blocking_policy:
        decision = "blocked"
        effective_policy = blocking_policy
        reason = "Matched a blocking policy"
    elif auto_policy:
        decision = "allow_auto_ingest"
        effective_policy = auto_policy
        reason = "Matched an approved auto-ingest policy"
    elif review_policy:
        decision = "review_required"
        effective_policy = review_policy
        reason = "Matched a policy, but auto_ingest is disabled"
    elif matched_policies:
        decision = "policy_inactive"
        reason = "Matched only paused or deprecated policies"
    elif policy_rows:
        decision = "no_matching_policy"
        reason = "Domain has policies, but path did not match"
    else:
        decision = "no_policy"
        reason = "No source policy registered for this domain"

    existing_candidate = conn.execute(
        "SELECT * FROM source_candidates WHERE candidate_url = ?",
        (normalized_url,),
    ).fetchone()

    return {
        "url": normalized_url,
        "domain": domain,
        "path": path,
        "decision": decision,
        "reason": reason,
        "policy_count": len(policy_rows),
        "matched_count": len(matched_policies),
        "effective_policy": effective_policy,
        "matched_policies": matched_policies,
        "invalid_policies": invalid_policies,
        "existing_candidate": _hydrate_source_candidate(existing_candidate) if existing_candidate else None,
    }


def _mime_type_matches_policy(policy: dict[str, Any], result: dict[str, Any]) -> bool:
    allowed_values = [value.lower() for value in policy.get("allowed_mime_types", []) if str(value).strip()]
    if not allowed_values:
        return True

    content_type = str(result.get("content_type", "")).lower().split(";", 1)[0].strip()
    file_type = str(result.get("file_type", "")).lower().strip()
    aliases = {
        "pdf": "application/pdf",
        "html": "text/html",
        "csv": "text/csv",
        "excel": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }

    candidates = {file_type, content_type}
    if file_type in aliases:
        candidates.add(aliases[file_type])

    for allowed in allowed_values:
        if "/" in allowed:
            if any(candidate and candidate.startswith(allowed) for candidate in candidates):
                return True
        else:
            if allowed in candidates:
                return True
    return False


def _check_source_policy(args: dict, conn: sqlite3.Connection) -> dict:
    evaluation = _evaluate_source_policy_for_url(conn, args["url"])
    if evaluation.get("effective_policy"):
        evaluation["effective_policy"] = dict(evaluation["effective_policy"])
    return evaluation


def _crawl_trusted_url(args: dict, conn: sqlite3.Connection) -> dict:
    url = str(args["url"]).strip()
    evaluation = _evaluate_source_policy_for_url(conn, url)
    if evaluation["decision"] != "allow_auto_ingest":
        response = {
            "error": f"trusted crawl denied: {evaluation['decision']}",
            "policy_check": evaluation,
        }
        if args.get("register_candidate_if_denied"):
            candidate_result = _register_source_candidate(
                {
                    "candidate_url": url,
                    "discovered_by": args.get("discovered_by", "trusted_gate"),
                    "discovery_query": args.get("discovery_query"),
                    "review_note": f"Auto-registered after trusted crawl denial: {evaluation['decision']}",
                },
                conn,
            )
            response["candidate_registration"] = candidate_result
        return response

    result = _detect_and_extract(url)
    final_url = str(result.get("url", url)).strip() or url
    final_evaluation = _evaluate_source_policy_for_url(conn, final_url)
    if final_evaluation["decision"] != "allow_auto_ingest":
        response = {
            "error": f"trusted crawl denied after redirect: {final_evaluation['decision']}",
            "policy_check": final_evaluation,
            "requested_url": url,
            "final_url": final_url,
        }
        if args.get("register_candidate_if_denied"):
            candidate_result = _register_source_candidate(
                {
                    "candidate_url": final_url,
                    "title": result.get("title"),
                    "publisher": result.get("publisher"),
                    "file_type": result.get("file_type"),
                    "discovered_by": args.get("discovered_by", "trusted_gate"),
                    "discovery_query": args.get("discovery_query"),
                    "review_note": f"Redirect target denied by trusted crawl: {final_evaluation['decision']}",
                },
                conn,
            )
            response["candidate_registration"] = candidate_result
        return response

    effective_policy = final_evaluation.get("effective_policy") or evaluation.get("effective_policy")
    if effective_policy and not _mime_type_matches_policy(effective_policy, result):
        return {
            "error": "trusted crawl denied: fetched MIME type does not match policy",
            "policy_check": final_evaluation,
            "fetched_content_type": result.get("content_type"),
            "fetched_file_type": result.get("file_type"),
        }

    indexing_summary = _reindex_document(
        conn,
        source_url=final_url,
        result=result,
        replace_existing=bool(args.get("reindex_if_exists", False)),
    )

    embedding_summary = {
        "status": "skipped",
        "document_id": indexing_summary["document_id"],
        "reason": "index_embeddings disabled",
    }
    if args.get("index_embeddings", DEFAULT_INDEX_EMBEDDINGS):
        try:
            embedding_summary = _index_embeddings_for_document(
                conn,
                indexing_summary["document_id"],
                force=bool(args.get("reindex_if_exists", False)),
            )
        except Exception as exc:
            embedding_summary = {
                "status": "error",
                "document_id": indexing_summary["document_id"],
                "error": str(exc),
            }

    response = _truncate_result_text(result, args.get("max_text_length", 8000))
    response.update({
        "document_id": indexing_summary["document_id"],
        "indexed_chunk_count": indexing_summary["chunk_count"],
        "replaced_documents": indexing_summary["deleted_documents"],
        "reused_existing": indexing_summary.get("reused_existing", False),
        "embedding_index": embedding_summary,
        "trusted_policy": effective_policy,
        "policy_check": final_evaluation,
        "requested_url": url,
        "final_url": final_url,
    })
    return response


def _approve_source_candidate(args: dict, conn: sqlite3.Connection) -> dict:
    candidate_row = None
    if args.get("candidate_id") is not None:
        candidate_row = conn.execute(
            "SELECT * FROM source_candidates WHERE id = ?",
            (int(args["candidate_id"]),),
        ).fetchone()
    elif args.get("candidate_url"):
        candidate_row = conn.execute(
            "SELECT * FROM source_candidates WHERE candidate_url = ?",
            (str(args["candidate_url"]).strip(),),
        ).fetchone()
    else:
        return {"error": "candidate_id or candidate_url is required"}

    if not candidate_row:
        return {"error": "source candidate not found"}

    candidate = _hydrate_source_candidate(candidate_row)
    trust_tier = str(args.get("trust_tier", "tier_b_review")).strip()
    review_status = "blocked" if trust_tier == "tier_c_block" else "approved"
    auto_ingest = _coerce_bool(args.get("auto_ingest"), default=trust_tier == "tier_a_auto")
    allowed_path_regex = args.get("allowed_path_regex") or _derive_allowed_path_regex(candidate["candidate_url"])

    policy_result = _upsert_source_policy_record(
        conn,
        domain=candidate["domain"],
        allowed_path_regex=allowed_path_regex,
        trust_tier=trust_tier,
        auto_ingest=auto_ingest,
        allowed_mime_types=args.get("allowed_mime_types") or ([candidate["file_type"]] if candidate.get("file_type") else None),
        extract_strategy=args.get("extract_strategy"),
        review_status="approved",
        owner_note=args.get("owner_note"),
    )

    now = datetime.now().isoformat()
    review_note = args.get("owner_note") or candidate.get("review_note")
    conn.execute(
        """UPDATE source_candidates
           SET review_status = ?, review_note = ?, reviewed_at = ?, updated_at = ?
           WHERE id = ?""",
        (review_status, review_note, now, now, int(candidate["id"])),
    )
    conn.commit()

    approved_candidate = conn.execute(
        "SELECT * FROM source_candidates WHERE id = ?",
        (int(candidate["id"]),),
    ).fetchone()
    return {
        "status": "approved",
        "candidate": _hydrate_source_candidate(approved_candidate),
        "policy": policy_result["policy"],
        "policy_status": policy_result["status"],
    }


def _search_flows(args: dict, conn: sqlite3.Connection) -> dict:
    query = """SELECT e.id, e.source_id, s.name as source_name, e.target_id, t.name as target_name,
               e.category, e.sub_category, e.value_usd, e.value_jpy,
               e.fiscal_year, e.confidence, e.source_dataset, e.description
        FROM edges e JOIN nodes s ON e.source_id = s.id JOIN nodes t ON e.target_id = t.id"""
    conditions, params = [], []
    if args.get("source_id"):
        conditions.append("e.source_id LIKE ?"); params.append(f"%{args['source_id']}%")
    if args.get("target_id"):
        conditions.append("e.target_id LIKE ?"); params.append(f"%{args['target_id']}%")
    if args.get("category"):
        conditions.append("e.category = ?"); params.append(args["category"])
    if args.get("fiscal_year"):
        conditions.append("e.fiscal_year = ?"); params.append(args["fiscal_year"])
    if args.get("keyword"):
        kw = f"%{args['keyword']}%"
        conditions.append("(e.source_dataset LIKE ? OR e.description LIKE ? OR s.name LIKE ? OR t.name LIKE ?)")
        params.extend([kw, kw, kw, kw])
    if conditions:
        query += " WHERE " + " AND ".join(conditions)
    limit = args.get("limit", 50)
    query += f" ORDER BY e.value_usd DESC LIMIT {limit}"
    rows = rows_to_dicts(conn.execute(query, params).fetchall())
    for r in rows:
        if r.get("value_jpy"):
            r["amount_oku_yen"] = round(r["value_jpy"] / 1e8, 1)
    return {"count": len(rows), "flows": rows}


def _store_flow(args: dict, conn: sqlite3.Connection) -> dict:
    _ensure_node(conn, args["source_id"], args["source_name"], args.get("source_type", "ministry"))
    _ensure_node(conn, args["target_id"], args["target_name"], args.get("target_type", "recipient"))
    amount_oku = args["amount_oku_yen"]
    value_jpy = amount_oku * 1e8
    value_usd = value_jpy / JPY_PER_USD
    fiscal_year = args["fiscal_year"]
    confidence = args.get("confidence", 0.9)
    
    # Validation & YoY Check
    validation_status = "passed"
    validation_note = None
    
    prev_year_flow = conn.execute(
        """SELECT value_jpy FROM edges 
           WHERE source_id = ? AND target_id = ? AND fiscal_year = ?""",
        (args["source_id"], args["target_id"], fiscal_year - 1)
    ).fetchone()
    
    if prev_year_flow:
        prev_jpy = prev_year_flow["value_jpy"]
        if prev_jpy > 0:
            change_ratio = value_jpy / prev_jpy
            if change_ratio > 1.5 or change_ratio < 0.5:
                validation_status = "warning"
                validation_note = f"前年度比 {(change_ratio*100):.1f}%。急激な変動または抽出ミスの可能性があります。"
    
    if confidence < 0.7:
        validation_status = "warning"
        if not validation_note:
            validation_note = "LLM抽出の信頼度が低いです(0.7未満)。"

    # NOTE: In a real system we might have a 'status' column in edges, 
    # but for now we append the warning to the description.
    final_desc = args.get("description", "")
    if validation_status == "warning":
        final_desc = f"[WARNING: {validation_note}] " + final_desc
    
    cursor = conn.execute(
        """INSERT INTO edges (source_id, target_id, category, sub_category,
           value_usd, value_jpy, fiscal_year, confidence, source_dataset, description)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (args["source_id"], args["target_id"], args["category"], args.get("sub_category"),
         value_usd, value_jpy, fiscal_year, confidence,
         args.get("source_dataset", "mcp_agent"), final_desc))
    
    edge_id = cursor.lastrowid
    provenance_url = args.get("provenance_url", args.get("source_dataset", "unknown"))
    
    conn.execute(
        """INSERT INTO source_provenance 
           (edge_id, source_url, source_title, page_number, extracted_text, extraction_method, confidence)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (edge_id, provenance_url, args.get("provenance_title", args.get("source_dataset")),
         args.get("provenance_page"), args.get("evidence_text"), "mcp_agent", confidence))
    
    conn.commit()
    return {
        "status": "created", 
        "edge_id": edge_id,
        "flow": f"{args['source_name']} → {args['target_name']}: {amount_oku}億円",
        "fiscal_year": fiscal_year,
        "validation_status": validation_status,
        "validation_note": validation_note
    }


def _ensure_node(conn, node_id, name, node_type):
    if not conn.execute("SELECT id FROM nodes WHERE id = ?", (node_id,)).fetchone():
        conn.execute("INSERT INTO nodes (id, name, type, dataset) VALUES (?, ?, ?, ?)",
                     (node_id, name, node_type, "mcp_agent"))


def _store_node(args: dict, conn: sqlite3.Connection) -> dict:
    existing = conn.execute("SELECT id, name FROM nodes WHERE id = ?", (args["id"],)).fetchone()
    if existing:
        return {"status": "exists", "id": args["id"], "name": dict(existing)["name"]}
    conn.execute(
        "INSERT INTO nodes (id, name, name_en, type, lat, lng, region, dataset) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (args["id"], args["name"], args.get("name_en"), args["type"],
         args.get("lat"), args.get("lng"), args.get("region"), "mcp_agent"))
    conn.commit()
    return {"status": "created", "id": args["id"], "name": args["name"]}


def _list_nodes(args: dict, conn: sqlite3.Connection) -> dict:
    query = "SELECT id, name, name_en, type, region, dataset FROM nodes"
    conditions, params = [], []
    if args.get("type"):
        conditions.append("type = ?"); params.append(args["type"])
    if args.get("keyword"):
        kw = f"%{args['keyword']}%"
        conditions.append("(name LIKE ? OR name_en LIKE ? OR id LIKE ?)")
        params.extend([kw, kw, kw])
    if conditions:
        query += " WHERE " + " AND ".join(conditions)
    query += f" ORDER BY type, name LIMIT {args.get('limit', 100)}"
    return {"count": len(rows := rows_to_dicts(conn.execute(query, params).fetchall())), "nodes": rows}


def _get_provenance(args: dict, conn: sqlite3.Connection) -> dict:
    if args.get("edge_id"):
        where, params = "p.edge_id = ?", [args["edge_id"]]
    elif args.get("source_id") and args.get("target_id"):
        where, params = "e.source_id = ? AND e.target_id = ?", [args["source_id"], args["target_id"]]
    elif args.get("source_id"):
        where, params = "e.source_id LIKE ?", [f"%{args['source_id']}%"]
    else:
        return {"error": "edge_id or source_id required"}
    rows = rows_to_dicts(conn.execute(
        f"""SELECT p.*, e.source_id, e.target_id, e.value_jpy, e.fiscal_year
            FROM source_provenance p JOIN edges e ON p.edge_id = e.id WHERE {where} LIMIT 20""", params
    ).fetchall())
    return {"count": len(rows), "provenance": rows}


def _get_db_summary(conn: sqlite3.Connection) -> dict:
    s = {}
    s["total_nodes"] = conn.execute("SELECT COUNT(*) FROM nodes").fetchone()[0]
    s["total_edges"] = conn.execute("SELECT COUNT(*) FROM edges").fetchone()[0]
    s["total_sources"] = conn.execute("SELECT COUNT(*) FROM data_sources").fetchone()[0]
    s["total_provenance"] = conn.execute("SELECT COUNT(*) FROM source_provenance").fetchone()[0]
    s["total_crawl_documents"] = conn.execute("SELECT COUNT(*) FROM crawl_documents").fetchone()[0]
    s["total_document_chunks"] = conn.execute("SELECT COUNT(*) FROM document_chunks").fetchone()[0]
    s["total_chunk_embeddings"] = conn.execute("SELECT COUNT(*) FROM chunk_embeddings").fetchone()[0]
    try:
        s["total_crawl_routes"] = conn.execute("SELECT COUNT(*) FROM crawl_routes").fetchone()[0]
    except Exception:
        s["total_crawl_routes"] = 0
    try:
        s["total_source_candidates"] = conn.execute("SELECT COUNT(*) FROM source_candidates").fetchone()[0]
        s["total_source_policies"] = conn.execute("SELECT COUNT(*) FROM source_policies").fetchone()[0]
    except Exception:
        s["total_source_candidates"] = 0
        s["total_source_policies"] = 0
    try:
        s["total_budget_highlights"] = conn.execute("SELECT COUNT(*) FROM budget_highlights").fetchone()[0]
    except Exception:
        s["total_budget_highlights"] = 0
    try:
        s["total_knowledge_notes"] = conn.execute("SELECT COUNT(*) FROM knowledge_notes").fetchone()[0]
        s["total_structured_facts"] = conn.execute("SELECT COUNT(*) FROM structured_facts").fetchone()[0]
        s["total_source_link_health"] = conn.execute("SELECT COUNT(*) FROM source_link_health").fetchone()[0]
    except Exception:
        s["total_knowledge_notes"] = 0
        s["total_structured_facts"] = 0
        s["total_source_link_health"] = 0
    s["nodes_by_type"] = {r["type"]: r["count"] for r in conn.execute(
        "SELECT type, COUNT(*) as count FROM nodes GROUP BY type ORDER BY count DESC").fetchall()}
    s["edges_by_category"] = {r["category"]: {"count": r["count"], "total_oku_yen": round(r["total_jpy"] / 1e8, 0) if r["total_jpy"] else 0}
        for r in conn.execute("SELECT category, COUNT(*) as count, SUM(value_jpy) as total_jpy FROM edges GROUP BY category ORDER BY total_jpy DESC").fetchall()}
    s["edges_by_year"] = {str(r["fiscal_year"]): r["count"] for r in conn.execute(
        "SELECT fiscal_year, COUNT(*) as count FROM edges GROUP BY fiscal_year ORDER BY fiscal_year").fetchall()}
    return s


# ─── Smart Crawl implementations ───

def _crawl_url(args: dict, conn: sqlite3.Connection) -> dict:
    url = args["url"]
    result = _detect_and_extract(url)
    indexing_summary = _reindex_document(
        conn,
        source_url=url,
        result=result,
        replace_existing=bool(args.get("reindex_if_exists", False)),
    )

    embedding_summary = {
        "status": "skipped",
        "document_id": indexing_summary["document_id"],
        "reason": "index_embeddings disabled",
    }
    if args.get("index_embeddings", DEFAULT_INDEX_EMBEDDINGS):
        try:
            embedding_summary = _index_embeddings_for_document(
                conn,
                indexing_summary["document_id"],
                force=bool(args.get("reindex_if_exists", False)),
            )
        except Exception as exc:
            embedding_summary = {
                "status": "error",
                "document_id": indexing_summary["document_id"],
                "error": str(exc),
            }

    response = _truncate_result_text(result, args.get("max_text_length", 8000))
    response.update({
        "document_id": indexing_summary["document_id"],
        "indexed_chunk_count": indexing_summary["chunk_count"],
        "replaced_documents": indexing_summary["deleted_documents"],
        "reused_existing": indexing_summary.get("reused_existing", False),
        "embedding_index": embedding_summary,
    })
    return response


def _register_crawl_route(args: dict, conn: sqlite3.Connection) -> dict:
    route_id = args["route_id"]
    
    existing = conn.execute("SELECT route_id FROM crawl_routes WHERE route_id = ?", (route_id,)).fetchone()
    if existing:
        # Update existing route
        conn.execute(
            """UPDATE crawl_routes SET url = ?, name = ?, file_type = ?, 
               extraction_config = ?, table_path = ?, sample_data = ?, last_values = ?,
               updated_at = ?, status = 'verified'
               WHERE route_id = ?""",
            (args["url"], args["name"], args["file_type"],
             args.get("extraction_config"), args.get("table_path"),
             args.get("sample_data"), args.get("last_values"),
             datetime.now().isoformat(), route_id))
        conn.commit()
        return {"status": "updated", "route_id": route_id}
    
    conn.execute(
        """INSERT INTO crawl_routes (route_id, source_id, name, url, file_type, 
           extraction_config, table_path, sample_data, last_values)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (route_id, args.get("source_id"), args["name"], args["url"], args["file_type"],
         args.get("extraction_config"), args.get("table_path"),
         args.get("sample_data"), args.get("last_values")))
    conn.commit()
    return {"status": "created", "route_id": route_id}


def _list_crawl_routes(args: dict, conn: sqlite3.Connection) -> dict:
    query = """SELECT route_id, source_id, name, url, file_type, extraction_config, 
               table_path, status, last_crawled_at, crawl_count, created_at FROM crawl_routes"""
    conditions, params = [], []
    if args.get("source_id"):
        conditions.append("source_id = ?"); params.append(args["source_id"])
    if args.get("status") and args["status"] != "all":
        conditions.append("status = ?"); params.append(args["status"])
    if conditions:
        query += " WHERE " + " AND ".join(conditions)
    query += " ORDER BY updated_at DESC"
    rows = rows_to_dicts(conn.execute(query, params).fetchall())
    return {"count": len(rows), "routes": rows}


def _recrawl_route(args: dict, conn: sqlite3.Connection) -> dict:
    route_id = args["route_id"]
    route = conn.execute(
        "SELECT * FROM crawl_routes WHERE route_id = ?", (route_id,)
    ).fetchone()
    
    if not route:
        return {"error": f"Route not found: {route_id}"}
    
    route_dict = dict(route)
    url = route_dict["url"]
    
    # Crawl the URL
    result = _detect_and_extract(url)
    indexing_summary = _reindex_document(
        conn,
        source_url=url,
        result=result,
        replace_existing=True,
    )
    embedding_summary = {
        "status": "skipped",
        "document_id": indexing_summary["document_id"],
        "reason": "index_embeddings disabled",
    }
    if args.get("index_embeddings", DEFAULT_INDEX_EMBEDDINGS):
        try:
            embedding_summary = _index_embeddings_for_document(
                conn,
                indexing_summary["document_id"],
                force=True,
            )
        except Exception as exc:
            embedding_summary = {
                "status": "error",
                "document_id": indexing_summary["document_id"],
                "error": str(exc),
            }
    
    # Compare with last values
    diff_info = None
    if route_dict.get("last_values"):
        try:
            old_values = json.loads(route_dict["last_values"])
            diff_info = {"previous_values": old_values, "note": "Compare with current extraction results"}
        except json.JSONDecodeError:
            diff_info = {"previous_raw": route_dict["last_values"]}
    
    # Update route metadata
    conn.execute(
        """UPDATE crawl_routes SET last_crawled_at = ?, crawl_count = crawl_count + 1, updated_at = ?
           WHERE route_id = ?""",
        (datetime.now().isoformat(), datetime.now().isoformat(), route_id))
    conn.commit()
    
    response = _truncate_result_text(result, args.get("max_text_length", 8000))
    response["route_id"] = route_id
    response["route_name"] = route_dict["name"]
    response["extraction_config"] = route_dict.get("extraction_config")
    response["table_path"] = route_dict.get("table_path")
    response["crawl_count"] = (route_dict.get("crawl_count") or 0) + 1
    response["document_id"] = indexing_summary["document_id"]
    response["indexed_chunk_count"] = indexing_summary["chunk_count"]
    response["replaced_documents"] = indexing_summary["deleted_documents"]
    response["reused_existing"] = indexing_summary.get("reused_existing", False)
    response["embedding_index"] = embedding_summary
    if diff_info:
        response["previous_data"] = diff_info
    
    return response


def _search_documents(args: dict, conn: sqlite3.Connection) -> dict:
    query = args["query"]
    limit = args.get("limit", 10)
    mode = args.get("mode", "hybrid")
    document_id = args.get("document_id")

    if not query.strip():
        return {"error": "Empty query"}

    lexical_results: list[dict[str, Any]] = []
    semantic_results: list[dict[str, Any]] = []
    warnings: list[str] = []

    try:
        if mode in {"lexical", "hybrid"}:
            lexical_results = _run_lexical_search(conn, query, max(limit, LEXICAL_TOP_K), document_id=document_id)
            lexical_results = _deduplicate_ranked_results(lexical_results)

        if mode in {"semantic", "hybrid"}:
            try:
                semantic_results = _run_semantic_search(conn, query, max(limit, SEMANTIC_TOP_K), document_id=document_id)
                semantic_results = _deduplicate_ranked_results(semantic_results)
            except Exception as exc:
                warnings.append(f"semantic search unavailable: {exc}")
                if mode == "semantic":
                    semantic_results = []

        if mode == "lexical":
            results = _finalize_ranked_results(lexical_results, limit)
        elif mode == "semantic":
            results = _finalize_ranked_results(semantic_results, limit)
        else:
            if semantic_results:
                results = _finalize_ranked_results(
                    _fuse_search_results(lexical_results, semantic_results, limit),
                    limit,
                )
            else:
                results = _finalize_ranked_results(lexical_results, limit)
                if warnings:
                    warnings.append("hybrid search fell back to lexical results")

        response: dict[str, Any] = {
            "count": len(results),
            "results": results,
            "query": query,
            "mode": mode,
            "document_id": document_id,
        }
        if warnings:
            response["warnings"] = warnings
        return response
    except Exception as e:
        return {"error": f"Search failed: {e}", "query": query, "mode": mode}


def _answer_documents(args: dict, conn: sqlite3.Connection) -> dict:
    search_response = _search_documents(
        {
            "query": args["query"],
            "limit": args.get("limit", 5),
            "mode": args.get("mode", "hybrid"),
            "document_id": args.get("document_id"),
        },
        conn,
    )
    if search_response.get("error"):
        return search_response

    max_context_chars = args.get("max_context_chars", ANSWER_CONTEXT_LIMIT)
    max_chunk_chars = args.get("max_chunk_chars", ANSWER_CHUNK_CHAR_LIMIT)
    search_results = search_response.get("results", [])
    chunk_rows = _fetch_chunk_context_rows(
        conn,
        [int(row["chunk_id"]) for row in search_results],
    )

    citations: list[dict[str, Any]] = []
    context_sections: list[str] = []
    used_chars = 0
    omitted_chunks = 0

    for index, row in enumerate(search_results, start=1):
        chunk = chunk_rows.get(int(row["chunk_id"]))
        if not chunk:
            continue

        trimmed_content = _trim_context_content(chunk["content"], max_chunk_chars)
        if max_context_chars > 0:
            remaining_chars = max_context_chars - used_chars
            if remaining_chars <= 0:
                omitted_chunks += 1
                continue
            if len(trimmed_content) > remaining_chars:
                if remaining_chars < 120:
                    omitted_chunks += 1
                    continue
                trimmed_content = _trim_context_content(trimmed_content, remaining_chars)

        citation_label = _format_citation_label(chunk, index)
        context_section = (
            f"{citation_label}\n"
            f"URL: {chunk['source_url']}\n"
            f"Mode: {row['retrieval_mode']}\n"
            f"Score: {row['score']}\n"
            f"Content:\n{trimmed_content}"
        )
        context_sections.append(context_section)
        used_chars += len(trimmed_content)

        citations.append(
            {
                "citation_id": f"[{index}]",
                "chunk_id": chunk["chunk_id"],
                "document_id": chunk["document_id"],
                "source_url": chunk["source_url"],
                "file_name": chunk["file_name"],
                "page_number": chunk["page_number"],
                "chunk_index": chunk["chunk_index"],
                "retrieval_mode": row["retrieval_mode"],
                "score": row["score"],
                "snippet": row["snippet"],
                "content": trimmed_content,
            }
        )

    context_text = "\n\n".join(context_sections)
    response: dict[str, Any] = {
        "query": search_response["query"],
        "mode": search_response["mode"],
        "document_id": search_response.get("document_id"),
        "search_count": search_response["count"],
        "citation_count": len(citations),
        "citations": citations,
        "context_text": context_text,
        "answer_prompt": _build_answer_prompt(search_response["query"], context_text) if context_text else "",
        "max_context_chars": max_context_chars,
        "max_chunk_chars": max_chunk_chars,
    }
    if omitted_chunks:
        response["omitted_chunks"] = omitted_chunks
    if search_response.get("warnings"):
        response["warnings"] = search_response["warnings"]
    if not citations:
        response["note"] = "No context chunks available for this query"
    return response


def _generate_document_answer(args: dict, conn: sqlite3.Connection) -> dict:
    context_pack = _answer_documents(args, conn)
    if context_pack.get("error"):
        return context_pack

    answer_prompt = context_pack.get("answer_prompt", "")
    if not answer_prompt:
        response = dict(context_pack)
        response["answer_generation"] = {
            "status": "skipped",
            "reason": "No answer prompt could be built from the current search results",
        }
        return response

    try:
        generation = _generate_answer_with_llm(
            answer_prompt,
            provider_override=args.get("provider"),
            model_override=args.get("model"),
            temperature=args.get("temperature"),
            max_output_tokens=args.get("max_output_tokens"),
        )
    except Exception as exc:
        generation = {
            "status": "error",
            "error": str(exc),
        }

    retry_limit = args.get("citation_retry_limit")
    if retry_limit is None:
        retry_limit = ANSWER_CITATION_RETRY_LIMIT
    retry_limit = max(0, int(retry_limit))

    if generation.get("status") == "generated":
        attempts = [{
            "attempt": 1,
            "prompt_kind": "initial",
            "has_citations": _answer_has_citation_markers(generation.get("answer", "")),
            "status": generation.get("status"),
        }]
        for retry_index in range(retry_limit):
            if attempts[-1]["has_citations"]:
                break
            try:
                generation = _generate_answer_with_llm(
                    _build_citation_retry_prompt(context_pack["query"], context_pack["context_text"]),
                    provider_override=args.get("provider"),
                    model_override=args.get("model"),
                    temperature=args.get("temperature"),
                    max_output_tokens=args.get("max_output_tokens"),
                )
            except Exception as exc:
                generation = {
                    "status": "error",
                    "error": str(exc),
                }
            attempts.append({
                "attempt": retry_index + 2,
                "prompt_kind": "citation_retry",
                "has_citations": _answer_has_citation_markers(generation.get("answer", "")) if generation.get("status") == "generated" else False,
                "status": generation.get("status"),
            })
            if generation.get("status") != "generated":
                break
        generation["citation_attempts"] = attempts

    response = dict(context_pack)
    response["answer_generation"] = generation
    if generation.get("status") == "generated":
        if not _answer_has_citation_markers(generation["answer"]):
            citation_suffix = _build_citation_suffix(context_pack.get("citations", []))
            if citation_suffix:
                generation["answer"] = _append_citation_suffix(generation["answer"], citation_suffix)
                generation["citation_fallback"] = "append_retrieved_citation_ids"
        if generation.get("citation_fallback"):
            fallback_result = _format_citation_fallback_answer(
                generation["answer"],
                max(1, ANSWER_CITATION_FALLBACK_MAX_SENTENCES),
                context_pack["query"],
                context_pack.get("citations", []),
            )
            generation["answer"] = fallback_result["answer"]
            generation["citation_fallback_format"] = {
                "style": "bullet_list",
                "max_sentences": max(1, ANSWER_CITATION_FALLBACK_MAX_SENTENCES),
                "selection": "prioritize_dynamic_focus_terms_and_numeric_sentences",
                "selected_count": fallback_result["selected_count"],
                "themes": fallback_result["themes"],
                "focus_terms": fallback_result["focus_terms"],
            }
        response["answer"] = generation["answer"]
        if not _answer_has_citation_markers(generation["answer"]):
            response.setdefault("warnings", []).append("Generated answer did not include citation markers like [1]")
        elif generation.get("citation_fallback"):
            response.setdefault("warnings", []).append("Citation markers were appended from retrieved context after the model omitted them")
    return response


def _index_document_embeddings(args: dict, conn: sqlite3.Connection) -> dict:
    force = bool(args.get("force", False))
    limit = args.get("limit", 20)

    if args.get("document_id") is not None:
        document_ids = [args["document_id"]]
    else:
        document_ids = [
            row["id"]
            for row in conn.execute(
                "SELECT id FROM crawl_documents ORDER BY id DESC LIMIT ?",
                (limit,),
            ).fetchall()
        ]

    summaries: list[dict[str, Any]] = []
    for document_id in document_ids:
        try:
            summaries.append(_index_embeddings_for_document(conn, document_id, force=force))
        except Exception as exc:
            summaries.append({
                "status": "error",
                "document_id": document_id,
                "error": str(exc),
            })

    return {
        "count": len(summaries),
        "results": summaries,
        "model_name": EMBEDDING_MODEL,
        "provider": EMBEDDING_PROVIDER,
    }


# ─── Entry point ───

async def main():
    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, server.create_initialization_options())

if __name__ == "__main__":
    import asyncio
    asyncio.run(main())
