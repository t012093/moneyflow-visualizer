"""
Database Seed Script
=====================
Imports all JSON data files into the SQLite database.
Handles deduplication of nodes across datasets.

Usage:
  python scripts/seed_db.py
"""

import sqlite3
import json
import os
import re
from typing import Any, Dict, Tuple

from init_db import DATA_SOURCES

DB_PATH = os.path.join(os.path.dirname(__file__), '../data/money_flow.db')
DATA_DIR = os.path.join(os.path.dirname(__file__), '../src/data')
JPY_PER_USD = 150  # Approximate conversion rate

# Dataset files to import (order matters for node dedup priority)
DATASETS = [
    {"file": "real_data.json",  "dataset": "real_data",  "label": "Global Trade & Remittances"},
    {"file": "japan_data.json", "dataset": "japan_data", "label": "Japan Domestic (BOJ/RESAS/EDINET)"},
    {"file": "mof_data.json",   "dataset": "mof_data",   "label": "National Treasury (MOF General Account)"},
    {"file": "ministries_data.json", "dataset": "ministries_data", "label": "Ministries (1府11省庁)"},
    {"file": "mext_budget_data.json", "dataset": "mext_budget_data", "label": "MEXT Major Budget Projects"},
    {"file": "toyama_data.json", "dataset": "toyama_data", "label": "Toyama Prefecture (Local Gov)"},
    {"file": "mhlw_data.json",  "dataset": "mhlw_data",  "label": "Social Security (MHLW/CFA)"},
    {"file": "meti_subsidies_data.json", "dataset": "meti_data", "label": "Corporate Subsidies & Taxes (METI)"},
    {"file": "household_data.json", "dataset": "household_data", "label": "Household Micro-Economy (MIC)"},
]

# Maps source_dataset strings (as they appear in JSON edges) → data_sources.source_id
DATASET_TO_SOURCE_ID = {
    # Global
    "IMF DOTS (Approximation Model)": "imf_dots",
    "World Bank (Estimated Bilateral)": "wb_remittance",
    "BOJ Flow of Funds (Proxy)": "boj_funds_flow",
    "BOJ Statistics": "boj_funds_flow",
    "Chainalysis": None,  # No data_source entry for crypto
    # Domestic macro
    "MOF General Account": "mof_budget",
    "財務省一般会計": "mof_budget",
    "財務省 一般会計（所管別）": "mof_budget",
    "省庁別主要経費推計": "mof_budget",
    "文部科学省 令和7年度予算のポイント": "mext_budget",
    # Social security
    "参議院予算委員会調査室 R6": "sangiin_social_security",
    "こども家庭庁 R6/R7予算 オープンデータ": "cfa_budget",
    "こども誰でも通園制度(仮称)の本格実施に向けた制度移行 (想定)": "cfa_budget",
    "厚生労働省 国民医療費 R4": "mhlw_medical",
    "厚生労働省 介護給付費等実態統計 R5": "mhlw_nursing",
    # Regional / corporate
    "toyama_data": "toyama_opendata",
    "meti_data": "meti_subsidies",
    "household_data": "mic_household",
    # Corporate / misc (no direct data_source)
    "RESAS Inter-Regional Trade (Proxy)": "estat_api",
    "MIC Local Finance (Proxy)": "soumu_local_finance",
    "IR Reports": None,
    "EDINET XBRL (Toyota)": None,
    "EDINET XBRL (Sony)": None,
    "Corporate SEC Filings": None,
    "EDINET / IR Reports": None,
    "Wealth Reports": None,
    "Retail Brokerage Est.": None,
}

