"""
Database Initialization Script
================================
Creates the SQLite database with the approved schema:
  - nodes: Entity master (countries, corporations, recipients, etc.)
  - edges: Money flow records (source -> target with amounts)
  - data_sources: Registry of official data sources

Usage:
  python scripts/init_db.py
"""

import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(__file__), '../data/money_flow.db')

SCHEMA_SQL = """
-- ============================================================
-- Entity Master
-- ============================================================
CREATE TABLE IF NOT EXISTS nodes (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  name_en       TEXT,
  lat           REAL,
  lng           REAL,
  region        TEXT,
  type          TEXT NOT NULL,
  dataset       TEXT NOT NULL,
  created_at    TEXT DEFAULT (datetime('now'))
);

-- ============================================================
-- Money Flow Edges
-- ============================================================
CREATE TABLE IF NOT EXISTS edges (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id     TEXT NOT NULL REFERENCES nodes(id),
  target_id     TEXT NOT NULL REFERENCES nodes(id),
  category      TEXT NOT NULL,
  sub_category  TEXT,
  value_usd     REAL NOT NULL,
  value_jpy     REAL,
  fiscal_year   INTEGER NOT NULL,
  confidence    REAL DEFAULT 0.9,
  source_dataset TEXT NOT NULL,
  description   TEXT,
  created_at    TEXT DEFAULT (datetime('now'))
);

-- ============================================================
-- Data Source Registry (Enhanced for Pipeline)
-- ============================================================
CREATE TABLE IF NOT EXISTS data_sources (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id     TEXT UNIQUE,
  name          TEXT NOT NULL,
  name_ja       TEXT,
  agency_code   TEXT,
  url           TEXT,
  description   TEXT,
  data_format   TEXT,
  fiscal_years  TEXT,
  crawl_mode    TEXT DEFAULT 'http',
  crawl_frequency TEXT DEFAULT 'quarterly',
  priority      TEXT DEFAULT 'medium',
  last_crawled_at TEXT,
  created_at    TEXT DEFAULT (datetime('now'))
);

-- ============================================================
-- Source Provenance (出典管理)
-- ============================================================
CREATE TABLE IF NOT EXISTS source_provenance (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  edge_id       INTEGER REFERENCES edges(id),
  source_id     TEXT REFERENCES data_sources(source_id),
  source_url    TEXT NOT NULL,
  source_title  TEXT,
  page_number   INTEGER,
  extracted_text TEXT,
  extraction_method TEXT DEFAULT 'manual',
  confidence    REAL DEFAULT 0.9,
  verified_by   TEXT,
  extracted_at  TEXT DEFAULT (datetime('now')),
  created_at    TEXT DEFAULT (datetime('now'))
);

-- ============================================================
-- Crawl Jobs (クロールジョブ管理)
-- ============================================================
CREATE TABLE IF NOT EXISTS crawl_jobs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  crawl_job_id  TEXT UNIQUE NOT NULL,
  source_id     TEXT REFERENCES data_sources(source_id),
  target_url    TEXT NOT NULL,
  crawl_mode    TEXT DEFAULT 'http',
  max_depth     INTEGER DEFAULT 2,
  status        TEXT DEFAULT 'queued',
  discovered_documents INTEGER DEFAULT 0,
  error_message TEXT,
  started_at    TEXT,
  finished_at   TEXT,
  created_at    TEXT DEFAULT (datetime('now'))
);

-- ============================================================
-- Crawl Documents (クロールで発見した文書)
-- ============================================================
CREATE TABLE IF NOT EXISTS crawl_documents (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  crawl_job_id  TEXT REFERENCES crawl_jobs(crawl_job_id),
  file_name     TEXT,
  source_url    TEXT NOT NULL,
  mime_type     TEXT,
  content_hash  TEXT,
  content_preview TEXT,
  normalized_text TEXT,
  document_kind TEXT,
  crawl_depth   INTEGER DEFAULT 0,
  downloaded_at TEXT DEFAULT (datetime('now'))
);

-- ============================================================
-- Crawl Routes (検証済みクロールルート)
-- ============================================================
CREATE TABLE IF NOT EXISTS crawl_routes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  route_id      TEXT UNIQUE NOT NULL,
  source_id     TEXT REFERENCES data_sources(source_id),
  name          TEXT NOT NULL,
  url           TEXT NOT NULL,
  file_type     TEXT NOT NULL,
  extraction_config TEXT,
  table_path    TEXT,
  sample_data   TEXT,
  last_values   TEXT,
  status        TEXT DEFAULT 'verified',
  last_crawled_at TEXT,
  crawl_count   INTEGER DEFAULT 0,
  created_at    TEXT DEFAULT (datetime('now')),
  updated_at    TEXT DEFAULT (datetime('now'))
);

-- ============================================================
-- Document Chunks for Search (軽量RAG / FTS5)
-- ============================================================
CREATE TABLE IF NOT EXISTS document_chunks (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id   INTEGER REFERENCES crawl_documents(id) ON DELETE CASCADE,
  chunk_index   INTEGER NOT NULL,
  content       TEXT NOT NULL,
  page_number   INTEGER,
  created_at    TEXT DEFAULT (datetime('now'))
);

CREATE VIRTUAL TABLE IF NOT EXISTS document_chunks_fts USING fts5(
  content,
  document_id UNINDEXED,
  chunk_id UNINDEXED
);

-- トリガー：チャンク追加時にFTSにも自動追加
CREATE TRIGGER IF NOT EXISTS after_document_chunks_insert
AFTER INSERT ON document_chunks
BEGIN
  INSERT INTO document_chunks_fts(rowid, content, document_id, chunk_id)
  VALUES (new.id, new.content, new.document_id, new.id);
END;

CREATE TRIGGER IF NOT EXISTS after_document_chunks_delete
AFTER DELETE ON document_chunks
BEGIN
  DELETE FROM document_chunks_fts WHERE rowid = old.id;
END;

-- ============================================================
-- Chunk Embeddings
-- ============================================================
CREATE TABLE IF NOT EXISTS chunk_embeddings (
  chunk_id         INTEGER PRIMARY KEY REFERENCES document_chunks(id) ON DELETE CASCADE,
  model_name       TEXT NOT NULL,
  embedding_dim    INTEGER NOT NULL,
  embedding_blob   BLOB NOT NULL,
  content_hash     TEXT NOT NULL,
  created_at       TEXT DEFAULT (datetime('now')),
  updated_at       TEXT DEFAULT (datetime('now'))
);

-- ============================================================
-- Source Candidates / Policies
-- ============================================================
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

-- ============================================================
-- Budget Highlights (UI spotlight cards)
-- ============================================================
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

-- ============================================================
-- Indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_edges_source   ON edges(source_id);
CREATE INDEX IF NOT EXISTS idx_edges_target   ON edges(target_id);
CREATE INDEX IF NOT EXISTS idx_edges_year     ON edges(fiscal_year);
CREATE INDEX IF NOT EXISTS idx_edges_category ON edges(category);
CREATE INDEX IF NOT EXISTS idx_nodes_type     ON nodes(type);
CREATE INDEX IF NOT EXISTS idx_nodes_dataset  ON nodes(dataset);
CREATE INDEX IF NOT EXISTS idx_provenance_edge ON source_provenance(edge_id);
CREATE INDEX IF NOT EXISTS idx_provenance_src  ON source_provenance(source_id);
CREATE INDEX IF NOT EXISTS idx_crawl_status    ON crawl_jobs(status);
CREATE INDEX IF NOT EXISTS idx_crawl_docs_job  ON crawl_documents(crawl_job_id);
CREATE INDEX IF NOT EXISTS idx_document_chunks_doc ON document_chunks(document_id, chunk_index);
CREATE INDEX IF NOT EXISTS idx_chunk_embeddings_model ON chunk_embeddings(model_name);
CREATE INDEX IF NOT EXISTS idx_source_candidates_domain ON source_candidates(domain);
CREATE INDEX IF NOT EXISTS idx_source_candidates_status ON source_candidates(review_status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_source_policies_domain ON source_policies(domain);
CREATE INDEX IF NOT EXISTS idx_source_policies_status ON source_policies(review_status, auto_ingest, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_budget_highlights_entity_year ON budget_highlights(entity_id, fiscal_year, section_key, display_order);
"""