CFA_PROVENANCE_HINTS = [
    {
        "match": "児童手当 (所得制限撤廃・多子加算)",
        "source_title": "令和7年度こども家庭庁予算 事業別資料集",
        "source_url": "https://www.cfa.go.jp/assets/contents/node/basic_page/field_ref_resources/b92baeee-5b6d-47be-b16f-ebf80a4eed28/3d37a505/20240401_councils_shingikai_kodomo_shien_05_02.pdf#page=12&search=15%2C246",
    },
    {
        "match": "子どものための教育・保育給付等 (配置改善等)",
        "source_title": "令和7年度こども家庭庁予算案の概要",
        "source_url": "https://www.cfa.go.jp/assets/contents/node/basic_page/field_ref_resources/88749a20-e454-4a5b-9da8-3a32e1788a23/5cbb6234/20241227_policies_budget_53.pdf#page=6&search=%E5%AD%90%E3%81%A9%E3%82%82%E3%81%AE%E3%81%9F%E3%82%81%E3%81%AE%E6%95%99%E8%82%B2%E3%83%BB%E4%BF%9D%E8%82%B2%E7%B5%A6%E4%BB%98",
    },
    {
        "match": "出産・子育て応援交付金",
        "source_title": "令和7年度こども家庭庁予算案の概要",
        "source_url": "https://www.cfa.go.jp/assets/contents/node/basic_page/field_ref_resources/88749a20-e454-4a5b-9da8-3a32e1788a23/5cbb6234/20241227_policies_budget_53.pdf#page=6&search=%E5%A6%8A%E5%A8%A0%E6%9C%9F%E3%81%8B%E3%82%89%E5%AD%90%E8%82%B2%E3%81%A6%E6%9C%9F",
    },
    {
        "match": "こども誰でも通園制度",
        "source_title": "令和7年度こども家庭庁予算案の概要",
        "source_url": "https://www.cfa.go.jp/assets/contents/node/basic_page/field_ref_resources/88749a20-e454-4a5b-9da8-3a32e1788a23/5cbb6234/20241227_policies_budget_53.pdf#page=6&search=%E3%81%93%E3%81%A9%E3%82%82%E8%AA%B0%E3%81%A7%E3%82%82%E9%80%9A%E5%9C%92%E5%88%B6%E5%BA%A6",
    },
    {
        "match": "放課後児童事業等",
        "source_title": "令和7年度こども家庭庁予算 事業別資料集",
        "source_url": "https://www.cfa.go.jp/assets/contents/node/basic_page/field_ref_resources/88749a20-e454-4a5b-9da8-3a32e1788a23/71b23f1a/20250326_policies_budget_67.pdf#page=74&search=1%2C209",
    },
]

CFA_MINISTRY_MODEL_PROVENANCE = {
    2021: {
        "source_title": "令和3年度社会保障関係予算のポイント",
        "source_url": "https://www.mof.go.jp/public_relations/finance/202104/202104c.pdf",
    },
    2022: {
        "source_title": "令和4年度社会保障関係予算のポイント",
        "source_url": "https://www.mof.go.jp/public_relations/finance/202204/202204c.pdf",
    },
    2023: {
        "source_title": "令和5年度社会保障関係予算のポイント",
        "source_url": "https://www.mof.go.jp/public_relations/finance/202304/202304c.pdf",
    },
    2024: {
        "source_title": "令和6年度社会保障関係予算のポイント",
        "source_url": "https://www.mof.go.jp/public_relations/finance/202404/202404c.pdf",
    },
}

MINISTRY_BUDGET_PROVENANCE = {
    2021: {
        "source_title": "令和3年度一般会計歳出概算所管別内訳",
        "source_url": "https://www.mof.go.jp/policy/budget/budger_workflow/budget/fy2021/seifuan2021/03.pdf",
    },
    2022: {
        "source_title": "令和4年度一般会計歳出概算所管別内訳",
        "source_url": "https://www.mof.go.jp/policy/budget/budger_workflow/budget/fy2022/seifuan2022/03.pdf",
    },
    2023: {
        "source_title": "令和5年度一般会計歳出概算所管別内訳",
        "source_url": "https://www.mof.go.jp/policy/budget/budger_workflow/budget/fy2023/seifuan2023/03.pdf",
    },
    2024: {
        "source_title": "令和6年度一般会計歳出概算所管別内訳",
        "source_url": "https://www.mof.go.jp/policy/budget/budger_workflow/budget/fy2024/seifuan2024/03.pdf",
    },
}

MINISTRY_BUDGET_DATASETS = {
    "財務省 一般会計（所管別）",
    "省庁別主要経費推計",
}

SOURCE_TITLE_HINTS = [
    (
        "20250326_policies_budget_67.pdf",
        "令和7年度こども家庭庁予算 事業別資料集",
    ),
    (
        "20240401_councils_shingikai_kodomo_shien_05_02.pdf",
        "令和7年度こども家庭庁予算 事業別資料集",
    ),
    (
        "20241227_policies_budget_53.pdf",
        "令和7年度こども家庭庁予算案の概要",
    ),
    (
        "20250306_policies_budget_63.pdf",
        "令和7年度こども家庭庁予算 個別事業資料",
    ),
    (
        "fy2021/seifuan2021/03.pdf",
        "令和3年度一般会計歳出概算所管別内訳",
    ),
    (
        "fy2022/seifuan2022/03.pdf",
        "令和4年度一般会計歳出概算所管別内訳",
    ),
    (
        "fy2023/seifuan2023/03.pdf",
        "令和5年度一般会計歳出概算所管別内訳",
    ),
    (
        "fy2024/seifuan2024/03.pdf",
        "令和6年度一般会計歳出概算所管別内訳",
    ),
    (
        "20250305-ope_dev03-000037774-1.pdf",
        "文部科学省 令和7年度予算のポイント",
    ),
]

BUDGET_HIGHLIGHTS = [
    {
        "entity_id": "MIN_CFA",
        "fiscal_year": 2025,
        "section_key": "overview",
        "title": "令和7年度こども家庭庁予算",
        "amount_text": "73,270億円",
        "amount_oku_yen": 73270,
        "summary": "実質ベースの総額。前年度比で約1.1兆円の増。",
        "source_title": "令和7年度こども家庭庁予算の全体像",
        "source_url": "https://www.cfa.go.jp/assets/contents/node/basic_page/field_ref_resources/88749a20-e454-4a5b-9da8-3a32e1788a23/5cbb6234/20241227_policies_budget_53.pdf",
        "page_number": 2,
        "display_order": 10,
    },
    {
        "entity_id": "MIN_CFA",
        "fiscal_year": 2025,
        "section_key": "increase_driver",
        "title": "児童手当の拡充",
        "amount_text": "+0.6兆円",
        "amount_oku_yen": 6000,
        "summary": "令和7年度予算の主な増要因。",
        "source_title": "令和7年度こども家庭庁予算の全体像",
        "source_url": "https://www.cfa.go.jp/assets/contents/node/basic_page/field_ref_resources/88749a20-e454-4a5b-9da8-3a32e1788a23/5cbb6234/20241227_policies_budget_53.pdf",
        "page_number": 2,
        "display_order": 20,
    },
    {
        "entity_id": "MIN_CFA",
        "fiscal_year": 2025,
        "section_key": "increase_driver",
        "title": "高等教育費の負担軽減の抜本強化",
        "amount_text": "+0.1兆円",
        "amount_oku_yen": 1000,
        "summary": "こども未来戦略の加速化プランに沿った増要因。",
        "source_title": "令和7年度こども家庭庁予算の全体像",
        "source_url": "https://www.cfa.go.jp/assets/contents/node/basic_page/field_ref_resources/88749a20-e454-4a5b-9da8-3a32e1788a23/5cbb6234/20241227_policies_budget_53.pdf",
        "page_number": 2,
        "display_order": 30,
    },
    {
        "entity_id": "MIN_CFA",
        "fiscal_year": 2025,
        "section_key": "increase_driver",
        "title": "育休支援の拡充",
        "amount_text": "+0.1兆円",
        "amount_oku_yen": 1000,
        "summary": "両立支援を含む重点増額分。",
        "source_title": "令和7年度こども家庭庁予算の全体像",
        "source_url": "https://www.cfa.go.jp/assets/contents/node/basic_page/field_ref_resources/88749a20-e454-4a5b-9da8-3a32e1788a23/5cbb6234/20241227_policies_budget_53.pdf",
        "page_number": 2,
        "display_order": 40,
    },
    {
        "entity_id": "MIN_CFA",
        "fiscal_year": 2025,
        "section_key": "increase_driver",
        "title": "保育の質の向上",
        "amount_text": "+0.1兆円",
        "amount_oku_yen": 1000,
        "summary": "配置改善や処遇改善を含む重点分野。",
        "source_title": "令和7年度こども家庭庁予算の全体像",
        "source_url": "https://www.cfa.go.jp/assets/contents/node/basic_page/field_ref_resources/88749a20-e454-4a5b-9da8-3a32e1788a23/5cbb6234/20241227_policies_budget_53.pdf",
        "page_number": 2,
        "display_order": 50,
    },
    {
        "entity_id": "MIN_CFA",
        "fiscal_year": 2025,
        "section_key": "policy_frame",
        "title": "保育の質の向上等",
        "amount_text": "2兆1,819億円（内数）",
        "amount_oku_yen": 21819,
        "summary": "保育所整備、教育・保育給付、1歳児配置改善、保育士処遇改善などを含む施策枠。",
        "source_title": "令和7年度こども家庭庁予算案の概要",
        "source_url": "https://www.cfa.go.jp/assets/contents/node/basic_page/field_ref_resources/88749a20-e454-4a5b-9da8-3a32e1788a23/5cbb6234/20241227_policies_budget_53.pdf",
        "page_number": 6,
        "display_order": 60,
    },
    {
        "entity_id": "MIN_CFA",
        "fiscal_year": 2025,
        "section_key": "policy_frame",
        "title": "妊娠期から子育て期までの包括的な支援",
        "amount_text": "3,072億円（内数）",
        "amount_oku_yen": 3072,
        "summary": "妊婦支援給付、伴走型相談支援、産後ケア、乳幼児健診などを含む。",
        "source_title": "令和7年度こども家庭庁予算案の概要",
        "source_url": "https://www.cfa.go.jp/assets/contents/node/basic_page/field_ref_resources/88749a20-e454-4a5b-9da8-3a32e1788a23/5cbb6234/20241227_policies_budget_53.pdf",
        "page_number": 6,
        "display_order": 70,
    },
    {
        "entity_id": "MIN_CFA",
        "fiscal_year": 2025,
        "section_key": "policy_frame",
        "title": "こどもの安心・安全の確保",
        "amount_text": "2,165億円（内数）",
        "amount_oku_yen": 2165,
        "summary": "居場所づくり、子育て世帯訪問支援、児童育成支援拠点などを含む。",
        "source_title": "令和7年度こども家庭庁予算案の概要",
        "source_url": "https://www.cfa.go.jp/assets/contents/node/basic_page/field_ref_resources/88749a20-e454-4a5b-9da8-3a32e1788a23/5cbb6234/20241227_policies_budget_53.pdf",
        "page_number": 6,
        "display_order": 80,
    },
    {
        "entity_id": "MIN_CFA",
        "fiscal_year": 2025,
        "section_key": "individual_project",
        "title": "こども・若者意見反映推進事業",
        "amount_text": "2.1億円",
        "amount_oku_yen": 2.1,
        "summary": "こども・若者の意見反映を進めるための事業。",
        "source_title": "こども・若者意見反映推進事業",
        "source_url": "https://www.cfa.go.jp/assets/contents/node/basic_page/field_ref_resources/88749a20-e454-4a5b-9da8-3a32e1788a23/86f71a32/20250306_policies_budget_63.pdf",
        "page_number": 3,
        "display_order": 90,
    },
    {
        "entity_id": "MIN_CFA",
        "fiscal_year": 2025,
        "section_key": "individual_project",
        "title": "地方自治体におけるこども・若者の意見反映の取組促進",
        "amount_text": "21百万円",
        "amount_oku_yen": 0.21,
        "summary": "地方自治体での意見反映を進める取組支援。",
        "source_title": "地方自治体におけるこども・若者の意見反映の取組促進",
        "source_url": "https://www.cfa.go.jp/assets/contents/node/basic_page/field_ref_resources/88749a20-e454-4a5b-9da8-3a32e1788a23/86f71a32/20250306_policies_budget_63.pdf",
        "page_number": 4,
        "display_order": 100,
    },
    {
        "entity_id": "MIN_CFA",
        "fiscal_year": 2025,
        "section_key": "individual_project",
        "title": "こども基本法・児童の権利に関する条約の普及啓発事業",
        "amount_text": "18百万円",
        "amount_oku_yen": 0.18,
        "summary": "こども基本法と児童の権利条約の普及啓発。",
        "source_title": "こども基本法・児童の権利に関する条約の普及啓発事業",
        "source_url": "https://www.cfa.go.jp/assets/contents/node/basic_page/field_ref_resources/88749a20-e454-4a5b-9da8-3a32e1788a23/86f71a32/20250306_policies_budget_63.pdf",
        "page_number": 5,
        "display_order": 110,
    },
    {
        "entity_id": "MIN_CFA",
        "fiscal_year": 2025,
        "section_key": "individual_project",
        "title": "こども政策DX推進体制強化事業",
        "amount_text": "3.7億円",
        "amount_oku_yen": 3.7,
        "summary": "こども政策DXの推進体制を強化する事業。",
        "source_title": "こども政策DX推進体制強化事業",
        "source_url": "https://www.cfa.go.jp/assets/contents/node/basic_page/field_ref_resources/88749a20-e454-4a5b-9da8-3a32e1788a23/86f71a32/20250306_policies_budget_63.pdf",
        "page_number": 8,
        "display_order": 120,
    },
    {
        "entity_id": "MIN_CFA",
        "fiscal_year": 2025,
        "section_key": "individual_project",
        "title": "こども家庭庁ウェブサイト運用保守",
        "amount_text": "1.2億円",
        "amount_oku_yen": 1.2,
        "summary": "こども家庭庁ウェブサイトの運用保守。",
        "source_title": "こども家庭庁ウェブサイトの運用保守",
        "source_url": "https://www.cfa.go.jp/assets/contents/node/basic_page/field_ref_resources/88749a20-e454-4a5b-9da8-3a32e1788a23/86f71a32/20250306_policies_budget_63.pdf",
        "page_number": 11,
        "display_order": 130,
    },
]