# Official data sources to register
DATA_SOURCES = [
    {
        "source_id": "imf_dots",
        "name": "IMF Direction of Trade Statistics (DOTS)",
        "name_ja": "IMF 貿易統計 (DOTS)",
        "agency_code": "IMF",
        "url": "https://data.imf.org/",
        "description": "Bilateral trade flows between countries",
        "data_format": "API/JSON",
        "fiscal_years": "2021,2022,2023,2024",
        "crawl_mode": "api",
        "crawl_frequency": "annually",
        "priority": "high"
    },
    {
        "source_id": "wb_remittance",
        "name": "World Bank - Personal Remittances",
        "name_ja": "世界銀行 個人送金統計",
        "agency_code": "WB",
        "url": "https://data.worldbank.org/indicator/BX.TRF.PWKR.CD.DT",
        "description": "Bilateral remittance flows",
        "data_format": "API/JSON",
        "fiscal_years": "2021,2022,2023,2024",
        "crawl_mode": "api",
        "crawl_frequency": "annually",
        "priority": "medium"
    },
    {
        "source_id": "boj_funds_flow",
        "name": "Bank of Japan - Flow of Funds",
        "name_ja": "日本銀行 資金循環統計",
        "agency_code": "BOJ",
        "url": "https://www.boj.or.jp/statistics/sj/index.htm",
        "description": "Macro financial flows: households, government, corporations",
        "data_format": "Excel/CSV",
        "fiscal_years": "2021,2022,2023,2024",
        "crawl_mode": "http",
        "crawl_frequency": "quarterly",
        "priority": "high"
    },
    {
        "source_id": "mof_budget",
        "name": "Ministry of Finance - General Account Budget",
        "name_ja": "財務省 一般会計予算",
        "agency_code": "MIN_MOF",
        "url": "https://www.mof.go.jp/policy/budget/",
        "description": "National budget revenue (taxes) and expenditure breakdown",
        "data_format": "PDF/Excel",
        "fiscal_years": "2021,2022,2023,2024",
        "crawl_mode": "http",
        "crawl_frequency": "annually",
        "priority": "critical"
    },
    {
        "source_id": "mext_budget",
        "name": "MEXT Budget Highlights",
        "name_ja": "文部科学省 予算のポイント",
        "agency_code": "MIN_MEXT",
        "url": "https://www.mext.go.jp/a_menu/yosan/index.htm",
        "description": "Major FY2024-FY2025 MEXT budget projects and budget highlights",
        "data_format": "PDF",
        "fiscal_years": "2024,2025",
        "crawl_mode": "http",
        "crawl_frequency": "annually",
        "priority": "high"
    },
    {
        "source_id": "mhlw_budget",
        "name": "MHLW Budget Overview",
        "name_ja": "厚生労働省 予算案の概要",
        "agency_code": "MIN_MHLW",
        "url": "https://www.mhlw.go.jp/wp/yosan/yosan/",
        "description": "Major FY2024-FY2025 MHLW budget programs and budget highlights",
        "data_format": "PDF",
        "fiscal_years": "2024,2025",
        "crawl_mode": "http",
        "crawl_frequency": "annually",
        "priority": "high"
    },
    {
        "source_id": "mlit_budget",
        "name": "MLIT Budget Overview",
        "name_ja": "国土交通省 予算概要",
        "agency_code": "MIN_MLIT",
        "url": "https://www.mlit.go.jp/page/content/001720593.pdf",
        "description": "Major FY2024 MLIT budget programs and budget highlights",
        "data_format": "PDF",
        "fiscal_years": "2024",
        "crawl_mode": "http",
        "crawl_frequency": "annually",
        "priority": "high"
    },
    {
        "source_id": "mhlw_medical",
        "name": "MHLW - National Medical Expenditure",
        "name_ja": "厚生労働省 国民医療費の概況",
        "agency_code": "MIN_MHLW",
        "url": "https://www.mhlw.go.jp/toukei/saikin/hw/k-iryohi/",
        "description": "Medical expenditure: inpatient, outpatient, dental, pharmacy",
        "data_format": "Excel",
        "fiscal_years": "2022",
        "crawl_mode": "http",
        "crawl_frequency": "annually",
        "priority": "high"
    },
    {
        "source_id": "mhlw_nursing",
        "name": "MHLW - Nursing Care Benefit Statistics",
        "name_ja": "厚生労働省 介護給付費等実態統計",
        "agency_code": "MIN_MHLW",
        "url": "https://www.mhlw.go.jp/toukei/saikin/hw/kaigo/kyufu/",
        "description": "Nursing care expenditure by service type",
        "data_format": "Excel",
        "fiscal_years": "2023",
        "crawl_mode": "http",
        "crawl_frequency": "annually",
        "priority": "high"
    },
    {
        "source_id": "cfa_budget",
        "name": "Children and Families Agency Budget",
        "name_ja": "こども家庭庁 予算概要",
        "agency_code": "MIN_CFA",
        "url": "https://www.cfa.go.jp/policies/budget/",
        "description": "Childcare: child allowance, nursery, birth support, universal childcare",
        "data_format": "PDF/HTML",
        "fiscal_years": "2024,2025",
        "crawl_mode": "http",
        "crawl_frequency": "annually",
        "priority": "critical"
    },
    {
        "source_id": "sangiin_social_security",
        "name": "Sangiin Budget Committee Research - Social Security",
        "name_ja": "参議院予算委員会調査室 社会保障関係予算",
        "agency_code": "SANGIIN",
        "url": "https://www.sangiin.go.jp/",
        "description": "National social security budget overview and breakdown",
        "data_format": "PDF",
        "fiscal_years": "2024",
        "crawl_mode": "http",
        "crawl_frequency": "annually",
        "priority": "high"
    },
    {
        "source_id": "ipss_social_security",
        "name": "IPSS - Social Security Expenditure Statistics",
        "name_ja": "国立社会保障・人口問題研究所 社会保障費用統計",
        "agency_code": "IPSS",
        "url": "https://www.ipss.go.jp/ss-cost/",
        "description": "ILO-standard social security benefit statistics",
        "data_format": "Excel/CSV",
        "fiscal_years": "2022",
        "crawl_mode": "http",
        "crawl_frequency": "annually",
        "priority": "medium"
    },
    {
        "source_id": "estat_api",
        "name": "e-Stat API",
        "name_ja": "政府統計の総合窓口 e-Stat",
        "agency_code": "MIC",
        "url": "https://www.e-stat.go.jp/api/",
        "description": "Portal for all Japanese government statistics",
        "data_format": "API/JSON/CSV",
        "fiscal_years": "2021,2022,2023,2024",
        "crawl_mode": "api",
        "crawl_frequency": "quarterly",
        "priority": "high"
    },
    # ── New Sources (Phase 1 additions) ──
    {
        "source_id": "njss_procurement",
        "name": "NJSS - Government Procurement Data",
        "name_ja": "NJSS 入札情報速報サービス",
        "agency_code": "NJSS",
        "url": "https://www.njss.info/",
        "description": "Government procurement: bid results, contract amounts, vendors",
        "data_format": "HTML",
        "fiscal_years": "2024,2025",
        "crawl_mode": "playwright",
        "crawl_frequency": "weekly",
        "priority": "high"
    },
    {
        "source_id": "mic_household",
        "name": "MIC - Family Income and Expenditure Survey",
        "name_ja": "総務省 家計調査",
        "agency_code": "MIC",
        "url": "https://www.stat.go.jp/data/kakei/",
        "description": "Household expenditure patterns: food, housing, transport, education",
        "data_format": "Excel/CSV",
        "fiscal_years": "2022,2023",
        "crawl_mode": "http",
        "crawl_frequency": "annually",
        "priority": "medium"
    },
    {
        "source_id": "meti_subsidies",
        "name": "METI - Subsidy and Tax Programs",
        "name_ja": "経産省 補助金・減税制度",
        "agency_code": "MIN_METI",
        "url": "https://www.meti.go.jp/",
        "description": "Corporate subsidies, R&D tax credits, regional grants",
        "data_format": "PDF/HTML",
        "fiscal_years": "2024",
        "crawl_mode": "http",
        "crawl_frequency": "annually",
        "priority": "medium"
    },
    {
        "source_id": "soumu_local_finance",
        "name": "MIC - Local Government Finance",
        "name_ja": "総務省 地方財政白書",
        "agency_code": "MIC",
        "url": "https://www.soumu.go.jp/menu_seisaku/hakusyo/",
        "description": "Prefecture/municipal revenue/expenditure",
        "data_format": "PDF",
        "fiscal_years": "2023",
        "crawl_mode": "http",
        "crawl_frequency": "annually",
        "priority": "medium"
    },
    {
        "source_id": "toyama_opendata",
        "name": "Toyama City Open Data Portal",
        "name_ja": "富山市オープンデータ",
        "agency_code": "TOYAMA",
        "url": "https://opendata.pref.toyama.jp/",
        "description": "Toyama prefecture/city budget, procurement, services",
        "data_format": "CSV/API",
        "fiscal_years": "2024,2025",
        "crawl_mode": "http",
        "crawl_frequency": "quarterly",
        "priority": "high"
    },
    {
        "source_id": "cabinet_office_economic",
        "name": "Cabinet Office - Economic & Fiscal Council",
        "name_ja": "内閣府 経済財政諮問会議",
        "agency_code": "CAO",
        "url": "https://www5.cao.go.jp/keizai-shimon/",
        "description": "Economic policy documents, fiscal outlook",
        "data_format": "PDF",
        "fiscal_years": "2024,2025",
        "crawl_mode": "http",
        "crawl_frequency": "quarterly",
        "priority": "medium"
    }
]