def extract_name_en(name: str) -> str:
    """Extract English name from bilingual format like '年金給付費 (Pensions)'"""
    if '(' in name and name.endswith(')'):
        return name.split('(')[-1].rstrip(')')
    return ""


def infer_source_title(source_url: str, dataset_name: str) -> str:
    for pattern, title in SOURCE_TITLE_HINTS:
        if pattern in source_url:
            return title
    return dataset_name


def resolve_dataset_provenance(
    dataset_name: str,
    fiscal_year: int,
    source_id: str,
) -> dict[str, str] | None:
    if dataset_name == "省庁別主要経費推計" and source_id == "MIN_CFA":
        return CFA_MINISTRY_MODEL_PROVENANCE.get(fiscal_year)

    if dataset_name in MINISTRY_BUDGET_DATASETS:
        return MINISTRY_BUDGET_PROVENANCE.get(fiscal_year)

    return None


def infer_provenance_reference(
    source_url: str,
    source_title: str,
    dataset_name: str,
    fiscal_year: int,
    source_id: str,
) -> tuple[str, str, int | None]:
    normalized_url = source_url
    normalized_title = source_title or dataset_name

    dataset_hint = resolve_dataset_provenance(dataset_name, fiscal_year, source_id)
    if dataset_hint:
        generic_budget_url = "https://www.mof.go.jp/policy/budget/"
        if (
            not normalized_url
            or normalized_url == generic_budget_url
            or normalized_title in MINISTRY_BUDGET_DATASETS
            or normalized_title == dataset_name
        ):
            normalized_url = dataset_hint["source_url"]
            normalized_title = dataset_hint["source_title"]

    if normalized_url:
        normalized_title = infer_source_title(normalized_url, normalized_title)

    return normalized_url, normalized_title, extract_page_number(normalized_url)


def resolve_source_reference(edge: Dict[str, object], dataset_name: str, fallback_url: str) -> tuple[str, str]:
    explicit_url = str(edge.get("source_url", "") or "").strip()
    explicit_title = str(edge.get("source_title", "") or "").strip()

    description = str(edge.get("description", "") or "")
    source_id = str(edge.get("source_id", "") or "")
    fiscal_year = int(edge.get("year", 0) or 0)

    if "こども家庭庁" in dataset_name and not explicit_url:
        for hint in CFA_PROVENANCE_HINTS:
            if hint["match"] in description:
                return hint["source_url"], hint["source_title"]

    candidate_url = explicit_url or fallback_url
    candidate_title = explicit_title or infer_source_title(candidate_url, dataset_name)
    normalized_url, normalized_title, _ = infer_provenance_reference(
        candidate_url,
        candidate_title,
        dataset_name,
        fiscal_year,
        source_id,
    )
    return normalized_url, normalized_title


def extract_page_number(source_url: str) -> int | None:
    if not source_url:
        return None
    match = re.search(r"[#?&]page=(\d+)", source_url)
    if not match:
        return None
    return int(match.group(1))


def normalize_source_provenance(conn: sqlite3.Connection) -> None:
    rows = conn.execute(
        """
        SELECT p.id, p.source_url, p.source_title, p.page_number,
               e.source_dataset, e.fiscal_year, e.source_id
        FROM source_provenance p
        JOIN edges e ON e.id = p.edge_id
        """
    ).fetchall()

    for prov_id, source_url, source_title, page_number, dataset_name, fiscal_year, source_id in rows:
        normalized_url, normalized_title, normalized_page = infer_provenance_reference(
            source_url or "",
            source_title or "",
            dataset_name or "",
            int(fiscal_year or 0),
            source_id or "",
        )

        if (
            normalized_url == source_url
            and normalized_title == source_title
            and normalized_page == page_number
        ):
            continue

        conn.execute(
            """
            UPDATE source_provenance
            SET source_url = ?, source_title = ?, page_number = ?
            WHERE id = ?
            """,
            (normalized_url, normalized_title, normalized_page, prov_id),
        )