def main():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    
    # Remove old DB if exists for clean init
    if os.path.exists(DB_PATH):
        os.remove(DB_PATH)
        print(f"🗑️  Removed existing DB: {DB_PATH}")
    
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.execute("PRAGMA journal_mode = WAL;")
    
    print("📦 Creating tables...")
    conn.executescript(SCHEMA_SQL)
    
    print("📋 Registering data sources...")
    for ds in DATA_SOURCES:
        conn.execute(
            """INSERT INTO data_sources 
               (source_id, name, name_ja, agency_code, url, description, data_format, fiscal_years, crawl_mode, crawl_frequency, priority) 
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (ds["source_id"], ds["name"], ds["name_ja"], ds["agency_code"], ds["url"], ds["description"], 
             ds["data_format"], ds["fiscal_years"], ds["crawl_mode"], ds["crawl_frequency"], ds["priority"])
        )
    conn.commit()
    
    # Verify
    count = conn.execute("SELECT COUNT(*) FROM data_sources").fetchone()[0]
    print(f"✅ Database initialized: {DB_PATH}")
    print(f"   Tables: nodes, edges, data_sources, source_provenance, crawl_jobs, crawl_documents, chunk_embeddings, source_candidates, source_policies")
    print(f"   Data sources registered: {count}")
    
    conn.close()


if __name__ == '__main__':
    main()