def ensure_budget_highlights_table(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
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

        CREATE INDEX IF NOT EXISTS idx_budget_highlights_entity_year
          ON budget_highlights(entity_id, fiscal_year, section_key, display_order);
        """
    )


def load_budget_highlights_from_datasets() -> list[dict[str, Any]]:
    highlights: list[dict[str, Any]] = []

    for dataset in DATASETS:
        filepath = os.path.join(DATA_DIR, dataset["file"])
        if not os.path.exists(filepath):
            continue

        with open(filepath, "r", encoding="utf-8") as handle:
            data = json.load(handle)

        for item in data.get("budget_highlights", []):
            highlights.append(item)

    return highlights


def seed_budget_highlights(conn: sqlite3.Connection) -> None:
    ensure_budget_highlights_table(conn)

    all_highlights = BUDGET_HIGHLIGHTS + load_budget_highlights_from_datasets()

    for item in all_highlights:
        conn.execute(
            """
            INSERT INTO budget_highlights (
              entity_id,
              fiscal_year,
              section_key,
              title,
              amount_text,
              amount_oku_yen,
              summary,
              source_title,
              source_url,
              page_number,
              display_order
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(entity_id, fiscal_year, section_key, title) DO UPDATE SET
              amount_text = excluded.amount_text,
              amount_oku_yen = excluded.amount_oku_yen,
              summary = excluded.summary,
              source_title = excluded.source_title,
              source_url = excluded.source_url,
              page_number = excluded.page_number,
              display_order = excluded.display_order,
              updated_at = datetime('now')
            """,
            (
                item["entity_id"],
                item["fiscal_year"],
                item["section_key"],
                item["title"],
                item.get("amount_text"),
                item.get("amount_oku_yen"),
                item.get("summary"),
                item.get("source_title"),
                item.get("source_url"),
                item.get("page_number"),
                item.get("display_order", 0),
            ),
        )


def seed_dataset(conn: sqlite3.Connection, dataset_info: Dict[str, str]) -> Tuple[int, int]:
    filepath = os.path.join(DATA_DIR, dataset_info["file"])
    if not os.path.exists(filepath):
        print(f"  ⚠️  Skipping {dataset_info['file']} (not found)")
        return 0, 0
    
    with open(filepath, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    node_count: int = 0
    edge_count: int = 0
    
    # Insert nodes (skip duplicates)
    for node in data.get("nodes", []):
        try:
            name_en = extract_name_en(node.get("name", ""))
            conn.execute(
                """INSERT OR IGNORE INTO nodes (id, name, name_en, lat, lng, region, type, dataset)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    node["id"],
                    node["name"],
                    name_en or None,
                    node.get("lat"),
                    node.get("lng"),
                    node.get("region"),
                    node["type"],
                    dataset_info["dataset"]
                )
            )
            node_count += 1  # type: ignore
        except Exception as e:
            print(f"  ⚠️  Node skip: {node.get('id')} - {e}")
    
    # Insert edges
    for edge in data.get("edges", []):
        value_usd = edge.get("value_usd", 0)
        value_jpy = value_usd * JPY_PER_USD  # Approximate JPY equivalent
        
        cursor = conn.execute(
            """INSERT INTO edges (source_id, target_id, category, sub_category, 
               value_usd, value_jpy, fiscal_year, confidence, source_dataset, description)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                edge["source_id"],
                edge["target_id"],
                edge["category"],
                edge.get("sub_category"),
                value_usd,
                value_jpy,
                edge["year"],
                edge.get("confidence", 0.9),
                edge.get("source_dataset", dataset_info["dataset"]),
                edge.get("description")
            )
        )
        edge_id = cursor.lastrowid
        edge_count += 1
        
        # Auto-generate source_provenance if we have a description or source_dataset
        source_dataset = edge.get("source_dataset", dataset_info["dataset"])
        description = edge.get("description", "")
        
        # Use mapping to find data_source_id
        ds_source_id = DATASET_TO_SOURCE_ID.get(source_dataset)
        
        # Prioritize explicit source_url from the JSON data
        source_url = edge.get("source_url", "")
        
        # Extract URL from description if missing
        if not source_url and description and "http" in description:
            import re
            urls = re.findall(r'https?://[^\s)]+', description)
            source_url = urls[0] if urls else ""
        
        if not source_url and ds_source_id:
            url_row = conn.execute("SELECT url FROM data_sources WHERE source_id = ?", (ds_source_id,)).fetchone()
            source_url = url_row[0] if url_row else source_dataset
        
        if not source_url:
            source_url = source_dataset  # fallback: use dataset name

        source_url, source_title = resolve_source_reference(edge, source_dataset, source_url)

        explicit_page_number = edge.get("page_number")
        page_number = explicit_page_number if isinstance(explicit_page_number, int) else extract_page_number(source_url)

        conn.execute(
            """INSERT INTO source_provenance (edge_id, source_id, source_url, source_title, page_number, extracted_text, extraction_method, confidence)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                edge_id,
                ds_source_id,
                source_url,
                source_title,
                page_number,
                description[:500] if description else None,
                "script_generated",
                edge.get("confidence", 0.9)
            )
        )
    
    return node_count, edge_count


def export_frontend_json(conn: sqlite3.Connection) -> Tuple[str, int, int]:
    """Export the unified DB back to a single JSON for the frontend"""
    export_path = os.path.join(DATA_DIR, "unified_data.json")
    seed_budget_highlights(conn)
    
    nodes = []
    for row in conn.execute("SELECT id, name, lat, lng, region, type FROM nodes ORDER BY dataset, type, name"):
        nodes.append({
            "id": row[0], "name": row[1], "lat": row[2], "lng": row[3],
            "region": row[4], "type": row[5]
        })
    
    edges = []
    # Join with source_provenance to get extracted_text and source_url
    for row in conn.execute('''
        SELECT e.source_id, e.target_id, e.category, e.sub_category, 
               e.value_usd, e.fiscal_year, e.confidence, e.source_dataset, e.description,
               p.extracted_text, p.source_url, p.source_title, p.page_number
        FROM edges e
        LEFT JOIN source_provenance p ON e.id = p.edge_id
        ORDER BY e.fiscal_year, e.source_id
    '''):
        edge_data = {
            "source_id": row[0], "target_id": row[1], "category": row[2],
            "sub_category": row[3], "value_usd": row[4], "year": row[5],
            "confidence": row[6], "source_dataset": row[7]
        }
        if row[8]:  # description
            edge_data["description"] = row[8]
        if row[9]:  # extracted_text
            edge_data["evidence_text"] = row[9] # mapped to evidence_text for frontend compatibility
        if row[10]: # source_url
            edge_data["source_url"] = row[10]
        if row[11]: # source_title
            edge_data["source_title"] = row[11]
        if row[12] is not None: # page_number
            edge_data["page_number"] = row[12]
            
        edges.append(edge_data)

    highlights: list[dict[str, Any]] = []
    for row in conn.execute(
        """
        SELECT entity_id, fiscal_year, section_key, title, amount_text, amount_oku_yen,
               summary, source_title, source_url, page_number, display_order
        FROM budget_highlights
        ORDER BY fiscal_year DESC, entity_id, display_order, id
        """
    ):
        highlights.append(
            {
                "entity_id": row[0],
                "fiscal_year": row[1],
                "section_key": row[2],
                "title": row[3],
                "amount_text": row[4],
                "amount_oku_yen": row[5],
                "summary": row[6],
                "source_title": row[7],
                "source_url": row[8],
                "page_number": row[9],
                "display_order": row[10],
            }
        )

    fiscal_years = sorted(set(e["year"] for e in edges))
    
    output = {
        "nodes": nodes,
        "edges": edges,
        "metadata": {
            "source": "SQLite DB (money_flow.db)",
            "total_nodes": len(nodes),
            "total_edges": len(edges),
            "fiscal_years": fiscal_years,
            "latestFiscalYear": fiscal_years[-1] if fiscal_years else None,
            "featuredEntityId": "MIN_CFA",
            "budgetHighlights": highlights,
        }
    }
    
    with open(export_path, 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    
    return export_path, len(nodes), len(edges)


def print_summary(conn: sqlite3.Connection) -> None:
    print("\n" + "=" * 60)
    print("📊 Database Summary")
    print("=" * 60)
    
    total_nodes = conn.execute("SELECT COUNT(*) FROM nodes").fetchone()[0]
    total_edges = conn.execute("SELECT COUNT(*) FROM edges").fetchone()[0]
    total_sources = conn.execute("SELECT COUNT(*) FROM data_sources").fetchone()[0]
    
    print(f"  Total Nodes:        {total_nodes}")
    print(f"  Total Edges:        {total_edges}")
    print(f"  Data Sources:       {total_sources}")
    
    print("\n  Nodes by Type:")
    for row in conn.execute("SELECT type, COUNT(*) FROM nodes GROUP BY type ORDER BY COUNT(*) DESC"):
        print(f"    {row[0]:25s} {row[1]:>4d}")
    
    print("\n  Edges by Category:")
    for row in conn.execute("SELECT category, COUNT(*), ROUND(SUM(value_usd)/1e9, 1) FROM edges GROUP BY category ORDER BY SUM(value_usd) DESC"):
        print(f"    {row[0]:15s} {row[1]:>5d} edges  ${row[2]:>10.1f}B USD")
    
    print("\n  Edges by Fiscal Year:")
    for row in conn.execute("SELECT fiscal_year, COUNT(*), ROUND(SUM(value_usd)/1e9, 1) FROM edges GROUP BY fiscal_year ORDER BY fiscal_year"):
        print(f"    FY{row[0]}  {row[1]:>5d} edges  ${row[2]:>10.1f}B USD")
    
    print("\n  Edges by Dataset:")
    for row in conn.execute("SELECT source_dataset, COUNT(*) FROM edges GROUP BY source_dataset ORDER BY COUNT(*) DESC"):
        print(f"    {row[0]:40s} {row[1]:>5d}")
    
    # Provenance summary
    prov_count = conn.execute("SELECT COUNT(*) FROM source_provenance").fetchone()[0]
    prov_linked = conn.execute("SELECT COUNT(DISTINCT source_id) FROM source_provenance WHERE source_id IS NOT NULL").fetchone()[0]
    print(f"\n  Source Provenance: {prov_count} records ({prov_linked} linked to data_sources)")


def ensure_data_sources(conn: sqlite3.Connection) -> None:
    for ds in DATA_SOURCES:
        conn.execute(
            """
            INSERT INTO data_sources
              (source_id, name, name_ja, agency_code, url, description, data_format, fiscal_years, crawl_mode, crawl_frequency, priority)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(source_id) DO UPDATE SET
              name = excluded.name,
              name_ja = excluded.name_ja,
              agency_code = excluded.agency_code,
              url = excluded.url,
              description = excluded.description,
              data_format = excluded.data_format,
              fiscal_years = excluded.fiscal_years,
              crawl_mode = excluded.crawl_mode,
              crawl_frequency = excluded.crawl_frequency,
              priority = excluded.priority
            """,
            (
                ds["source_id"],
                ds["name"],
                ds["name_ja"],
                ds["agency_code"],
                ds["url"],
                ds["description"],
                ds["data_format"],
                ds["fiscal_years"],
                ds["crawl_mode"],
                ds["crawl_frequency"],
                ds["priority"],
            ),
        )


def main():
    if not os.path.exists(DB_PATH):
        print("❌ Database not found. Run init_db.py first.")
        return
    
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA foreign_keys = ON;")
    
    # Clear existing data for re-seeding
    conn.execute("DELETE FROM budget_highlights")
    conn.execute("DELETE FROM source_provenance")
    conn.execute("DELETE FROM edges")
    conn.execute("DELETE FROM nodes")
    ensure_data_sources(conn)
    conn.commit()
    
    print("🌱 Seeding database from JSON files...")
    print("=" * 60)
    
    total_nodes: int = 0
    total_edges: int = 0
    
    for ds in DATASETS:
        n, e = seed_dataset(conn, ds)
        conn.commit()
        print(f"  ✅ {ds['label']:45s} → {n:>3d} nodes, {e:>4d} edges")
        total_nodes += n
        total_edges += e
    
    print(f"\n  Total imported: {total_nodes} nodes, {total_edges} edges")

    normalize_source_provenance(conn)
    conn.commit()
    
    # Export unified JSON for frontend
    print("\n📤 Exporting unified JSON for frontend...")
    path, n, e = export_frontend_json(conn)
    print(f"  ✅ {path}")
    print(f"     {n} nodes, {e} edges")
    
    # Print summary
    print_summary(conn)
    
    conn.close()


if __name__ == '__main__':
    main()
