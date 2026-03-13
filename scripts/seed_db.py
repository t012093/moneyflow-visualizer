"""
Database Seed Script
=====================
Imports all JSON data files into the SQLite database.
Handles deduplication of nodes across datasets.

Usage:
  python scripts/seed_db.py
"""

import json
import os
import re
import sqlite3
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Tuple
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit, urlunsplit
from urllib.request import Request, urlopen

from init_db import DATA_SOURCES

DB_PATH = os.path.join(os.path.dirname(__file__), '../data/money_flow.db')
DATA_DIR = os.path.join(os.path.dirname(__file__), '../src/data')
PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
JPY_PER_USD = 150  # Approximate conversion rate
VALIDATE_SOURCE_URLS = os.environ.get("VALIDATE_SOURCE_URLS", "true").lower() not in {"0", "false", "no"}
SOURCE_VALIDATION_TIMEOUT_SECONDS = float(os.environ.get("SOURCE_VALIDATION_TIMEOUT_SECONDS", "8"))
SOURCE_VALIDATION_TTL_HOURS = int(os.environ.get("SOURCE_VALIDATION_TTL_HOURS", "168"))

# Dataset files to import (order matters for node dedup priority)
DATASETS = [
    {"file": "real_data.json",  "dataset": "real_data",  "label": "Global Trade & Remittances"},
    {"file": "japan_data.json", "dataset": "japan_data", "label": "Japan Domestic (BOJ/RESAS/EDINET)"},
    {"file": "mof_data.json",   "dataset": "mof_data",   "label": "National Treasury (MOF General Account)"},
    {"file": "ministries_data.json", "dataset": "ministries_data", "label": "Ministries (1府11省庁)"},
    {"file": "mext_budget_data.json", "dataset": "mext_budget_data", "label": "MEXT Major Budget Projects"},
    {"file": "mext_budget_2022_data.json", "dataset": "mext_budget_2022_data", "label": "MEXT FY2022 Major Budget Projects"},
    {"file": "mext_budget_2023_data.json", "dataset": "mext_budget_2023_data", "label": "MEXT FY2023 Major Budget Projects"},
    {"file": "mext_budget_2024_data.json", "dataset": "mext_budget_2024_data", "label": "MEXT FY2024 Major Budget Projects"},
    {"file": "mhlw_budget_data.json", "dataset": "mhlw_budget_data", "label": "MHLW Major Budget Programs"},
    {"file": "mhlw_budget_2022_data.json", "dataset": "mhlw_budget_2022_data", "label": "MHLW FY2022 Major Budget Programs"},
    {"file": "mhlw_budget_2023_data.json", "dataset": "mhlw_budget_2023_data", "label": "MHLW FY2023 Major Budget Programs"},
    {"file": "mhlw_budget_2024_data.json", "dataset": "mhlw_budget_2024_data", "label": "MHLW FY2024 Major Budget Programs"},
    {"file": "mlit_budget_2022_data.json", "dataset": "mlit_budget_2022_data", "label": "MLIT FY2022 Major Budget Programs"},
    {"file": "mlit_budget_2023_data.json", "dataset": "mlit_budget_2023_data", "label": "MLIT FY2023 Major Budget Programs"},
    {"file": "mlit_budget_2024_data.json", "dataset": "mlit_budget_2024_data", "label": "MLIT FY2024 Major Budget Programs"},
    {"file": "meti_budget_2022_data.json", "dataset": "meti_budget_2022_data", "label": "METI FY2022 Major Budget Programs"},
    {"file": "meti_budget_2023_data.json", "dataset": "meti_budget_2023_data", "label": "METI FY2023 Major Budget Programs"},
    {"file": "meti_budget_2024_data.json", "dataset": "meti_budget_2024_data", "label": "METI FY2024 Major Budget Programs"},
    {"file": "meti_budget_data.json", "dataset": "meti_budget_data", "label": "METI FY2025 Major Budget Programs"},
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
    "文部科学省 令和4年度予算のポイント": "mext_budget",
    "文部科学省 令和5年度予算のポイント": "mext_budget",
    "文部科学省 令和6年度予算のポイント": "mext_budget",
    "文部科学省 令和7年度予算のポイント": "mext_budget",
    "厚生労働省 令和4年度予算案の概要": "mhlw_budget",
    "厚生労働省 令和5年度予算案の概要": "mhlw_budget",
    "厚生労働省 令和6年度予算案の概要": "mhlw_budget",
    "厚生労働省 令和7年度予算案の概要": "mhlw_budget",
    "国土交通省 令和4年度予算概要": "mlit_budget",
    "国土交通省 令和5年度予算概要": "mlit_budget",
    "国土交通省 令和6年度予算概要": "mlit_budget",
    "経済産業省関係 令和3年度補正予算・令和4年度当初予算のポイント": "meti_budget",
    "経済産業省関係 令和4年度補正予算・令和5年度当初予算のポイント": "meti_budget",
    "経済産業省関係 令和5年度補正予算・令和6年度当初予算の概要": "meti_budget",
    "経済産業省 2025年度経済産業政策の重点": "meti_budget",
    # Social security
    "参議院予算委員会調査室 R6": "sangiin_social_security",
    "こども家庭庁 R6/R7予算 オープンデータ": "cfa_budget",
    "こども誰でも通園制度(仮称)の本格実施に向けた制度移行 (想定)": "cfa_budget",
    "放課後児童クラブ（運営費・処遇改善）運営主体別按分 (令和7年実施状況ベース)": "cfa_budget",
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

SOURCE_URL_REWRITES = {
    "https://www.cfa.go.jp/assets/contents/node/basic_page/field_ref_resources/b92baeee-5b6d-47be-b16f-ebf80a4eed28/3d37a505/20240401_councils_shingikai_kodomo_shien_05_02.pdf#page=12&search=15%2C246":
        "https://www.cfa.go.jp/assets/contents/node/basic_page/field_ref_resources/88749a20-e454-4a5b-9da8-3a32e1788a23/5cbb6234/20241227_policies_budget_53.pdf#page=2&search=%E5%85%90%E7%AB%A5%E6%89%8B%E5%BD%93",
    "https://www.mof.go.jp/public_relations/finance/202104/202104c.pdf":
        "https://www.mof.go.jp/budget/budger_workflow/budget/fy2021/seifuan2021/14.pdf",
    "https://www.mof.go.jp/policy/budget/budger_workflow/budget/fy2022/seifuan2022/03.pdf":
        "https://www.mof.go.jp/policy/budget/budger_workflow/budget/fy2022/sy030118.html",
    "https://www.mhlw.go.jp/toukei/saikin/hw/k-iryohi/":
        "https://www.mhlw.go.jp/toukei/list/37-21a.html",
    "https://www.mhlw.go.jp/toukei/saikin/hw/kaigo/kyufu/":
        "https://www.mhlw.go.jp/toukei/list/45-1b.html",
}

CFA_PROVENANCE_HINTS = [
    {
        "match": "児童手当 (所得制限撤廃・多子加算)",
        "source_title": "令和7年度こども家庭庁予算案の概要",
        "source_url": "https://www.cfa.go.jp/assets/contents/node/basic_page/field_ref_resources/88749a20-e454-4a5b-9da8-3a32e1788a23/5cbb6234/20241227_policies_budget_53.pdf#page=2&search=%E5%85%90%E7%AB%A5%E6%89%8B%E5%BD%93",
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
        "source_url": "https://www.mof.go.jp/policy/budget/budger_workflow/budget/fy2022/sy030118.html",
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

CFA_DAREDEMO_MODELED_DATASET = "こども誰でも通園制度(仮称)の本格実施に向けた制度移行 (想定)"
CFA_AFTER_SCHOOL_OP_MODELED_DATASET = "放課後児童クラブ（運営費・処遇改善）運営主体別按分 (令和7年実施状況ベース)"
CFA_AFTER_SCHOOL_FAC_MODELED_DATASET = "放課後児童クラブ（施設整備）公立・民間整備按分 (令和7年実施状況ベース)"

DISTRIBUTION_MODELS_CONFIG_PATH = os.path.join(os.path.dirname(__file__), "distribution_models.json")


def load_distribution_models_config() -> dict[str, list[dict[str, Any]]]:
    with open(DISTRIBUTION_MODELS_CONFIG_PATH, "r", encoding="utf-8") as fh:
        payload = json.load(fh)

    nodes = payload.get("nodes", [])
    models = payload.get("models", [])
    implementation_site_models = payload.get("implementation_site_models", [])
    if not isinstance(nodes, list) or not isinstance(models, list) or not isinstance(implementation_site_models, list):
        raise ValueError("distribution_models.json must contain 'nodes', 'models', and optional 'implementation_site_models' arrays")
    return {"nodes": nodes, "models": models, "implementation_site_models": implementation_site_models}


def merge_manual_reviewed_nodes(*node_groups: list[dict[str, Any]]) -> list[dict[str, Any]]:
    merged: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    for group in node_groups:
        for node in group:
            node_id = str(node["id"])
            if node_id in seen_ids:
                continue
            seen_ids.add(node_id)
            merged.append(node)
    return merged


DISTRIBUTION_MODELS_CONFIG = load_distribution_models_config()
DISTRIBUTION_MODEL_NODES = DISTRIBUTION_MODELS_CONFIG["nodes"]
DISTRIBUTION_MODELS = DISTRIBUTION_MODELS_CONFIG["models"]
IMPLEMENTATION_SITE_FLOW_MODELS = DISTRIBUTION_MODELS_CONFIG["implementation_site_models"]

KOBE_DAREDEMO_BUDGET_DATASET = "神戸市 令和7年度予算説明書"
KOBE_DAREDEMO_BUDGET_JPY = 137_500_000

BASE_MANUAL_REVIEWED_NODES = [
    {
        "id": "CITY_KOBE",
        "name": "神戸市",
        "lat": 34.6901,
        "lng": 135.1955,
        "region": "Hyogo",
        "type": "local_gov",
        "dataset": "manual_reviewed",
    },
    {
        "id": "REC_KOBE_DAREDEMO_SITES",
        "name": "神戸市こども誰でも通園制度 実施施設群",
        "lat": 34.6905,
        "lng": 135.1947,
        "region": "Hyogo",
        "type": "recipient",
        "dataset": "manual_reviewed",
    },
]

MANUAL_REVIEWED_NODES = merge_manual_reviewed_nodes(BASE_MANUAL_REVIEWED_NODES, DISTRIBUTION_MODEL_NODES)

KOBE_DAREDEMO_SITE_ROWS = [
    ("東灘区", "幼保連携型認定こども園渦が森幼稚園"),
    ("東灘区", "幼保連携型認定こども園神戸夢"),
    ("東灘区", "御影ちぬっこ保育ルーム"),
    ("灘区", "幼保連携型認定こども園神戸さくら保育園"),
    ("灘区", "幼保連携型認定こども園はっとこども園"),
    ("灘区", "幼保連携型認定こども園光愛児園"),
    ("灘区", "なのは乳児園"),
    ("中央区", "幼保連携型認定こども園真生きらきら保育園"),
    ("中央区", "大慈幼保連携型認定こども園とも分園"),
    ("中央区", "大慈ほまれ幼保連携型認定こども園"),
    ("中央区", "幼保連携型認定こども園ポートピア"),
    ("中央区", "神戸教会いずみ幼稚園"),
    ("兵庫区", "松原保育所（公立）"),
    ("兵庫区", "幼保連携型認定こども園宝地院保育園"),
    ("兵庫区", "幼保連携型認定こども園モーツァルト兵庫こども園"),
    ("北区", "幼保連携型認定こども園桜の宮こども園"),
    ("北区", "幼保連携型認定こども園星の杜こども園"),
    ("北区", "幼稚園型認定こども園鈴蘭台幼稚園"),
    ("長田区", "神視保育園"),
    ("長田区", "幼保連携型認定こども園新生こども園"),
    ("長田区", "幼保連携型認定こども園ほそだ"),
    ("須磨区", "名谷フォレスト保育園"),
    ("須磨区", "幼保連携型認定こども園のぞみ保育園"),
    ("須磨区", "幼保連携型認定こども園村雨こども園"),
    ("須磨区", "西須磨わかば園"),
    ("垂水区", "幼保連携型認定こども園彩の森"),
    ("垂水区", "幼保連携型認定こども園舞子幼稚園"),
    ("垂水区", "幼保連携型認定こども園明舞幼稚園"),
    ("垂水区", "幼稚園型認定こども園星陵台めぐみ幼稚園"),
    ("垂水区", "小規模保育園あんよ"),
    ("西区", "幼保連携型認定こども園あゆみ幼児園"),
    ("西区", "幼保連携型認定こども園おっこう山"),
    ("西区", "幼保連携型認定こども園持子保育園"),
    ("西区", "幼保連携型認定こども園YMCA保育園 おひさま分園"),
    ("西区", "学園みどりこども園"),
]

KOBE_DAREDEMO_IMPLEMENTATION_SOURCE = {
    "title": "令和７年度「神戸市こども誰でも通園制度」実施施設の拡充",
    "url": "https://www.city.kobe.lg.jp/a36812/610318071003.html",
    "source_kind": "official_html",
    "authority_level": "primary",
}


def classify_kobe_site_category(site_name: str) -> str:
    category_rules = [
        ("幼保連携型認定こども園", "幼保連携型認定こども園"),
        ("幼稚園型認定こども園", "幼稚園型認定こども園"),
        ("小規模保育園", "小規模保育園"),
        ("保育ルーム", "保育ルーム"),
        ("乳児園", "乳児園"),
        ("保育所", "保育所"),
        ("保育園", "保育園"),
        ("幼稚園", "幼稚園"),
        ("こども園", "認定こども園"),
    ]
    for marker, category in category_rules:
        if marker in site_name:
            return category
    return "その他"


IMPLEMENTATION_SITES = [
    {
        "entity_id": "CITY_KOBE",
        "fiscal_year": 2025,
        "site_key": f"kobe-daredemo-{index:02d}",
        "program_key": "kobe-daredemo-tsuen",
        "flow_parent_id": "REC_KOBE_DAREDEMO_SITES",
        "note_key": "kobe-daredemo-reviewed-2025",
        "site_name": site_name,
        "ward": ward,
        "site_category": classify_kobe_site_category(site_name),
        "operator_name": None,
        "started_on": "2025-07-01",
        "status_note": "2025年7月1日時点の神戸市実施施設。",
        "display_order": index * 10,
        "sources": [dict(KOBE_DAREDEMO_IMPLEMENTATION_SOURCE)],
    }
    for index, (ward, site_name) in enumerate(KOBE_DAREDEMO_SITE_ROWS, start=1)
]

IMPLEMENTATION_SITE_COORDINATE_HINTS: dict[str, dict[str, tuple[float, float]]] = {
    "CITY_KOBE": {
        "東灘区": (34.7206, 135.2661),
        "灘区": (34.7084, 135.2403),
        "中央区": (34.6908, 135.1954),
        "兵庫区": (34.6769, 135.1652),
        "北区": (34.7274, 135.1445),
        "長田区": (34.6659, 135.1447),
        "須磨区": (34.6566, 135.0957),
        "垂水区": (34.6390, 135.0504),
        "西区": (34.6765, 134.9933),
    }
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
        "20211223-mxt_kouhou02-000017672_1.pdf",
        "文部科学省 令和4年度予算のポイント",
    ),
    (
        "20230328-mxt_kouhou01-000024735_1.pdf",
        "文部科学省 令和5年度予算のポイント",
    ),
    (
        "20250305-ope_dev03-000037774-1.pdf",
        "文部科学省 令和7年度予算のポイント",
    ),
    (
        "20240326-ope_dev03-000031627-1.pdf",
        "文部科学省 令和6年度予算のポイント",
    ),
    (
        "000908162.pdf",
        "厚生労働省 令和4年度予算案の概要",
    ),
    (
        "23syokanyosan/dl/01-01.pdf",
        "厚生労働省 令和5年度予算案の概要",
    ),
    (
        "24syokanyosan/dl/01-01.pdf",
        "厚生労働省 令和6年度予算案の概要",
    ),
    (
        "25syokanyosan/dl/01-01.pdf",
        "厚生労働省 令和7年度予算案の概要",
    ),
    (
        "001460097.pdf",
        "国土交通省 令和4年度予算概要",
    ),
    (
        "001588099.pdf",
        "国土交通省 令和5年度予算概要",
    ),
    (
        "001720593.pdf",
        "国土交通省 令和6年度予算概要",
    ),
    (
        "yosan_fy2022/pdf/01.pdf",
        "経済産業省関係 令和3年度補正予算・令和4年度当初予算のポイント",
    ),
    (
        "yosan_fy2023/pdf/01.pdf",
        "経済産業省関係 令和4年度補正予算・令和5年度当初予算のポイント",
    ),
    (
        "yosan_fy2024/pdf/01.pdf",
        "経済産業省関係 令和5年度補正予算・令和6年度当初予算の概要",
    ),
    (
        "fy2025/pr/enj/siryo/01.pdf",
        "2025年度経済産業政策の重点",
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
    {
        "entity_id": "CITY_KOBE",
        "fiscal_year": 2025,
        "section_key": "overview",
        "title": "神戸市こども誰でも通園制度",
        "amount_text": "1.375億円",
        "amount_oku_yen": 1.375,
        "summary": "神戸市の令和7年度予算説明書では、保育振興費の内数として「こども誰でも通園制度 137,500千円」を計上しています。",
        "source_title": "神戸市 令和7年度予算説明書（こども家庭局）",
        "source_url": "https://www.city.kobe.lg.jp/documents/77626/r7kodomo.pdf#page=20&search=%E3%81%93%E3%81%A9%E3%82%82%E8%AA%B0%E3%81%A7%E3%82%82%E9%80%9A%E5%9C%92%E5%88%B6%E5%BA%A6",
        "page_number": 20,
        "display_order": 210,
    },
    {
        "entity_id": "CITY_KOBE",
        "fiscal_year": 2025,
        "section_key": "major_program",
        "title": "2025年7月1日時点の実施施設",
        "amount_text": "35施設",
        "summary": "2024年度から継続する21施設に、新規選定14施設を加えた35施設で開始しています。",
        "source_title": "令和7年度「神戸市こども誰でも通園制度」実施施設の拡充",
        "source_url": "https://www.city.kobe.lg.jp/a36812/610318071003.html",
        "display_order": 220,
    },
    {
        "entity_id": "CITY_KOBE",
        "fiscal_year": 2025,
        "section_key": "major_program",
        "title": "施設向け補助ルール",
        "amount_text": "0歳1,300円 / 1歳1,100円 / 2歳900円",
        "summary": "障害児・要支援家庭は 400円/時間、医療的ケア児は 2,400円/時間の加算。賃借料補助は 229,000円/月上限、改修費補助は 3,000,000円/施設上限です。",
        "source_title": "令和７年度神戸市こども誰でも通園制度 実施事業者募集要項",
        "source_url": "https://www.city.kobe.lg.jp/documents/78828/boshuyoukou_1.pdf",
        "display_order": 230,
    },
]


KNOWLEDGE_NOTES = [
    {
        "entity_id": "MIN_CFA",
        "fiscal_year": 2025,
        "note_key": "kodomo-daredemo-tsuen-official-flow",
        "title": "乳児等通園支援事業の公式フロー",
        "summary": "制度上の主な資金フローは、こども家庭庁から市町村を経て、確認を受けた実施施設・事業者へ流れる構造です。",
        "key_points": [
            "事業別資料集では、乳児等通園支援事業は <子ども・子育て支援交付金> の内数として整理されている。",
            "実施主体は市町村で、市町村が認めた者への委託等が可能と明記されている。",
            "想定事務フローでも、市町村が審査し、事業者に給付費を支払う構造が確認できる。",
        ],
        "doc_path": "docs/funding-knowledge/ministries/child-and-family-agency/KODOMO_DAREDEMO_TSUEN_FLOW_2025-2026.md",
        "display_order": 10,
        "sources": [
            {
                "title": "令和7年度こども家庭庁予算 事業別資料集",
                "url": "https://www.cfa.go.jp/assets/contents/node/basic_page/field_ref_resources/88749a20-e454-4a5b-9da8-3a32e1788a23/71b23f1a/20250326_policies_budget_67.pdf#page=95",
                "source_kind": "official_pdf",
                "authority_level": "primary",
            },
            {
                "title": "こども誰でも通園制度 公式ページ",
                "url": "https://www.cfa.go.jp/policies/hoiku/daredemo-tsuen",
                "source_kind": "official_html",
                "authority_level": "primary",
            },
            {
                "title": "乳児等通園支援事業に関する想定事務フロー【第1版】",
                "url": "https://www.cfa.go.jp/assets/contents/node/basic_page/field_ref_resources/0afde15f-8760-4477-806a-ed72b6916696/43ec0455/20260114_policies_hoiku_daredemo-tsuen_54.pdf",
                "source_kind": "official_pdf",
                "authority_level": "primary",
            },
        ],
    },
    {
        "entity_id": "MIN_CFA",
        "fiscal_year": 2025,
        "note_key": "kodomo-daredemo-tsuen-municipal-implementation",
        "title": "自治体別の実施状況と委託先",
        "summary": "制度の受け皿は社会福祉法人、学校法人、公立、株式会社など多様で、自治体によっては制度運営事務を別途民間ベンダーへ委託しています。",
        "key_points": [
            "こども家庭庁の令和6年度実施状況では、2025年7月時点で 118自治体 / 757か所が確認できる。",
            "神戸市、横浜市、静岡市、京都市で、実施施設や利用料の支払先に関する制度運用の違いが確認できる。",
            "広島市では、保育の受け皿とは別に、管理運用業務を TOPPAN へ委託する公募結果が公表されている。",
        ],
        "doc_path": "docs/funding-knowledge/ministries/child-and-family-agency/KODOMO_DAREDEMO_TSUEN_MUNICIPAL_IMPLEMENTATION_2026-03-13.md",
        "display_order": 20,
        "sources": [
            {
                "title": "こども誰でも通園制度 令和6年度の実施状況",
                "url": "https://www.cfa.go.jp/assets/contents/node/basic_page/field_ref_resources/c53b2923-930e-4490-9ea6-02f1b02f04dc/e23e860d/20250717_councils_daredemotsuen-kentokai_5ao3a471_02.pdf",
                "source_kind": "official_pdf",
                "authority_level": "primary",
            },
            {
                "title": "神戸市 こども誰でも通園制度",
                "url": "https://www.city.kobe.lg.jp/z/kodomokatekyoku/kosodateshien/daredemotuen.html",
                "source_kind": "official_html",
                "authority_level": "primary",
            },
            {
                "title": "横浜市 こども誰でも通園制度（乳児等通園支援事業）について",
                "url": "https://www.city.yokohama.lg.jp/kosodate-kyoiku/kosodateshien/azukari/daredemotsuuenn.html",
                "source_kind": "official_html",
                "authority_level": "primary",
            },
            {
                "title": "静岡市 乳児等通園支援事業（こども誰でも通園制度）利用のご案内",
                "url": "https://www.city.shizuoka.lg.jp/s4936/s012267.html",
                "source_kind": "official_html",
                "authority_level": "primary",
            },
            {
                "title": "京都市 京都市乳児等通園支援事業（こども誰でも通園制度）実施要綱",
                "url": "https://www.city.kyoto.lg.jp/hagukumi/page/0000340278.html",
                "source_kind": "official_html",
                "authority_level": "primary",
            },
            {
                "title": "広島市 乳児等通園支援事業に係る管理運用業務",
                "url": "https://www.city.hiroshima.lg.jp/business/nyusatsu/1006046/1006060/1046169/1046854.html",
                "source_kind": "official_html",
                "authority_level": "primary",
            },
            {
                "title": "広島市 管理運用業務 審査結果",
                "url": "https://www.city.hiroshima.lg.jp/_res/projects/default_project/_page_/001/046/854/20260212.pdf",
                "source_kind": "official_pdf",
                "authority_level": "primary",
            },
        ],
    },
    {
        "entity_id": "MIN_CFA",
        "fiscal_year": 2025,
        "note_key": "kodomo-daredemo-tsuen-municipal-comparison",
        "title": "自治体比較表",
        "summary": "神戸市、横浜市、静岡市、京都市、広島市を、実施規模、受け皿、利用料の支払先、行政運営委託の有無で比較した一覧です。",
        "key_points": [
            "全国概況として、2025年7月7日時点で 118自治体 / 757か所が確認できる。",
            "静岡市は利用料の施設直接払いを明示し、京都市は要綱上で委託先施設への支弁を規定している。",
            "広島市は制度運営の事務委託、神戸市・横浜市は実施施設の拡充・一覧公開の事例として対比できる。",
        ],
        "doc_path": "docs/funding-knowledge/ministries/child-and-family-agency/KODOMO_DAREDEMO_TSUEN_MUNICIPAL_COMPARISON_TABLE_2026-03-13.md",
        "display_order": 30,
        "sources": [
            {
                "title": "こども誰でも通園制度 令和6年度の実施状況",
                "url": "https://www.cfa.go.jp/assets/contents/node/basic_page/field_ref_resources/c53b2923-930e-4490-9ea6-02f1b02f04dc/e23e860d/20250717_councils_daredemotsuen-kentokai_5ao3a471_02.pdf",
                "source_kind": "official_pdf",
                "authority_level": "primary",
            },
            {
                "title": "神戸市 こども誰でも通園制度",
                "url": "https://www.city.kobe.lg.jp/z/kodomokatekyoku/kosodateshien/daredemotuen.html",
                "source_kind": "official_html",
                "authority_level": "primary",
            },
            {
                "title": "横浜市 こども誰でも通園制度（乳児等通園支援事業）について",
                "url": "https://www.city.yokohama.lg.jp/kosodate-kyoiku/kosodateshien/azukari/daredemotsuuenn.html",
                "source_kind": "official_html",
                "authority_level": "primary",
            },
            {
                "title": "静岡市 乳児等通園支援事業（こども誰でも通園制度）利用のご案内",
                "url": "https://www.city.shizuoka.lg.jp/s4936/s012267.html",
                "source_kind": "official_html",
                "authority_level": "primary",
            },
            {
                "title": "京都市 京都市乳児等通園支援事業（こども誰でも通園制度）実施要綱",
                "url": "https://www.city.kyoto.lg.jp/hagukumi/page/0000340278.html",
                "source_kind": "official_html",
                "authority_level": "primary",
            },
            {
                "title": "広島市 乳児等通園支援事業に係る管理運用業務",
                "url": "https://www.city.hiroshima.lg.jp/business/nyusatsu/1006046/1006060/1046169/1046854.html",
                "source_kind": "official_html",
                "authority_level": "primary",
            },
        ],
    },
    {
        "entity_id": "MIN_CFA",
        "fiscal_year": 2025,
        "note_key": "after-school-club-support-2025",
        "title": "放課後児童クラブ関係予算の支援内容とお金の流れ",
        "summary": "2025年度の放課後児童クラブ関係予算は、運営費・処遇改善、施設整備、研修、DX推進実証、巡回等サポートなどに分かれ、こども家庭庁から自治体や実施主体へ流れる構造です。",
        "key_points": [
            "放課後児童クラブ関係の主要 reviewed edge は、運営費・処遇改善 1,209億円、施設整備 143億円、研修関係 29億円、DX推進実証 1.1億円、巡回等サポート 11億円として 2025年度に整理されている。",
            "運営費・処遇改善はクラブ運営、支援員処遇改善、障害児受入加配、送迎支援を支える予算で、自治体から公営クラブや委託運営主体へ流れる。",
            "令和7年実施状況では、運営主体別クラブ数は 公立公営 5,800か所、公立民営 13,543か所、民立民営 6,585か所で、アプリではこのシェアを second hop の按分比率として使っている。",
            "施設整備は市町村主体の公立整備と社会福祉法人等主体の民間整備に分かれるが、執行額内訳は未公表のため、アプリではクラブ数シェアを proxy に second hop で按分している。",
            "公立整備ルートは市町村が設置主体であることが条件で、PFI整備後に市町村が買い取る方式も含まれる。",
            "創設では、本体工事費、工事請負費、工事事務費、既存建物買収費、賃借料加算等が対象になりうる一方、土地買収費や整地費、外構などは対象外とされる。",
            "創設の基準として、専用区画 1.65㎡/人以上、支援の単位ごとに職員2人以上、うち1人以上は放課後児童支援員、1単位おおむね40人以下が示されている。",
            "29億円の `こども政策推進事業費補助金（放課後関係）` のページで明示されているのは、放課後児童支援員認定資格研修事業と放課後児童支援員等資質向上研修事業であり、以前の `DX・体制強化 29億円` 表示より `研修関係 29億円` と読む方が正確である。",
            "研修関係の出口は、認定資格研修と資質向上研修の2本が確認できる。前者は都道府県・指定都市・中核市、後者は都道府県又は市町村が実施主体で、いずれも民間団体等への委託が可能である。",
            "研修関係の third-hop は、金額比率未公表のため `実施主体 / 受託事業者` の二系統を均等按分する model-based 表示にしている。東京都では株式会社東京リーガルマインド、山口県では特定非営利活動法人学童保育協会、新潟県では株式会社東京リーガルマインドへの委託例が確認できる。",
            "DXそのものは別建てで、放課後児童クラブ利用手続き等に関わるDX推進実証事業（仮称） 1.1億円が確認できる。市町村・運営法人/事業所・開発ベンダーで構成するコンソーシアム方式で、アプリでは費目別内訳未公表のため3者均等按分の model-based second hop を置いている。",
            "ICT化推進は 2,431億円の内数で、システム導入 50万円/か所、翻訳機等 15万円/か所の単価が示されている。",
            "千葉県の令和7年度協議施設一覧では、公立ルートの例として 船橋市 中野木第2放課後ルームや柏市立光ケ丘小こどもルーム第三保育室、民間ルートの例として シダックス大新東ヒューマンサービス株式会社、学校法人アゼリー学園、社会福祉法人佐原めぐみ会が確認できる。",
            "第三者評価受審推進事業と利用調整支援事業は 1,209億円 の運営費等の並びで確認できるが、個別金額は切れていない。巡回等サポートは要支援児対応や巡回アドバイザー配置を支える。",
        ],
        "doc_path": "docs/funding-knowledge/ministries/child-and-family-agency/AFTER_SCHOOL_CLUB_SUPPORT_2025.md",
        "display_order": 40,
        "sources": [
            {
                "title": "令和7年度こども家庭庁予算 事業別資料集",
                "url": "https://www.cfa.go.jp/assets/contents/node/basic_page/field_ref_resources/88749a20-e454-4a5b-9da8-3a32e1788a23/71b23f1a/20250326_policies_budget_67.pdf#page=74",
                "source_kind": "official_pdf",
                "authority_level": "primary",
            },
            {
                "title": "放課後児童健全育成事業について",
                "url": "https://www.cfa.go.jp/policies/kosodateshien/houkago-jidou/overview",
                "source_kind": "official_html",
                "authority_level": "primary",
            },
            {
                "title": "令和7年 放課後児童健全育成事業（放課後児童クラブ）の実施状況",
                "url": "https://www.cfa.go.jp/assets/contents/node/basic_page/field_ref_resources/69799c33-85cb-44f6-8c70-08ed3a292ab5/c253a682/20251222_policies_kosodateshien_houkago-jidou_80.pdf#page=9",
                "source_kind": "official_pdf",
                "authority_level": "primary",
            },
            {
                "title": "令和7年度 こども・子育て支援関係予算のポイント",
                "url": "https://www.cfa.go.jp/assets/contents/node/basic_page/field_ref_resources/efa58163-4cc2-43d6-ba57-3df41d552a52/857bf219/20241227_policies_kosodateshien_budget_07.pdf#page=18",
                "source_kind": "official_pdf",
                "authority_level": "primary",
            },
            {
                "title": "令和7年度こども家庭庁予算 事業別資料集",
                "url": "https://www.cfa.go.jp/assets/contents/node/basic_page/field_ref_resources/88749a20-e454-4a5b-9da8-3a32e1788a23/71b23f1a/20250326_policies_budget_67.pdf#page=19",
                "source_kind": "official_pdf",
                "authority_level": "primary",
            },
            {
                "title": "令和7年度こども家庭庁予算 事業別資料集",
                "url": "https://www.cfa.go.jp/assets/contents/node/basic_page/field_ref_resources/88749a20-e454-4a5b-9da8-3a32e1788a23/71b23f1a/20250326_policies_budget_67.pdf#page=20",
                "source_kind": "official_pdf",
                "authority_level": "primary",
            },
            {
                "title": "令和7年度こども家庭庁予算 事業別資料集",
                "url": "https://www.cfa.go.jp/assets/contents/node/basic_page/field_ref_resources/88749a20-e454-4a5b-9da8-3a32e1788a23/71b23f1a/20250326_policies_budget_67.pdf#page=75",
                "source_kind": "official_pdf",
                "authority_level": "primary",
            },
            {
                "title": "放課後児童支援員等研修事業実施要綱",
                "url": "https://www.cfa.go.jp/assets/contents/node/basic_page/field_ref_resources/e28ec5c7-3af2-465e-82fa-040a88ce0ba2/950b9dad/20251125_councils_shingikai_kodomo_ibasho_jidoukan_e28ec5c7_17.pdf#page=1",
                "source_kind": "official_pdf",
                "authority_level": "primary",
            },
            {
                "title": "東京都 放課後児童支援員認定資格研修",
                "url": "https://www.fukushi.metro.tokyo.lg.jp/kodomo/hoiku/gakudou_jidoukan/houkagojidoushienin_nintei",
                "source_kind": "official_html",
                "authority_level": "primary",
            },
            {
                "title": "山口県 令和7年度放課後児童支援員認定資格研修",
                "url": "https://www.pref.yamaguchi.lg.jp/soshiki/51/152717.html",
                "source_kind": "official_html",
                "authority_level": "primary",
            },
            {
                "title": "新潟県 放課後児童支援員研修（認定資格研修・資質向上研修）開催案内",
                "url": "https://www.pref.niigata.lg.jp/sec/kodomokatei/13569249670772.html",
                "source_kind": "official_html",
                "authority_level": "primary",
            },
            {
                "title": "令和7年度 こども・子育て支援関係予算のポイント",
                "url": "https://www.cfa.go.jp/assets/contents/node/basic_page/field_ref_resources/efa58163-4cc2-43d6-ba57-3df41d552a52/857bf219/20241227_policies_kosodateshien_budget_07.pdf#page=26",
                "source_kind": "official_pdf",
                "authority_level": "primary",
            },
            {
                "title": "千葉県 放課後児童健全育成事業について",
                "url": "https://www.pref.chiba.lg.jp/kosodate/hoikusho/houkago/shishin.html",
                "source_kind": "official_html",
                "authority_level": "primary",
            },
            {
                "title": "令和7年度子ども・子育て支援施設整備交付金協議施設一覧",
                "url": "https://www.pref.chiba.lg.jp/kosodate/hoikusho/houkago/documents/seibiitiran.pdf",
                "source_kind": "official_pdf",
                "authority_level": "primary",
            },
            {
                "title": "子ども・子育て支援施設整備交付金の交付について",
                "url": "https://www.cfa.go.jp/assets/contents/node/basic_page/field_ref_resources/0abf2f27-1ebe-4fa2-bab8-362dd67ffc4b/f0bce416/20250425_policies_kosodateshien_houkago-jidou_hourei-tsuuti_65.pdf",
                "source_kind": "official_pdf",
                "authority_level": "primary",
            },
            {
                "title": "子ども・子育て支援施設整備交付金に係る施設整備の取扱い",
                "url": "https://www.cfa.go.jp/assets/contents/node/basic_page/field_ref_resources/0abf2f27-1ebe-4fa2-bab8-362dd67ffc4b/01d80820/20250425_policies_kosodateshien_houkago-jidou_hourei-tsuuti_66.pdf",
                "source_kind": "official_pdf",
                "authority_level": "primary",
            },
            {
                "title": "放課後児童健全育成事業の設備及び運営に関する基準について",
                "url": "https://www.cfa.go.jp/assets/contents/node/basic_page/field_ref_resources/27f4a5b4-53c9-446d-ab3d-7c7055949a26/6ad7465b/20230929_policies_kokoseido_law_tsuuchi_tsuuchi-h24-h29_635.pdf",
                "source_kind": "official_pdf",
                "authority_level": "primary",
            },
            {
                "title": "放課後児童健全育成事業の「児童の数」の具体的な算出方法の例",
                "url": "https://www.cfa.go.jp/assets/contents/node/basic_page/field_ref_resources/0abf2f27-1ebe-4fa2-bab8-362dd67ffc4b/f4bc9772/20250513_policies_kosodateshien_houkago-jidou_hourei-tsuuti_67.pdf",
                "source_kind": "official_pdf",
                "authority_level": "primary",
            },
        ],
    },
    {
        "entity_id": "CITY_KOBE",
        "fiscal_year": 2025,
        "note_key": "kobe-daredemo-reviewed-2025",
        "title": "神戸市こども誰でも通園制度の reviewed メモ",
        "summary": "神戸市では令和7年度予算説明書で 137,500千円を計上し、2025年7月1日時点で35施設、2026年3月5日時点で44施設へ拡充しています。",
        "key_points": [
            "令和7年度予算説明書の保育振興費では、こども誰でも通園制度 137,500千円が確認できる。",
            "2025年5月21日の公式発表では、継続21施設に新規14施設を加え、2025年7月1日時点で35施設として開始している。",
            "実施事業者募集要項では、0歳1,300円、1歳1,100円、2歳900円の時間単価に加え、賃借料と改修費の補助上限が示されている。",
            "神戸市の制度ページでは、2026年3月5日時点で44施設、利用者負担は300円/時間として案内されている。",
            "制度全体では、認可外保育施設も指導監督基準適合と市町村認可を満たせば参加可能だが、神戸市の35施設は保育所・認定こども園・幼稚園中心である。",
        ],
        "doc_path": "docs/funding-knowledge/local-governments/hyogo/KOBE_DAREDEMO_TSUEN_2025.md",
        "display_order": 210,
        "sources": [
            {
                "title": "神戸市 令和7年度予算説明書（こども家庭局）",
                "url": "https://www.city.kobe.lg.jp/documents/77626/r7kodomo.pdf#page=20&search=%E3%81%93%E3%81%A9%E3%82%82%E8%AA%B0%E3%81%A7%E3%82%82%E9%80%9A%E5%9C%92%E5%88%B6%E5%BA%A6",
                "source_kind": "official_pdf",
                "authority_level": "primary",
            },
            {
                "title": "令和７年度「神戸市こども誰でも通園制度」実施施設の拡充",
                "url": "https://www.city.kobe.lg.jp/a36812/610318071003.html",
                "source_kind": "official_html",
                "authority_level": "primary",
            },
            {
                "title": "令和７年度神戸市こども誰でも通園制度 実施事業者募集要項",
                "url": "https://www.city.kobe.lg.jp/documents/78828/boshuyoukou_1.pdf",
                "source_kind": "official_pdf",
                "authority_level": "primary",
            },
            {
                "title": "神戸市こども誰でも通園制度",
                "url": "https://www.city.kobe.lg.jp/z/kodomokatekyoku/kosodateshien/daredemotuen.html",
                "source_kind": "official_html",
                "authority_level": "primary",
            },
            {
                "title": "こども誰でも通園制度の制度化、本格実施に向けた検討状況",
                "url": "https://www.cfa.go.jp/assets/contents/node/basic_page/field_ref_resources/c53b2923-930e-4490-9ea6-02f1b02f04dc/44d27b3b/20250717_councils_daredemotsuen-kentokai_5ao3a471_12.pdf",
                "source_kind": "official_pdf",
                "authority_level": "primary",
            },
            {
                "title": "乳児等通園支援事業の設備及び運営に関する基準の運用上の取扱い",
                "url": "https://www.cfa.go.jp/assets/contents/node/basic_page/field_ref_resources/0afde15f-8760-4477-806a-ed72b6916696/a054b63b/20260202_policies_hoiku_daredemo-tsuen_58.pdf",
                "source_kind": "official_pdf",
                "authority_level": "primary",
            },
            {
                "title": "乳児等通園支援事業の認可について",
                "url": "https://www.cfa.go.jp/assets/contents/node/basic_page/field_ref_resources/0afde15f-8760-4477-806a-ed72b6916696/64ee3bf1/20250226_policies_hoiku_daredemo-tsuen_09.pdf",
                "source_kind": "official_pdf",
                "authority_level": "primary",
            },
        ],
    },
    {
        "entity_id": "MIN_MHLW",
        "fiscal_year": 2025,
        "note_key": "mhlw-reviewed-budget-2025",
        "title": "令和7年度厚生労働省予算の reviewed 要約",
        "summary": "厚生労働省の令和7年度一般会計予算は 34兆3,064億円で、その大半を社会保障関係費が占めています。",
        "key_points": [
            "社会保障関係費は 33兆9,883億円で、一般会計の中心的な政策枠になっている。",
            "増要因では年金が +2,892億円で最大、医療が +1,170億円、福祉等が +635億円で続く。",
            "個別施策では、地域包括ケアシステムの推進 2,470億円や、リ・スキリングによる能力向上支援等 1,593億円が reviewed 主要事業として載っている。",
        ],
        "doc_path": "docs/funding-knowledge/ministries/health-labour-welfare/MHLW_REVIEWED_BUDGET_2025.md",
        "display_order": 110,
        "sources": [
            {
                "title": "厚生労働省 令和7年度予算案の概要",
                "url": "https://www.mhlw.go.jp/wp/yosan/yosan/25syokanyosan/dl/01-01.pdf#page=2&search=%E4%B8%80%E8%88%AC%E4%BC%9A%E8%A8%88",
                "source_kind": "official_pdf",
                "authority_level": "primary",
            },
            {
                "title": "厚生労働省 令和7年度予算案の概要",
                "url": "https://www.mhlw.go.jp/wp/yosan/yosan/25syokanyosan/dl/01-01.pdf#page=3&search=%E5%B9%B4%E9%87%91",
                "source_kind": "official_pdf",
                "authority_level": "primary",
            },
            {
                "title": "厚生労働省 令和7年度予算案の概要",
                "url": "https://www.mhlw.go.jp/wp/yosan/yosan/25syokanyosan/dl/01-01.pdf#page=6&search=%E5%9C%B0%E5%9F%9F%E5%8C%85%E6%8B%AC%E3%82%B1%E3%82%A2",
                "source_kind": "official_pdf",
                "authority_level": "primary",
            },
        ],
    },
    {
        "entity_id": "MIN_MEXT",
        "fiscal_year": 2025,
        "note_key": "mext-reviewed-budget-2025",
        "title": "令和7年度文部科学省予算の reviewed 要約",
        "summary": "文部科学省の令和7年度一般会計予算は 5兆5,094億円で、義務教育費と科学技術予算が大きな柱になっています。",
        "key_points": [
            "義務教育費国庫負担金は 1兆6,210億円で、学校教育の基盤的経費として最大級の政策枠になっている。",
            "科学技術予算は 9,777億円で、研究開発・イノベーション政策の中心枠として整理されている。",
            "個別施策では、科学研究費助成事業（科研費） 2,379億円が reviewed 主要事業として掲載されている。",
        ],
        "doc_path": "docs/funding-knowledge/ministries/education-culture-sports-science-and-technology/MEXT_REVIEWED_BUDGET_2025.md",
        "display_order": 120,
        "sources": [
            {
                "title": "文部科学省 令和7年度予算のポイント",
                "url": "https://www.mext.go.jp/content/20250305-ope_dev03-000037774-1.pdf#page=2&search=%E4%B8%80%E8%88%AC%E4%BC%9A%E8%A8%88",
                "source_kind": "official_pdf",
                "authority_level": "primary",
            },
            {
                "title": "文部科学省 令和7年度予算のポイント",
                "url": "https://www.mext.go.jp/content/20250305-ope_dev03-000037774-1.pdf#page=3&search=%E7%BE%A9%E5%8B%99%E6%95%99%E8%82%B2%E8%B2%BB",
                "source_kind": "official_pdf",
                "authority_level": "primary",
            },
            {
                "title": "令和7年度予算のポイント",
                "url": "https://www.mext.go.jp/content/20250305-ope_dev03-000037774-1.pdf#page=68&search=%E7%A7%91%E5%AD%A6%E7%A0%94%E7%A9%B6%E8%B2%BB%E5%8A%A9%E6%88%90%E4%BA%8B%E6%A5%AD",
                "source_kind": "official_pdf",
                "authority_level": "primary",
            },
        ],
    },
    {
        "entity_id": "MIN_MLIT",
        "fiscal_year": 2024,
        "note_key": "mlit-reviewed-budget-2024",
        "title": "令和6年度国土交通省予算の reviewed 要約",
        "summary": "国土交通省関係の令和6年度予算は 5兆9,537億円で、公共事業関係費が予算の大宗を占めています。",
        "key_points": [
            "公共事業関係費は 5兆2,901億円で、一般会計の大半を占める政策枠になっている。",
            "重点施策では、流域治水の加速化・強化 6,114億円、効率的な物流ネットワークの早期整備・活用 3,802億円が reviewed 主要事業として整理されている。",
            "住宅・建築物の省エネ対策等の強化 1,103億円も、GX とストック活用の重点施策として掲載されている。",
        ],
        "doc_path": "docs/funding-knowledge/ministries/land-infrastructure-transport-and-tourism/MLIT_REVIEWED_BUDGET_2024.md",
        "display_order": 130,
        "sources": [
            {
                "title": "国土交通省 令和6年度予算概要",
                "url": "https://www.mlit.go.jp/page/content/001720593.pdf#page=4&search=%E4%B8%80%E8%88%AC%E4%BC%9A%E8%A8%88",
                "source_kind": "official_pdf",
                "authority_level": "primary",
            },
            {
                "title": "国土交通省 令和6年度予算概要",
                "url": "https://www.mlit.go.jp/page/content/001720593.pdf#page=4&search=%E5%85%AC%E5%85%B1%E4%BA%8B%E6%A5%AD%E9%96%A2%E4%BF%82%E8%B2%BB",
                "source_kind": "official_pdf",
                "authority_level": "primary",
            },
            {
                "title": "国土交通省 令和6年度予算概要",
                "url": "https://www.mlit.go.jp/page/content/001720593.pdf#page=6&search=%E6%B5%81%E5%9F%9F%E6%B2%BB%E6%B0%B4",
                "source_kind": "official_pdf",
                "authority_level": "primary",
            },
        ],
    },
    {
        "entity_id": "MIN_METI",
        "fiscal_year": 2025,
        "note_key": "meti-reviewed-budget-2025",
        "title": "2025年度経済産業省関連予算の reviewed 要約",
        "summary": "経済産業省関連予算の総額は 2兆524億円で、GX・エネルギー、AI・半導体、イノベーション支援が主要な柱です。",
        "key_points": [
            "GX・エネルギー安定供給の確保は 1兆28億円で、最大の政策枠として整理されている。",
            "AI・半導体等の産業基盤強化は 3,818億円で、先端産業政策の重点枠になっている。",
            "個別施策では、ポスト5G情報通信システム基盤強化研究開発事業 1,617億円、次世代半導体の量産等に向けた出資事業 1,000億円が reviewed 主要事業として掲載されている。",
        ],
        "doc_path": "docs/funding-knowledge/ministries/economy-trade-and-industry/METI_REVIEWED_BUDGET_2025.md",
        "display_order": 140,
        "sources": [
            {
                "title": "2025年度経済産業政策の重点",
                "url": "https://www.meti.go.jp/main/yosangaisan/fy2025/pr/enj/siryo/01.pdf#page=2&search=%E7%B7%8F%E9%A1%8D",
                "source_kind": "official_pdf",
                "authority_level": "primary",
            },
            {
                "title": "2025年度経済産業政策の重点",
                "url": "https://www.meti.go.jp/main/yosangaisan/fy2025/pr/enj/siryo/01.pdf#page=2&search=GX%E3%83%BB%E3%82%A8%E3%83%8D%E3%83%AB%E3%82%AE%E3%83%BC",
                "source_kind": "official_pdf",
                "authority_level": "primary",
            },
            {
                "title": "2025年度経済産業政策の重点",
                "url": "https://www.meti.go.jp/main/yosangaisan/fy2025/pr/enj/siryo/01.pdf#page=6&search=%E3%83%9D%E3%82%B9%E3%83%885G",
                "source_kind": "official_pdf",
                "authority_level": "primary",
            },
        ],
    },
]

STRUCTURED_FACTS = [
    {
        "entity_id": "MIN_CFA",
        "fiscal_year": 2025,
        "fact_key": "kodomo-daredemo-tsuen-budget-frame",
        "fact_group": "budget",
        "title": "予算上の位置づけ",
        "value_text": "2,431億円の内数 + 事項要求 2,074億円の内数",
        "numeric_value": 2431,
        "unit": "億円",
        "summary": "乳児等通園支援事業は <子ども・子育て支援交付金> の内数として整理され、追加で事項要求が示されています。",
        "note_key": "kodomo-daredemo-tsuen-official-flow",
        "source_excerpt": "<子ども・子育て支援交付金> 2,431億円の内数 + 事項要求 2,074億円の内数",
        "display_order": 10,
        "sources": [
            {
                "title": "令和7年度こども家庭庁予算 事業別資料集",
                "url": "https://www.cfa.go.jp/assets/contents/node/basic_page/field_ref_resources/88749a20-e454-4a5b-9da8-3a32e1788a23/71b23f1a/20250326_policies_budget_67.pdf#page=95",
                "source_kind": "official_pdf",
                "authority_level": "primary",
            },
        ],
    },
    {
        "entity_id": "MIN_CFA",
        "fiscal_year": 2025,
        "fact_key": "kodomo-daredemo-tsuen-implementer",
        "fact_group": "governance",
        "title": "実施主体",
        "value_text": "市町村",
        "summary": "制度資料では実施主体を市町村とし、市町村が認めた者への委託等を可能としています。",
        "note_key": "kodomo-daredemo-tsuen-official-flow",
        "source_excerpt": "実施主体は市町村。市町村が認めた者への委託等可。",
        "display_order": 20,
        "sources": [
            {
                "title": "令和7年度こども家庭庁予算 事業別資料集",
                "url": "https://www.cfa.go.jp/assets/contents/node/basic_page/field_ref_resources/88749a20-e454-4a5b-9da8-3a32e1788a23/71b23f1a/20250326_policies_budget_67.pdf#page=95",
                "source_kind": "official_pdf",
                "authority_level": "primary",
            },
        ],
    },
    {
        "entity_id": "MIN_CFA",
        "fiscal_year": 2025,
        "fact_key": "kodomo-daredemo-tsuen-national-share",
        "fact_group": "cost_share",
        "title": "国負担割合",
        "value_text": "3/4",
        "numeric_value": 0.75,
        "unit": "share",
        "summary": "制度資料では、国 3/4・市町村 1/4 の補助割合が示されています。",
        "note_key": "kodomo-daredemo-tsuen-official-flow",
        "source_excerpt": "補助割合は国3/4・市町村1/4。",
        "display_order": 30,
        "sources": [
            {
                "title": "令和7年度こども家庭庁予算 事業別資料集",
                "url": "https://www.cfa.go.jp/assets/contents/node/basic_page/field_ref_resources/88749a20-e454-4a5b-9da8-3a32e1788a23/71b23f1a/20250326_policies_budget_67.pdf#page=95",
                "source_kind": "official_pdf",
                "authority_level": "primary",
            },
        ],
    },
    {
        "entity_id": "MIN_CFA",
        "fiscal_year": 2025,
        "fact_key": "kodomo-daredemo-tsuen-municipal-share",
        "fact_group": "cost_share",
        "title": "市町村負担割合",
        "value_text": "1/4",
        "numeric_value": 0.25,
        "unit": "share",
        "summary": "国費だけで完結せず、市町村負担を含む制度として運用されます。",
        "note_key": "kodomo-daredemo-tsuen-official-flow",
        "source_excerpt": "補助割合は国3/4・市町村1/4。",
        "display_order": 40,
        "sources": [
            {
                "title": "令和7年度こども家庭庁予算 事業別資料集",
                "url": "https://www.cfa.go.jp/assets/contents/node/basic_page/field_ref_resources/88749a20-e454-4a5b-9da8-3a32e1788a23/71b23f1a/20250326_policies_budget_67.pdf#page=95",
                "source_kind": "official_pdf",
                "authority_level": "primary",
            },
        ],
    },
    {
        "entity_id": "MIN_CFA",
        "fiscal_year": 2025,
        "fact_key": "kodomo-daredemo-tsuen-rollout-municipalities",
        "fact_group": "rollout",
        "title": "実施自治体数",
        "value_text": "118自治体",
        "numeric_value": 118,
        "unit": "自治体",
        "summary": "2025年7月7日時点で制度実施が確認できる自治体数です。",
        "note_key": "kodomo-daredemo-tsuen-municipal-implementation",
        "source_excerpt": "令和6年度の実施状況として 118自治体 が掲載されています。",
        "display_order": 50,
        "sources": [
            {
                "title": "こども誰でも通園制度 令和6年度の実施状況",
                "url": "https://www.cfa.go.jp/assets/contents/node/basic_page/field_ref_resources/c53b2923-930e-4490-9ea6-02f1b02f04dc/e23e860d/20250717_councils_daredemotsuen-kentokai_5ao3a471_02.pdf",
                "source_kind": "official_pdf",
                "authority_level": "primary",
            },
        ],
    },
    {
        "entity_id": "MIN_CFA",
        "fiscal_year": 2025,
        "fact_key": "kodomo-daredemo-tsuen-rollout-sites",
        "fact_group": "rollout",
        "title": "実施事業所数",
        "value_text": "757か所",
        "numeric_value": 757,
        "unit": "か所",
        "summary": "同じ集計時点で確認できる実施施設・事業所数です。",
        "note_key": "kodomo-daredemo-tsuen-municipal-implementation",
        "source_excerpt": "令和6年度の実施状況として 757か所 が掲載されています。",
        "display_order": 60,
        "sources": [
            {
                "title": "こども誰でも通園制度 令和6年度の実施状況",
                "url": "https://www.cfa.go.jp/assets/contents/node/basic_page/field_ref_resources/c53b2923-930e-4490-9ea6-02f1b02f04dc/e23e860d/20250717_councils_daredemotsuen-kentokai_5ao3a471_02.pdf",
                "source_kind": "official_pdf",
                "authority_level": "primary",
            },
        ],
    },
    {
        "entity_id": "MIN_CFA",
        "fiscal_year": 2025,
        "fact_key": "after-school-club-op-budget-2025",
        "fact_group": "after_school_club",
        "title": "運営費・処遇改善",
        "value_text": "1,209億円",
        "numeric_value": 1209,
        "unit": "億円",
        "summary": "放課後児童クラブの運営費、放課後児童支援員の処遇改善、障害児受入加配、送迎支援などを支える予算です。",
        "note_key": "after-school-club-support-2025",
        "source_excerpt": "放課後児童クラブの運営費、放課後児童支援員の処遇改善（月額9,000円等）、障害児受入加配、送迎支援など",
        "display_order": 70,
        "sources": [
            {
                "title": "令和7年度こども家庭庁予算 事業別資料集",
                "url": "https://www.cfa.go.jp/assets/contents/node/basic_page/field_ref_resources/88749a20-e454-4a5b-9da8-3a32e1788a23/71b23f1a/20250326_policies_budget_67.pdf#page=74&search=1%2C209",
                "source_kind": "official_pdf",
                "authority_level": "primary",
            },
            {
                "title": "放課後児童健全育成事業について",
                "url": "https://www.cfa.go.jp/policies/kosodateshien/houkago-jidou/overview",
                "source_kind": "official_html",
                "authority_level": "primary",
            },
        ],
    },
    {
        "entity_id": "MIN_CFA",
        "fiscal_year": 2025,
        "fact_key": "after-school-club-fac-budget-2025",
        "fact_group": "after_school_club",
        "title": "施設整備",
        "value_text": "143億円",
        "numeric_value": 143,
        "unit": "億円",
        "summary": "既存施設を活用した改修、新たなクラブ実施のための環境整備、アパート等活用費を含む整備予算です。",
        "note_key": "after-school-club-support-2025",
        "source_excerpt": "既存施設を活用した改修等、新たなクラブ実施のための環境整備やアパート等活用費（賃借料）",
        "display_order": 80,
        "sources": [
            {
                "title": "令和7年度こども家庭庁予算 事業別資料集",
                "url": "https://www.cfa.go.jp/assets/contents/node/basic_page/field_ref_resources/88749a20-e454-4a5b-9da8-3a32e1788a23/71b23f1a/20250326_policies_budget_67.pdf#page=74&search=143",
                "source_kind": "official_pdf",
                "authority_level": "primary",
            },
            {
                "title": "令和7年度 こども・子育て支援関係予算のポイント",
                "url": "https://www.cfa.go.jp/assets/contents/node/basic_page/field_ref_resources/efa58163-4cc2-43d6-ba57-3df41d552a52/857bf219/20241227_policies_kosodateshien_budget_07.pdf#page=19",
                "source_kind": "official_pdf",
                "authority_level": "primary",
            },
        ],
    },
    {
        "entity_id": "MIN_CFA",
        "fiscal_year": 2025,
        "fact_key": "after-school-club-training-budget-2025",
        "fact_group": "after_school_club",
        "title": "研修関係",
        "value_text": "29億円",
        "numeric_value": 29,
        "unit": "億円",
        "summary": "こども政策推進事業費補助金（放課後関係）29億円のページで明示されているのは、放課後児童支援員認定資格研修事業と放課後児童支援員等資質向上研修事業です。",
        "note_key": "after-school-club-support-2025",
        "source_excerpt": "放課後児童支援員認定資格研修事業、放課後児童支援員等資質向上研修事業",
        "display_order": 90,
        "sources": [
            {
                "title": "令和7年度こども家庭庁予算 事業別資料集",
                "url": "https://www.cfa.go.jp/assets/contents/node/basic_page/field_ref_resources/88749a20-e454-4a5b-9da8-3a32e1788a23/71b23f1a/20250326_policies_budget_67.pdf#page=75&search=%E7%A0%94%E4%BF%AE",
                "source_kind": "official_pdf",
                "authority_level": "primary",
            },
        ],
    },
    {
        "entity_id": "MIN_CFA",
        "fiscal_year": 2025,
        "fact_key": "after-school-club-dx-pilot-budget-2025",
        "fact_group": "after_school_club",
        "title": "DX推進実証",
        "value_text": "1.1億円",
        "numeric_value": 1.1,
        "unit": "億円",
        "summary": "放課後児童クラブ利用手続き等に関わるDX推進実証事業は、市町村による総合的なDX実証を支える別建て事業です。",
        "note_key": "after-school-club-support-2025",
        "source_excerpt": "放課後児童クラブ利用手続き等に関わるDX推進実証事業（仮称） 令和７年度概算要求額 1.1億円",
        "display_order": 95,
        "sources": [
            {
                "title": "令和7年度こども家庭庁予算 事業別資料集",
                "url": "https://www.cfa.go.jp/assets/contents/node/basic_page/field_ref_resources/88749a20-e454-4a5b-9da8-3a32e1788a23/71b23f1a/20250326_policies_budget_67.pdf#page=19&search=1.1%E5%84%84%E5%86%86",
                "source_kind": "official_pdf",
                "authority_level": "primary",
            },
        ],
    },
    {
        "entity_id": "MIN_CFA",
        "fiscal_year": 2025,
        "fact_key": "after-school-club-training-certification-2025",
        "fact_group": "after_school_club",
        "title": "認定資格研修",
        "value_text": "都道府県・指定都市・中核市が実施、市町村や民間団体等へ一部委託可",
        "summary": "放課後児童支援員として認定されるために修了が義務づけられている研修です。",
        "note_key": "after-school-club-support-2025",
        "source_excerpt": "放課後児童支援員認定資格研修事業。都道府県・指定都市・中核市が実施主体。一部委託可能。",
        "display_order": 92,
        "sources": [
            {
                "title": "放課後児童支援員等研修事業実施要綱",
                "url": "https://www.cfa.go.jp/assets/contents/node/basic_page/field_ref_resources/e28ec5c7-3af2-465e-82fa-040a88ce0ba2/950b9dad/20251125_councils_shingikai_kodomo_ibasho_jidoukan_e28ec5c7_17.pdf#page=1",
                "source_kind": "official_pdf",
                "authority_level": "primary",
            },
        ],
    },
    {
        "entity_id": "MIN_CFA",
        "fiscal_year": 2025,
        "fact_key": "after-school-club-training-upskilling-2025",
        "fact_group": "after_school_club",
        "title": "資質向上研修",
        "value_text": "都道府県又は市町村が実施、民間団体等へ全部又は一部委託可",
        "summary": "放課後児童クラブの現任職員向けに実施する資質向上研修です。",
        "note_key": "after-school-club-support-2025",
        "source_excerpt": "放課後児童支援員等資質向上研修事業。都道府県又は市町村が実施主体。全部又は一部委託可能。",
        "display_order": 93,
        "sources": [
            {
                "title": "放課後児童支援員等研修事業実施要綱",
                "url": "https://www.cfa.go.jp/assets/contents/node/basic_page/field_ref_resources/e28ec5c7-3af2-465e-82fa-040a88ce0ba2/950b9dad/20251125_councils_shingikai_kodomo_ibasho_jidoukan_e28ec5c7_17.pdf#page=1",
                "source_kind": "official_pdf",
                "authority_level": "primary",
            },
        ],
    },
    {
        "entity_id": "MIN_CFA",
        "fiscal_year": 2025,
        "fact_key": "after-school-club-training-certification-examples-2025",
        "fact_group": "after_school_club",
        "title": "認定資格研修の受け皿例",
        "value_text": "東京都=東京リーガルマインド、山口県=NPO法人学童保育協会、新潟県=東京リーガルマインド",
        "summary": "認定資格研修では、都道府県等が実施主体となり、民間事業者やNPOに委託するルートが自治体公表資料で確認できます。",
        "note_key": "after-school-club-support-2025",
        "source_excerpt": "東京都では株式会社東京リーガルマインド、山口県では特定非営利活動法人学童保育協会、新潟県では株式会社東京リーガルマインドへの委託例が確認できる。",
        "display_order": 94,
        "sources": [
            {
                "title": "東京都 放課後児童支援員認定資格研修",
                "url": "https://www.fukushi.metro.tokyo.lg.jp/kodomo/hoiku/gakudou_jidoukan/houkagojidoushienin_nintei",
                "source_kind": "official_html",
                "authority_level": "primary",
            },
            {
                "title": "山口県 令和7年度放課後児童支援員認定資格研修",
                "url": "https://www.pref.yamaguchi.lg.jp/soshiki/51/152717.html",
                "source_kind": "official_html",
                "authority_level": "primary",
            },
            {
                "title": "新潟県 放課後児童支援員研修（認定資格研修・資質向上研修）開催案内",
                "url": "https://www.pref.niigata.lg.jp/sec/kodomokatei/13569249670772.html",
                "source_kind": "official_html",
                "authority_level": "primary",
            },
        ],
    },
    {
        "entity_id": "MIN_CFA",
        "fiscal_year": 2025,
        "fact_key": "after-school-club-training-upskilling-examples-2025",
        "fact_group": "after_school_club",
        "title": "資質向上研修の受け皿例",
        "value_text": "新潟県=東京リーガルマインド、千葉県・福島県=委託仕様書/公募資料あり",
        "summary": "資質向上研修では、都道府県又は市町村が実施主体となり、民間事業者へ委託するルートが自治体資料で確認できます。",
        "note_key": "after-school-club-support-2025",
        "source_excerpt": "新潟県では株式会社東京リーガルマインドへの委託例が確認でき、千葉県や福島県でも委託仕様書・公募資料が公表されている。",
        "display_order": 95,
        "sources": [
            {
                "title": "新潟県 放課後児童支援員研修（認定資格研修・資質向上研修）開催案内",
                "url": "https://www.pref.niigata.lg.jp/sec/kodomokatei/13569249670772.html",
                "source_kind": "official_html",
                "authority_level": "primary",
            },
            {
                "title": "放課後児童支援員等研修事業実施要綱",
                "url": "https://www.cfa.go.jp/assets/contents/node/basic_page/field_ref_resources/e28ec5c7-3af2-465e-82fa-040a88ce0ba2/950b9dad/20251125_councils_shingikai_kodomo_ibasho_jidoukan_e28ec5c7_17.pdf#page=1",
                "source_kind": "official_pdf",
                "authority_level": "primary",
            },
        ],
    },
    {
        "entity_id": "MIN_CFA",
        "fiscal_year": 2025,
        "fact_key": "after-school-club-dx-pilot-consortium-2025",
        "fact_group": "after_school_club",
        "title": "DX推進実証の受け皿",
        "value_text": "市町村、放課後児童クラブ運営法人・事業所、開発ベンダー",
        "summary": "DX推進実証は、市町村が設置するコンソーシアム方式で行われ、構成員として運営法人・事業所と開発ベンダーが明示されています。",
        "note_key": "after-school-club-support-2025",
        "source_excerpt": "放課後児童クラブＤＸを推進するためのコンソーシアム（構成員：市町村、放課後児童クラブ運営法人・事業所、開発ベンダー等）",
        "display_order": 96,
        "sources": [
            {
                "title": "令和7年度こども家庭庁予算 事業別資料集",
                "url": "https://www.cfa.go.jp/assets/contents/node/basic_page/field_ref_resources/88749a20-e454-4a5b-9da8-3a32e1788a23/71b23f1a/20250326_policies_budget_67.pdf#page=19",
                "source_kind": "official_pdf",
                "authority_level": "primary",
            },
        ],
    },
    {
        "entity_id": "MIN_CFA",
        "fiscal_year": 2025,
        "fact_key": "after-school-club-ict-inner-frame-2025",
        "fact_group": "after_school_club",
        "title": "ICT化推進の予算枠",
        "value_text": "2,431億円の内数",
        "numeric_value": 2431,
        "unit": "億円",
        "summary": "放課後児童クラブ等におけるICT化推進事業は、子ども・子育て支援交付金 2,431億円の内数として示されており、放課後児童クラブ分だけの厳密額は切れていません。",
        "note_key": "after-school-club-support-2025",
        "source_excerpt": "＜子ども・子育て支援交付金＞ 令和７年度概算要求額 2,431億円の内数",
        "display_order": 97,
        "sources": [
            {
                "title": "令和7年度こども家庭庁予算 事業別資料集",
                "url": "https://www.cfa.go.jp/assets/contents/node/basic_page/field_ref_resources/88749a20-e454-4a5b-9da8-3a32e1788a23/71b23f1a/20250326_policies_budget_67.pdf#page=20",
                "source_kind": "official_pdf",
                "authority_level": "primary",
            },
        ],
    },
    {
        "entity_id": "MIN_CFA",
        "fiscal_year": 2025,
        "fact_key": "after-school-club-support-budget-2025",
        "fact_group": "after_school_club",
        "title": "巡回等サポート",
        "value_text": "11億円",
        "numeric_value": 11,
        "unit": "億円",
        "summary": "要支援児童等対応推進、育成支援体制強化、巡回アドバイザー配置など、現場の伴走支援を支える予算です。",
        "note_key": "after-school-club-support-2025",
        "source_excerpt": "要支援児童等対応推進、育成支援体制強化、巡回アドバイザー配置など周辺支援業務",
        "display_order": 100,
        "sources": [
            {
                "title": "令和7年度こども家庭庁予算 事業別資料集",
                "url": "https://www.cfa.go.jp/assets/contents/node/basic_page/field_ref_resources/88749a20-e454-4a5b-9da8-3a32e1788a23/71b23f1a/20250326_policies_budget_67.pdf#page=74&search=11",
                "source_kind": "official_pdf",
                "authority_level": "primary",
            },
            {
                "title": "令和7年度 こども・子育て支援関係予算のポイント",
                "url": "https://www.cfa.go.jp/assets/contents/node/basic_page/field_ref_resources/efa58163-4cc2-43d6-ba57-3df41d552a52/857bf219/20241227_policies_kosodateshien_budget_07.pdf#page=19",
                "source_kind": "official_pdf",
                "authority_level": "primary",
            },
        ],
    },
    {
        "entity_id": "MIN_CFA",
        "fiscal_year": 2025,
        "fact_key": "after-school-club-operators-2025",
        "fact_group": "after_school_club",
        "title": "制度の受け皿",
        "value_text": "市区町村、社会福祉法人、保護者会、運営委員会、その他の者",
        "summary": "こども家庭庁の概要ページでは、放課後児童クラブの設置・運営主体をこのように整理しています。",
        "note_key": "after-school-club-support-2025",
        "source_excerpt": "設置・運営主体 市区町村、社会福祉法人、保護者会、運営委員会、その他の者",
        "display_order": 110,
        "sources": [
            {
                "title": "放課後児童健全育成事業について",
                "url": "https://www.cfa.go.jp/policies/kosodateshien/houkago-jidou/overview",
                "source_kind": "official_html",
                "authority_level": "primary",
            },
        ],
    },
    {
        "entity_id": "MIN_CFA",
        "fiscal_year": 2025,
        "fact_key": "after-school-club-public-public-2025",
        "fact_group": "after_school_club_distribution",
        "title": "公立公営のクラブ数",
        "value_text": "5,800か所 / 22.4%",
        "numeric_value": 5800,
        "unit": "か所",
        "summary": "令和7年実施状況での公立公営クラブ数です。アプリでは運営費・処遇改善の出口按分比率として使っています。",
        "note_key": "after-school-club-support-2025",
        "source_excerpt": "公立公営 5,800（22.4%）",
        "display_order": 120,
        "sources": [
            {
                "title": "令和7年 放課後児童健全育成事業（放課後児童クラブ）の実施状況",
                "url": "https://www.cfa.go.jp/assets/contents/node/basic_page/field_ref_resources/69799c33-85cb-44f6-8c70-08ed3a292ab5/c253a682/20251222_policies_kosodateshien_houkago-jidou_80.pdf#page=9",
                "source_kind": "official_pdf",
                "authority_level": "primary",
            },
        ],
    },
    {
        "entity_id": "MIN_CFA",
        "fiscal_year": 2025,
        "fact_key": "after-school-club-public-private-2025",
        "fact_group": "after_school_club_distribution",
        "title": "公立民営のクラブ数",
        "value_text": "13,543か所 / 52.2%",
        "numeric_value": 13543,
        "unit": "か所",
        "summary": "令和7年実施状況での公立民営クラブ数です。アプリでは運営費・処遇改善の出口按分比率として使っています。",
        "note_key": "after-school-club-support-2025",
        "source_excerpt": "公立民営（合計） 13,543（52.2%）",
        "display_order": 130,
        "sources": [
            {
                "title": "令和7年 放課後児童健全育成事業（放課後児童クラブ）の実施状況",
                "url": "https://www.cfa.go.jp/assets/contents/node/basic_page/field_ref_resources/69799c33-85cb-44f6-8c70-08ed3a292ab5/c253a682/20251222_policies_kosodateshien_houkago-jidou_80.pdf#page=9",
                "source_kind": "official_pdf",
                "authority_level": "primary",
            },
        ],
    },
    {
        "entity_id": "MIN_CFA",
        "fiscal_year": 2025,
        "fact_key": "after-school-club-private-private-2025",
        "fact_group": "after_school_club_distribution",
        "title": "民立民営のクラブ数",
        "value_text": "6,585か所 / 25.4%",
        "numeric_value": 6585,
        "unit": "か所",
        "summary": "令和7年実施状況での民立民営クラブ数です。アプリでは運営費・処遇改善の出口按分比率として使っています。",
        "note_key": "after-school-club-support-2025",
        "source_excerpt": "民立民営（合計） 6,585（25.4%）",
        "display_order": 140,
        "sources": [
            {
                "title": "令和7年 放課後児童健全育成事業（放課後児童クラブ）の実施状況",
                "url": "https://www.cfa.go.jp/assets/contents/node/basic_page/field_ref_resources/69799c33-85cb-44f6-8c70-08ed3a292ab5/c253a682/20251222_policies_kosodateshien_houkago-jidou_80.pdf#page=9",
                "source_kind": "official_pdf",
                "authority_level": "primary",
            },
        ],
    },
    {
        "entity_id": "MIN_CFA",
        "fiscal_year": 2025,
        "fact_key": "after-school-club-fac-public-route-2025",
        "fact_group": "after_school_club_distribution",
        "title": "施設整備の公立ルート",
        "value_text": "市町村 / 国1/3・都道府県1/3・市町村1/3",
        "summary": "施設整備の公立ルートでは、設置主体は市町村で、基本の補助率は国1/3・都道府県1/3・市町村1/3です。待機児童市町村等では国2/3・都道府県1/6・市町村1/6へ嵩上げされます。",
        "note_key": "after-school-club-support-2025",
        "source_excerpt": "公立の場合 設置主体 市町村 補助率（嵩上げ前）国1/3・都道府県1/3・市町村1/3",
        "display_order": 145,
        "sources": [
            {
                "title": "令和7年度 こども・子育て支援関係予算のポイント",
                "url": "https://www.cfa.go.jp/assets/contents/node/basic_page/field_ref_resources/efa58163-4cc2-43d6-ba57-3df41d552a52/857bf219/20241227_policies_kosodateshien_budget_07.pdf#page=19",
                "source_kind": "official_pdf",
                "authority_level": "primary",
            },
        ],
    },
    {
        "entity_id": "MIN_CFA",
        "fiscal_year": 2025,
        "fact_key": "after-school-club-fac-public-eligibility-2025",
        "fact_group": "after_school_club_distribution",
        "title": "公立整備ルートの条件",
        "value_text": "設置主体が市町村であること",
        "summary": "施設整備で公立ルートに入るのは、市町村が設置主体である案件です。PFI整備後に市町村が買い取る方式も含まれます。",
        "note_key": "after-school-club-support-2025",
        "source_excerpt": "公立の場合 設置主体 市町村。PFI事業者が整備し市町村が買収する場合を含む。",
        "display_order": 147,
        "sources": [
            {
                "title": "子ども・子育て支援施設整備交付金の交付について",
                "url": "https://www.cfa.go.jp/assets/contents/node/basic_page/field_ref_resources/0abf2f27-1ebe-4fa2-bab8-362dd67ffc4b/f0bce416/20250425_policies_kosodateshien_houkago-jidou_hourei-tsuuti_65.pdf",
                "source_kind": "official_pdf",
                "authority_level": "primary",
            },
        ],
    },
    {
        "entity_id": "MIN_CFA",
        "fiscal_year": 2025,
        "fact_key": "after-school-club-fac-private-route-2025",
        "fact_group": "after_school_club_distribution",
        "title": "施設整備の民間ルート",
        "value_text": "社会福祉法人、学校法人、市町村が認めた者等 / 国2/9・都道府県2/9・市町村2/9・社会福祉法人等1/3",
        "summary": "施設整備の民間ルートでは、設置主体は社会福祉法人、学校法人、市町村が認めた者等で、基本の補助率は国2/9・都道府県2/9・市町村2/9・社会福祉法人等1/3です。待機児童市町村等では国1/2・都道府県1/8・市町村1/8・社会福祉法人等1/4へ嵩上げされます。",
        "note_key": "after-school-club-support-2025",
        "source_excerpt": "民立の場合 設置主体 社会福祉法人、学校法人、市町村が認めた者等 補助率（嵩上げ前）国2/9・都道府県2/9・市町村2/9・社会福祉法人等1/3",
        "display_order": 150,
        "sources": [
            {
                "title": "令和7年度 こども・子育て支援関係予算のポイント",
                "url": "https://www.cfa.go.jp/assets/contents/node/basic_page/field_ref_resources/efa58163-4cc2-43d6-ba57-3df41d552a52/857bf219/20241227_policies_kosodateshien_budget_07.pdf#page=19",
                "source_kind": "official_pdf",
                "authority_level": "primary",
            },
        ],
    },
    {
        "entity_id": "MIN_CFA",
        "fiscal_year": 2025,
        "fact_key": "after-school-club-fac-creation-eligible-costs-2025",
        "fact_group": "after_school_club_distribution",
        "title": "創設で使える主な費用",
        "value_text": "本体工事費、工事請負費、工事事務費、特殊附帯工事費、既存建物買収費、賃借料加算",
        "summary": "創設では、新設に必要な工事費や事務費、条件付きの既存建物買収費、土地賃借に伴う加算などが対象になります。",
        "note_key": "after-school-club-support-2025",
        "source_excerpt": "対象経費は本体工事費、工事請負費、工事事務費等。既存建物買収費は新築より効率的な場合に対象。賃借料加算あり。",
        "display_order": 152,
        "sources": [
            {
                "title": "子ども・子育て支援施設整備交付金の交付について",
                "url": "https://www.cfa.go.jp/assets/contents/node/basic_page/field_ref_resources/0abf2f27-1ebe-4fa2-bab8-362dd67ffc4b/f0bce416/20250425_policies_kosodateshien_houkago-jidou_hourei-tsuuti_65.pdf",
                "source_kind": "official_pdf",
                "authority_level": "primary",
            },
            {
                "title": "子ども・子育て支援施設整備交付金に係る施設整備の取扱い",
                "url": "https://www.cfa.go.jp/assets/contents/node/basic_page/field_ref_resources/0abf2f27-1ebe-4fa2-bab8-362dd67ffc4b/01d80820/20250425_policies_kosodateshien_houkago-jidou_hourei-tsuuti_66.pdf",
                "source_kind": "official_pdf",
                "authority_level": "primary",
            },
        ],
    },
    {
        "entity_id": "MIN_CFA",
        "fiscal_year": 2025,
        "fact_key": "after-school-club-fac-creation-ineligible-costs-2025",
        "fact_group": "after_school_club_distribution",
        "title": "創設で対象外になる費用",
        "value_text": "土地買収費、整地費、職員宿舎、外構等",
        "summary": "創設でも、土地買収や整地、職員宿舎、門・囲障・構内通路などの外構は対象外です。",
        "note_key": "after-school-club-support-2025",
        "source_excerpt": "土地買収費、整地費、職員宿舎、門、囲障、構内雨水排水、構内通路等は対象外。",
        "display_order": 153,
        "sources": [
            {
                "title": "子ども・子育て支援施設整備交付金の交付について",
                "url": "https://www.cfa.go.jp/assets/contents/node/basic_page/field_ref_resources/0abf2f27-1ebe-4fa2-bab8-362dd67ffc4b/f0bce416/20250425_policies_kosodateshien_houkago-jidou_hourei-tsuuti_65.pdf",
                "source_kind": "official_pdf",
                "authority_level": "primary",
            },
        ],
    },
    {
        "entity_id": "MIN_CFA",
        "fiscal_year": 2025,
        "fact_key": "after-school-club-fac-creation-requirements-2025",
        "fact_group": "after_school_club_distribution",
        "title": "創設の主な要件",
        "value_text": "専用区画1.65㎡/人以上、職員2人以上、うち1人以上支援員、1単位おおむね40人以下",
        "summary": "創設後のクラブは、専用区画面積、職員配置、支援の単位などの設備・運営基準を満たす必要があります。",
        "note_key": "after-school-club-support-2025",
        "source_excerpt": "専用区画は児童1人につきおおむね1.65㎡以上。支援の単位ごとに2人以上、うち1人以上は放課後児童支援員。1単位はおおむね40人以下。",
        "display_order": 154,
        "sources": [
            {
                "title": "放課後児童健全育成事業の設備及び運営に関する基準について",
                "url": "https://www.cfa.go.jp/assets/contents/node/basic_page/field_ref_resources/27f4a5b4-53c9-446d-ab3d-7c7055949a26/6ad7465b/20230929_policies_kokoseido_law_tsuuchi_tsuuchi-h24-h29_635.pdf",
                "source_kind": "official_pdf",
                "authority_level": "primary",
            },
            {
                "title": "放課後児童健全育成事業の「児童の数」の具体的な算出方法の例",
                "url": "https://www.cfa.go.jp/assets/contents/node/basic_page/field_ref_resources/0abf2f27-1ebe-4fa2-bab8-362dd67ffc4b/f4bc9772/20250513_policies_kosodateshien_houkago-jidou_hourei-tsuuti_67.pdf",
                "source_kind": "official_pdf",
                "authority_level": "primary",
            },
        ],
    },
    {
        "entity_id": "MIN_CFA",
        "fiscal_year": 2025,
        "fact_key": "after-school-club-fac-public-proxy-2025",
        "fact_group": "after_school_club_distribution",
        "title": "施設整備按分の公立側 proxy",
        "value_text": "19,343か所 / 74.6%",
        "numeric_value": 19343,
        "unit": "か所",
        "summary": "アプリでは施設整備 143億円の second hop を、公立公営と公立民営の合計クラブ数 19,343か所を proxy に按分しています。",
        "note_key": "after-school-club-support-2025",
        "source_excerpt": "公立公営 5,800 と 公立民営 13,543 の合計 19,343",
        "display_order": 155,
        "sources": [
            {
                "title": "令和7年 放課後児童健全育成事業（放課後児童クラブ）の実施状況",
                "url": "https://www.cfa.go.jp/assets/contents/node/basic_page/field_ref_resources/69799c33-85cb-44f6-8c70-08ed3a292ab5/c253a682/20251222_policies_kosodateshien_houkago-jidou_80.pdf#page=9",
                "source_kind": "official_pdf",
                "authority_level": "primary",
            },
        ],
    },
    {
        "entity_id": "MIN_CFA",
        "fiscal_year": 2025,
        "fact_key": "after-school-club-fac-private-proxy-2025",
        "fact_group": "after_school_club_distribution",
        "title": "施設整備按分の民間側 proxy",
        "value_text": "6,585か所 / 25.4%",
        "numeric_value": 6585,
        "unit": "か所",
        "summary": "アプリでは施設整備 143億円の second hop を、民立民営クラブ数 6,585か所を proxy に按分しています。",
        "note_key": "after-school-club-support-2025",
        "source_excerpt": "民立民営（合計） 6,585（25.4%）",
        "display_order": 160,
        "sources": [
            {
                "title": "令和7年 放課後児童健全育成事業（放課後児童クラブ）の実施状況",
                "url": "https://www.cfa.go.jp/assets/contents/node/basic_page/field_ref_resources/69799c33-85cb-44f6-8c70-08ed3a292ab5/c253a682/20251222_policies_kosodateshien_houkago-jidou_80.pdf#page=9",
                "source_kind": "official_pdf",
                "authority_level": "primary",
            },
        ],
    },
    {
        "entity_id": "MIN_CFA",
        "fiscal_year": 2025,
        "fact_key": "after-school-club-fac-public-examples-2025",
        "fact_group": "after_school_club_distribution",
        "title": "施設整備の公立具体例",
        "value_text": "船橋市 中野木第2放課後ルーム、松戸市 稔台放課後児童クラブ1/2、柏市立光ケ丘小こどもルーム第三/第四保育室 など",
        "summary": "千葉県の令和7年度協議施設一覧では、公立ルートの具体例として市町村直営の放課後ルーム、こどもルーム、学童保育所の整備案件が確認できます。",
        "note_key": "after-school-club-support-2025",
        "source_excerpt": "船橋市 中野木第2放課後ルーム、松戸市 稔台放課後児童クラブ1/2、柏市立光ケ丘小こどもルーム第三保育室/第四保育室、八千代台学童保育所A/B/C、西部小学校第1放課後児童クラブ",
        "display_order": 165,
        "sources": [
            {
                "title": "令和7年度子ども・子育て支援施設整備交付金協議施設一覧",
                "url": "https://www.pref.chiba.lg.jp/kosodate/hoikusho/houkago/documents/seibiitiran.pdf",
                "source_kind": "official_pdf",
                "authority_level": "primary",
            },
        ],
    },
    {
        "entity_id": "MIN_CFA",
        "fiscal_year": 2025,
        "fact_key": "after-school-club-fac-private-examples-2025",
        "fact_group": "after_school_club_distribution",
        "title": "施設整備の民間具体例",
        "value_text": "シダックス大新東ヒューマンサービス株式会社、保護者会レインボーキッズ、学校法人アゼリー学園、社会福祉法人佐原めぐみ会 など",
        "summary": "千葉県の令和7年度協議施設一覧では、民間ルートの具体例として株式会社系受託事業者、保護者会、学校法人、社会福祉法人が関わる整備案件が確認できます。",
        "note_key": "after-school-club-support-2025",
        "source_excerpt": "館山学童クラブA-D、上野小学校放課後ルーム、勝浦小学校放課後ルーム1/2、学童クラブ レインボーキッズ(1)(2)、学童クラブ アゼリーアカデミア千葉ニュータウン、学童クラブめぐみ(1)(2)",
        "display_order": 170,
        "sources": [
            {
                "title": "令和7年度子ども・子育て支援施設整備交付金協議施設一覧",
                "url": "https://www.pref.chiba.lg.jp/kosodate/hoikusho/houkago/documents/seibiitiran.pdf",
                "source_kind": "official_pdf",
                "authority_level": "primary",
            },
        ],
    },
    {
        "entity_id": "CITY_KOBE",
        "fiscal_year": 2025,
        "fact_key": "kobe-daredemo-budget-2025",
        "fact_group": "budget",
        "title": "令和7年度予算説明書の計上額",
        "value_text": "137,500千円",
        "numeric_value": 137500,
        "unit": "千円",
        "summary": "神戸市の令和7年度予算説明書では、保育振興費の内数として「こども誰でも通園制度 137,500千円」を計上しています。",
        "note_key": "kobe-daredemo-reviewed-2025",
        "source_excerpt": "保育振興費 (8) こども誰でも通園制度 137,500千円",
        "display_order": 210,
        "sources": [
            {
                "title": "神戸市 令和7年度予算説明書（こども家庭局）",
                "url": "https://www.city.kobe.lg.jp/documents/77626/r7kodomo.pdf#page=20&search=%E3%81%93%E3%81%A9%E3%82%82%E8%AA%B0%E3%81%A7%E3%82%82%E9%80%9A%E5%9C%92%E5%88%B6%E5%BA%A6",
                "source_kind": "official_pdf",
                "authority_level": "primary",
            },
        ],
    },
    {
        "entity_id": "CITY_KOBE",
        "fiscal_year": 2025,
        "fact_key": "kobe-daredemo-facilities-2025-07",
        "fact_group": "rollout",
        "title": "2025年7月1日時点の実施施設数",
        "value_text": "35施設",
        "numeric_value": 35,
        "unit": "施設",
        "summary": "継続21施設に新規14施設を加えた35施設で、2025年7月1日から利用可能と公表されています。",
        "note_key": "kobe-daredemo-reviewed-2025",
        "source_excerpt": "継続実施している21施設に今回選定した14施設が加わり、計35施設で利用できます。",
        "display_order": 220,
        "sources": [
            {
                "title": "令和７年度「神戸市こども誰でも通園制度」実施施設の拡充",
                "url": "https://www.city.kobe.lg.jp/a36812/610318071003.html",
                "source_kind": "official_html",
                "authority_level": "primary",
            },
        ],
    },
    {
        "entity_id": "CITY_KOBE",
        "fiscal_year": 2025,
        "fact_key": "kobe-daredemo-new-facilities-2025-07",
        "fact_group": "rollout",
        "title": "2025年度の新規選定施設数",
        "value_text": "14施設",
        "numeric_value": 14,
        "unit": "施設",
        "summary": "2025年度の公募では21施設の応募があり、そのうち14施設が新たに選定されています。",
        "note_key": "kobe-daredemo-reviewed-2025",
        "source_excerpt": "21施設から応募があったところ、新たに14施設を選定しました。",
        "display_order": 230,
        "sources": [
            {
                "title": "令和７年度「神戸市こども誰でも通園制度」実施施設の拡充",
                "url": "https://www.city.kobe.lg.jp/a36812/610318071003.html",
                "source_kind": "official_html",
                "authority_level": "primary",
            },
        ],
    },
    {
        "entity_id": "CITY_KOBE",
        "fiscal_year": 2025,
        "fact_key": "kobe-daredemo-user-fee-2025",
        "fact_group": "user_fee",
        "title": "利用者負担",
        "value_text": "300円/時間",
        "numeric_value": 300,
        "unit": "円/時間",
        "summary": "神戸市の制度ページでは、2025年度の基本利用料を300円/時間と案内しています。",
        "note_key": "kobe-daredemo-reviewed-2025",
        "source_excerpt": "子ども1人1時間あたり300円",
        "display_order": 240,
        "sources": [
            {
                "title": "神戸市こども誰でも通園制度",
                "url": "https://www.city.kobe.lg.jp/z/kodomokatekyoku/kosodateshien/daredemotuen.html",
                "source_kind": "official_html",
                "authority_level": "primary",
            },
        ],
    },
    {
        "entity_id": "CITY_KOBE",
        "fiscal_year": 2025,
        "fact_key": "kobe-daredemo-subsidy-unit-rates-2025",
        "fact_group": "subsidy_rule",
        "title": "施設向け基本単価",
        "value_text": "0歳1,300円 / 1歳1,100円 / 2歳900円",
        "summary": "実施事業者募集要項では、年齢別の時間単価に基づいて実施施設へ補助する設計が示されています。",
        "note_key": "kobe-daredemo-reviewed-2025",
        "source_excerpt": "0歳児 1,300円、1歳児 1,100円、2歳児 900円",
        "display_order": 250,
        "sources": [
            {
                "title": "令和７年度神戸市こども誰でも通園制度 実施事業者募集要項",
                "url": "https://www.city.kobe.lg.jp/documents/78828/boshuyoukou_1.pdf",
                "source_kind": "official_pdf",
                "authority_level": "primary",
            },
        ],
    },
    {
        "entity_id": "CITY_KOBE",
        "fiscal_year": 2025,
        "fact_key": "kobe-daredemo-add-ons-2025",
        "fact_group": "subsidy_rule",
        "title": "主な加算単価",
        "value_text": "障害児400円 / 要支援家庭400円 / 医療的ケア児2,400円",
        "summary": "神戸市の募集要項では、対象児童の状態に応じた時間単価の加算が示されています。",
        "note_key": "kobe-daredemo-reviewed-2025",
        "source_excerpt": "障害児加算 400円、要支援家庭加算 400円、医療的ケア児加算 2,400円",
        "display_order": 260,
        "sources": [
            {
                "title": "令和７年度神戸市こども誰でも通園制度 実施事業者募集要項",
                "url": "https://www.city.kobe.lg.jp/documents/78828/boshuyoukou_1.pdf",
                "source_kind": "official_pdf",
                "authority_level": "primary",
            },
        ],
    },
    {
        "entity_id": "CITY_KOBE",
        "fiscal_year": 2025,
        "fact_key": "kobe-daredemo-rent-cap-2025",
        "fact_group": "subsidy_rule",
        "title": "賃借料補助上限",
        "value_text": "229,000円/月",
        "numeric_value": 229000,
        "unit": "円/月",
        "summary": "神戸市の募集要項では、施設向け賃借料補助の上限額を月額 229,000円としています。",
        "note_key": "kobe-daredemo-reviewed-2025",
        "source_excerpt": "賃借料補助 1事業所1か月 229,000円上限",
        "display_order": 270,
        "sources": [
            {
                "title": "令和７年度神戸市こども誰でも通園制度 実施事業者募集要項",
                "url": "https://www.city.kobe.lg.jp/documents/78828/boshuyoukou_1.pdf",
                "source_kind": "official_pdf",
                "authority_level": "primary",
            },
        ],
    },
    {
        "entity_id": "CITY_KOBE",
        "fiscal_year": 2025,
        "fact_key": "kobe-daredemo-renovation-cap-2025",
        "fact_group": "subsidy_rule",
        "title": "改修費補助上限",
        "value_text": "3,000,000円/施設",
        "numeric_value": 3000000,
        "unit": "円/施設",
        "summary": "神戸市の募集要項では、改修費等補助の上限額を 1施設あたり 3,000,000円としています。",
        "note_key": "kobe-daredemo-reviewed-2025",
        "source_excerpt": "改修費等補助 1事業所 3,000,000円上限",
        "display_order": 280,
        "sources": [
            {
                "title": "令和７年度神戸市こども誰でも通園制度 実施事業者募集要項",
                "url": "https://www.city.kobe.lg.jp/documents/78828/boshuyoukou_1.pdf",
                "source_kind": "official_pdf",
                "authority_level": "primary",
            },
        ],
    },
    {
        "entity_id": "MIN_MHLW",
        "fiscal_year": 2025,
        "fact_key": "mhlw-fy2025-total-budget",
        "fact_group": "budget",
        "title": "令和7年度一般会計予算",
        "value_text": "34兆3,064億円",
        "numeric_value": 343064,
        "unit": "億円",
        "summary": "厚生労働省の令和7年度一般会計予算総額です。",
        "note_key": "mhlw-reviewed-budget-2025",
        "source_excerpt": "令和7年度厚生労働省一般会計予算 34兆3,064億円",
        "display_order": 110,
        "sources": [
            {
                "title": "厚生労働省 令和7年度予算案の概要",
                "url": "https://www.mhlw.go.jp/wp/yosan/yosan/25syokanyosan/dl/01-01.pdf#page=2&search=%E4%B8%80%E8%88%AC%E4%BC%9A%E8%A8%88",
                "source_kind": "official_pdf",
                "authority_level": "primary",
            },
        ],
    },
    {
        "entity_id": "MIN_MHLW",
        "fiscal_year": 2025,
        "fact_key": "mhlw-fy2025-social-security-frame",
        "fact_group": "policy_frame",
        "title": "社会保障関係費",
        "value_text": "33兆9,883億円",
        "numeric_value": 339883,
        "unit": "億円",
        "summary": "厚生労働省一般会計の中心を占める社会保障関係費の政策枠です。",
        "note_key": "mhlw-reviewed-budget-2025",
        "source_excerpt": "社会保障関係費 33兆9,883億円",
        "display_order": 120,
        "sources": [
            {
                "title": "厚生労働省 令和7年度予算案の概要",
                "url": "https://www.mhlw.go.jp/wp/yosan/yosan/25syokanyosan/dl/01-01.pdf#page=2&search=%E7%A4%BE%E4%BC%9A%E4%BF%9D%E9%9A%9C%E9%96%A2%E4%BF%82%E8%B2%BB",
                "source_kind": "official_pdf",
                "authority_level": "primary",
            },
        ],
    },
    {
        "entity_id": "MIN_MHLW",
        "fiscal_year": 2025,
        "fact_key": "mhlw-fy2025-largest-increase-driver",
        "fact_group": "increase_driver",
        "title": "最大の増要因",
        "value_text": "年金 +2,892億円",
        "numeric_value": 2892,
        "unit": "億円",
        "summary": "増要因の中では年金が最も大きく、対前年度比で +2,892億円です。",
        "note_key": "mhlw-reviewed-budget-2025",
        "source_excerpt": "年金 +2,892億円",
        "display_order": 130,
        "sources": [
            {
                "title": "厚生労働省 令和7年度予算案の概要",
                "url": "https://www.mhlw.go.jp/wp/yosan/yosan/25syokanyosan/dl/01-01.pdf#page=3&search=%E5%B9%B4%E9%87%91",
                "source_kind": "official_pdf",
                "authority_level": "primary",
            },
        ],
    },
    {
        "entity_id": "MIN_MEXT",
        "fiscal_year": 2025,
        "fact_key": "mext-fy2025-total-budget",
        "fact_group": "budget",
        "title": "令和7年度一般会計予算",
        "value_text": "55,094億円",
        "numeric_value": 55094,
        "unit": "億円",
        "summary": "文部科学省の令和7年度一般会計予算総額です。",
        "note_key": "mext-reviewed-budget-2025",
        "source_excerpt": "令和7年度 文部科学省一般会計予算 55,094億円",
        "display_order": 210,
        "sources": [
            {
                "title": "文部科学省 令和7年度予算のポイント",
                "url": "https://www.mext.go.jp/content/20250305-ope_dev03-000037774-1.pdf#page=2&search=%E4%B8%80%E8%88%AC%E4%BC%9A%E8%A8%88",
                "source_kind": "official_pdf",
                "authority_level": "primary",
            },
        ],
    },
    {
        "entity_id": "MIN_MEXT",
        "fiscal_year": 2025,
        "fact_key": "mext-fy2025-compulsory-education-frame",
        "fact_group": "policy_frame",
        "title": "義務教育費国庫負担金",
        "value_text": "1兆6,210億円",
        "numeric_value": 16210,
        "unit": "億円",
        "summary": "義務教育段階の基盤的経費を支える最大級の政策枠です。",
        "note_key": "mext-reviewed-budget-2025",
        "source_excerpt": "義務教育費国庫負担金 1兆6,210億円",
        "display_order": 220,
        "sources": [
            {
                "title": "文部科学省 令和7年度予算のポイント",
                "url": "https://www.mext.go.jp/content/20250305-ope_dev03-000037774-1.pdf#page=3&search=%E7%BE%A9%E5%8B%99%E6%95%99%E8%82%B2%E8%B2%BB",
                "source_kind": "official_pdf",
                "authority_level": "primary",
            },
        ],
    },
    {
        "entity_id": "MIN_MEXT",
        "fiscal_year": 2025,
        "fact_key": "mext-fy2025-kakenhi",
        "fact_group": "individual_project",
        "title": "科学研究費助成事業（科研費）",
        "value_text": "2,379億円",
        "numeric_value": 2379,
        "unit": "億円",
        "summary": "研究者の自由な発想に基づく学術研究を支える reviewed 主要事業です。",
        "note_key": "mext-reviewed-budget-2025",
        "source_excerpt": "科学研究費助成事業（科研費） 2,379億円",
        "display_order": 230,
        "sources": [
            {
                "title": "令和7年度予算のポイント",
                "url": "https://www.mext.go.jp/content/20250305-ope_dev03-000037774-1.pdf#page=68&search=%E7%A7%91%E5%AD%A6%E7%A0%94%E7%A9%B6%E8%B2%BB%E5%8A%A9%E6%88%90%E4%BA%8B%E6%A5%AD",
                "source_kind": "official_pdf",
                "authority_level": "primary",
            },
        ],
    },
    {
        "entity_id": "MIN_MLIT",
        "fiscal_year": 2024,
        "fact_key": "mlit-fy2024-total-budget",
        "fact_group": "budget",
        "title": "令和6年度関係予算総額",
        "value_text": "5兆9,537億円",
        "numeric_value": 59537,
        "unit": "億円",
        "summary": "国土交通省関係の令和6年度予算総額です。",
        "note_key": "mlit-reviewed-budget-2024",
        "source_excerpt": "令和6年度国土交通省関係予算 5兆9,537億円",
        "display_order": 310,
        "sources": [
            {
                "title": "国土交通省 令和6年度予算概要",
                "url": "https://www.mlit.go.jp/page/content/001720593.pdf#page=4&search=%E4%B8%80%E8%88%AC%E4%BC%9A%E8%A8%88",
                "source_kind": "official_pdf",
                "authority_level": "primary",
            },
        ],
    },
    {
        "entity_id": "MIN_MLIT",
        "fiscal_year": 2024,
        "fact_key": "mlit-fy2024-public-works-frame",
        "fact_group": "policy_frame",
        "title": "公共事業関係費",
        "value_text": "5兆2,901億円",
        "numeric_value": 52901,
        "unit": "億円",
        "summary": "国土交通省予算の大宗を占める公共事業の政策枠です。",
        "note_key": "mlit-reviewed-budget-2024",
        "source_excerpt": "公共事業関係費 5兆2,901億円",
        "display_order": 320,
        "sources": [
            {
                "title": "国土交通省 令和6年度予算概要",
                "url": "https://www.mlit.go.jp/page/content/001720593.pdf#page=4&search=%E5%85%AC%E5%85%B1%E4%BA%8B%E6%A5%AD%E9%96%A2%E4%BF%82%E8%B2%BB",
                "source_kind": "official_pdf",
                "authority_level": "primary",
            },
        ],
    },
    {
        "entity_id": "MIN_MLIT",
        "fiscal_year": 2024,
        "fact_key": "mlit-fy2024-flood-control",
        "fact_group": "individual_project",
        "title": "流域治水の加速化・強化",
        "value_text": "6,114億円",
        "numeric_value": 6114,
        "unit": "億円",
        "summary": "水害・土砂災害対策を強化する reviewed 重点施策です。",
        "note_key": "mlit-reviewed-budget-2024",
        "source_excerpt": "流域治水の加速化・強化 6,114億円",
        "display_order": 330,
        "sources": [
            {
                "title": "国土交通省 令和6年度予算概要",
                "url": "https://www.mlit.go.jp/page/content/001720593.pdf#page=6&search=%E6%B5%81%E5%9F%9F%E6%B2%BB%E6%B0%B4",
                "source_kind": "official_pdf",
                "authority_level": "primary",
            },
        ],
    },
    {
        "entity_id": "MIN_METI",
        "fiscal_year": 2025,
        "fact_key": "meti-fy2025-total-budget",
        "fact_group": "budget",
        "title": "関連予算総額",
        "value_text": "2兆524億円",
        "numeric_value": 20524,
        "unit": "億円",
        "summary": "一般会計、エネルギー対策特別会計、GX経済移行債などを含む経済産業省関連予算の総額です。",
        "note_key": "meti-reviewed-budget-2025",
        "source_excerpt": "経済産業省関連予算総額 2兆524億円",
        "display_order": 410,
        "sources": [
            {
                "title": "2025年度経済産業政策の重点",
                "url": "https://www.meti.go.jp/main/yosangaisan/fy2025/pr/enj/siryo/01.pdf#page=2&search=%E7%B7%8F%E9%A1%8D",
                "source_kind": "official_pdf",
                "authority_level": "primary",
            },
        ],
    },
    {
        "entity_id": "MIN_METI",
        "fiscal_year": 2025,
        "fact_key": "meti-fy2025-gx-frame",
        "fact_group": "policy_frame",
        "title": "GX・エネルギー安定供給の確保",
        "value_text": "1兆28億円",
        "numeric_value": 10028,
        "unit": "億円",
        "summary": "GX、エネルギー安定供給、資源循環を束ねる最大の政策枠です。",
        "note_key": "meti-reviewed-budget-2025",
        "source_excerpt": "GX・エネルギー安定供給の確保 1兆28億円",
        "display_order": 420,
        "sources": [
            {
                "title": "2025年度経済産業政策の重点",
                "url": "https://www.meti.go.jp/main/yosangaisan/fy2025/pr/enj/siryo/01.pdf#page=2&search=GX%E3%83%BB%E3%82%A8%E3%83%8D%E3%83%AB%E3%82%AE%E3%83%BC",
                "source_kind": "official_pdf",
                "authority_level": "primary",
            },
        ],
    },
    {
        "entity_id": "MIN_METI",
        "fiscal_year": 2025,
        "fact_key": "meti-fy2025-post5g",
        "fact_group": "individual_project",
        "title": "ポスト5G情報通信システム基盤強化研究開発事業",
        "value_text": "1,617億円",
        "numeric_value": 1617,
        "unit": "億円",
        "summary": "次世代情報通信システムの研究開発と産業基盤強化を支える reviewed 重点事業です。",
        "note_key": "meti-reviewed-budget-2025",
        "source_excerpt": "ポスト5G情報通信システム基盤強化研究開発事業 1,617億円",
        "display_order": 430,
        "sources": [
            {
                "title": "2025年度経済産業政策の重点",
                "url": "https://www.meti.go.jp/main/yosangaisan/fy2025/pr/enj/siryo/01.pdf#page=6&search=%E3%83%9D%E3%82%B9%E3%83%885G",
                "source_kind": "official_pdf",
                "authority_level": "primary",
            },
        ],
    },
]


def extract_name_en(name: str) -> str:
    """Extract English name from bilingual format like '年金給付費 (Pensions)'"""
    if '(' in name and name.endswith(')'):
        return name.split('(')[-1].rstrip(')')
    return ""


def read_project_text(doc_path: str) -> str:
    absolute_path = os.path.join(PROJECT_ROOT, doc_path)
    if not os.path.exists(absolute_path):
        return ""
    with open(absolute_path, "r", encoding="utf-8") as handle:
        return handle.read()


def infer_source_title(source_url: str, dataset_name: str) -> str:
    for pattern, title in SOURCE_TITLE_HINTS:
        if pattern in source_url:
            return title
    return dataset_name


def rewrite_source_url(source_url: str) -> str:
    if not source_url:
        return source_url
    return SOURCE_URL_REWRITES.get(source_url, source_url)


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
    normalized_url = rewrite_source_url(source_url)
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

    # meti_data mixes modeled subsidy/tax estimates and does not have a stable
    # one-size-fits-all detail URL. Do not surface the METI homepage as provenance.
    if dataset_name == "meti_data" and not explicit_url:
        return "", explicit_title or dataset_name

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


def should_skip_edge(edge: Dict[str, object]) -> bool:
    source_id = str(edge.get("source_id", "") or "")
    evidence_text = str(edge.get("evidence_text", "") or "")
    source_url = str(edge.get("source_url", "") or "")

    # CFA overview slides include policy-frame "inner amounts" that overlap
    # with more specific project sheets and should not be rendered as peers.
    if (
        source_id == "MIN_CFA"
        and "内数" in evidence_text
        and "20241227_policies_budget_53.pdf" in source_url
    ):
        return True

    return False


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
        source_url, source_title, page_number = infer_provenance_reference(
            str(item.get("source_url", "") or ""),
            str(item.get("source_title", "") or ""),
            str(item.get("title", "") or ""),
            int(item["fiscal_year"]),
            str(item["entity_id"]),
        )
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
                source_title or None,
                source_url or None,
                page_number if page_number is not None else item.get("page_number"),
                item.get("display_order", 0),
            ),
        )


def ensure_knowledge_notes_tables(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
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

        CREATE INDEX IF NOT EXISTS idx_knowledge_notes_entity_year
          ON knowledge_notes(entity_id, fiscal_year, display_order);

        CREATE INDEX IF NOT EXISTS idx_knowledge_note_sources_note
          ON knowledge_note_sources(note_id, display_order);
        """
    )


def seed_knowledge_notes(conn: sqlite3.Connection) -> None:
    ensure_knowledge_notes_tables(conn)

    for item in KNOWLEDGE_NOTES:
        body_markdown = read_project_text(str(item["doc_path"]))
        key_points_json = json.dumps(item.get("key_points", []), ensure_ascii=False)

        conn.execute(
            """
            INSERT INTO knowledge_notes (
              entity_id,
              fiscal_year,
              note_key,
              title,
              summary,
              key_points_json,
              body_markdown,
              doc_path,
              display_order
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(entity_id, fiscal_year, note_key) DO UPDATE SET
              title = excluded.title,
              summary = excluded.summary,
              key_points_json = excluded.key_points_json,
              body_markdown = excluded.body_markdown,
              doc_path = excluded.doc_path,
              display_order = excluded.display_order,
              updated_at = datetime('now')
            """,
            (
                item["entity_id"],
                item["fiscal_year"],
                item["note_key"],
                item["title"],
                item.get("summary"),
                key_points_json,
                body_markdown,
                item["doc_path"],
                item.get("display_order", 0),
            ),
        )

        note_id_row = conn.execute(
            """
            SELECT id
            FROM knowledge_notes
            WHERE entity_id = ? AND fiscal_year = ? AND note_key = ?
            """,
            (item["entity_id"], item["fiscal_year"], item["note_key"]),
        ).fetchone()
        if note_id_row is None:
            continue

        note_id = note_id_row[0]
        conn.execute("DELETE FROM knowledge_note_sources WHERE note_id = ?", (note_id,))

        for index, source in enumerate(item.get("sources", []), start=1):
            conn.execute(
                """
                INSERT INTO knowledge_note_sources (
                  note_id,
                  source_title,
                  source_url,
                  source_kind,
                  authority_level,
                  display_order
                )
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    note_id,
                    source["title"],
                    source["url"],
                    source.get("source_kind"),
                    source.get("authority_level"),
                    index * 10,
                ),
            )


def ensure_structured_facts_tables(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
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

        CREATE INDEX IF NOT EXISTS idx_structured_facts_entity_year
          ON structured_facts(entity_id, fiscal_year, display_order);

        CREATE INDEX IF NOT EXISTS idx_structured_fact_sources_fact
          ON structured_fact_sources(fact_id, display_order);
        """
    )


def seed_structured_facts(conn: sqlite3.Connection) -> None:
    ensure_structured_facts_tables(conn)

    for item in STRUCTURED_FACTS:
        conn.execute(
            """
            INSERT INTO structured_facts (
              entity_id,
              fiscal_year,
              fact_key,
              fact_group,
              title,
              value_text,
              numeric_value,
              unit,
              summary,
              note_key,
              source_excerpt,
              display_order
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(entity_id, fiscal_year, fact_key) DO UPDATE SET
              fact_group = excluded.fact_group,
              title = excluded.title,
              value_text = excluded.value_text,
              numeric_value = excluded.numeric_value,
              unit = excluded.unit,
              summary = excluded.summary,
              note_key = excluded.note_key,
              source_excerpt = excluded.source_excerpt,
              display_order = excluded.display_order,
              updated_at = datetime('now')
            """,
            (
                item["entity_id"],
                item["fiscal_year"],
                item["fact_key"],
                item.get("fact_group"),
                item["title"],
                item["value_text"],
                item.get("numeric_value"),
                item.get("unit"),
                item.get("summary"),
                item.get("note_key"),
                item.get("source_excerpt"),
                item.get("display_order", 0),
            ),
        )

        fact_id_row = conn.execute(
            """
            SELECT id
            FROM structured_facts
            WHERE entity_id = ? AND fiscal_year = ? AND fact_key = ?
            """,
            (item["entity_id"], item["fiscal_year"], item["fact_key"]),
        ).fetchone()
        if fact_id_row is None:
            continue

        fact_id = fact_id_row[0]
        conn.execute("DELETE FROM structured_fact_sources WHERE fact_id = ?", (fact_id,))

        for index, source in enumerate(item.get("sources", []), start=1):
            conn.execute(
                """
                INSERT INTO structured_fact_sources (
                  fact_id,
                  source_title,
                  source_url,
                  source_kind,
                  authority_level,
                  display_order
                )
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    fact_id,
                    source["title"],
                    source["url"],
                    source.get("source_kind"),
                    source.get("authority_level"),
                    index * 10,
                ),
            )


def ensure_implementation_sites_tables(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS implementation_sites (
          id                   INTEGER PRIMARY KEY AUTOINCREMENT,
          entity_id            TEXT NOT NULL REFERENCES nodes(id),
          fiscal_year          INTEGER NOT NULL,
          site_key             TEXT NOT NULL,
          program_key          TEXT,
          note_key             TEXT,
          site_name            TEXT NOT NULL,
          ward                 TEXT,
          site_category        TEXT,
          operator_name        TEXT,
          started_on           TEXT,
          status_note          TEXT,
          display_order        INTEGER DEFAULT 0,
          created_at           TEXT DEFAULT (datetime('now')),
          updated_at           TEXT DEFAULT (datetime('now')),
          UNIQUE(entity_id, fiscal_year, site_key)
        );

        CREATE TABLE IF NOT EXISTS implementation_site_sources (
          id                   INTEGER PRIMARY KEY AUTOINCREMENT,
          site_id              INTEGER NOT NULL REFERENCES implementation_sites(id) ON DELETE CASCADE,
          source_title         TEXT NOT NULL,
          source_url           TEXT NOT NULL,
          source_kind          TEXT,
          authority_level      TEXT,
          display_order        INTEGER DEFAULT 0,
          UNIQUE(site_id, source_url)
        );

        CREATE INDEX IF NOT EXISTS idx_implementation_sites_entity_year
          ON implementation_sites(entity_id, fiscal_year, display_order);

        CREATE INDEX IF NOT EXISTS idx_implementation_site_sources_site
          ON implementation_site_sources(site_id, display_order);
        """
    )


def seed_implementation_sites(conn: sqlite3.Connection) -> None:
    ensure_implementation_sites_tables(conn)

    for item in IMPLEMENTATION_SITES:
        conn.execute(
            """
            INSERT INTO implementation_sites (
              entity_id,
              fiscal_year,
              site_key,
              program_key,
              note_key,
              site_name,
              ward,
              site_category,
              operator_name,
              started_on,
              status_note,
              display_order
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(entity_id, fiscal_year, site_key) DO UPDATE SET
              program_key = excluded.program_key,
              note_key = excluded.note_key,
              site_name = excluded.site_name,
              ward = excluded.ward,
              site_category = excluded.site_category,
              operator_name = excluded.operator_name,
              started_on = excluded.started_on,
              status_note = excluded.status_note,
              display_order = excluded.display_order,
              updated_at = datetime('now')
            """,
            (
                item["entity_id"],
                item["fiscal_year"],
                item["site_key"],
                item.get("program_key"),
                item.get("note_key"),
                item["site_name"],
                item.get("ward"),
                item.get("site_category"),
                item.get("operator_name"),
                item.get("started_on"),
                item.get("status_note"),
                item.get("display_order", 0),
            ),
        )

        site_id_row = conn.execute(
            """
            SELECT id
            FROM implementation_sites
            WHERE entity_id = ? AND fiscal_year = ? AND site_key = ?
            """,
            (item["entity_id"], item["fiscal_year"], item["site_key"]),
        ).fetchone()
        if site_id_row is None:
            continue

        site_id = site_id_row[0]
        conn.execute("DELETE FROM implementation_site_sources WHERE site_id = ?", (site_id,))

        for index, source in enumerate(item.get("sources", []), start=1):
            conn.execute(
                """
                INSERT INTO implementation_site_sources (
                  site_id,
                  source_title,
                  source_url,
                  source_kind,
                  authority_level,
                  display_order
                )
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    site_id,
                    source["title"],
                    source["url"],
                    source.get("source_kind"),
                    source.get("authority_level"),
                    index * 10,
                ),
            )


def ensure_source_link_health_table(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
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

        CREATE INDEX IF NOT EXISTS idx_source_link_health_status
          ON source_link_health(validation_status, updated_at DESC);
        """
    )


def strip_url_fragment(source_url: str) -> str:
    if not source_url:
        return source_url
    parts = urlsplit(source_url)
    return urlunsplit((parts.scheme, parts.netloc, parts.path, parts.query, ""))


def is_http_url(source_url: str | None) -> bool:
    if not source_url:
        return False
    normalized = str(source_url).strip().lower()
    return normalized.startswith("http://") or normalized.startswith("https://")


def is_official_public_domain(source_url: str | None) -> bool:
    if not is_http_url(source_url):
        return False
    hostname = urlsplit(str(source_url).strip()).hostname or ""
    return hostname.endswith((".go.jp", ".lg.jp", ".ac.jp", ".or.jp"))


def is_official_document_url(source_url: str | None) -> bool:
    if not is_official_public_domain(source_url):
        return False
    path = (urlsplit(str(source_url).strip()).path or "").lower()
    return path.endswith((".pdf", ".csv", ".xlsx", ".xls", ".json"))


def is_timeout_error(error_message: str | None) -> bool:
    if not error_message:
        return False
    normalized = error_message.lower()
    return "timed out" in normalized or "timeout" in normalized


def should_refresh_source_validation(checked_at: str | None) -> bool:
    if not checked_at:
        return True
    try:
        checked_dt = datetime.fromisoformat(checked_at.replace("Z", "+00:00"))
    except ValueError:
        return True
    ttl_cutoff = datetime.now(timezone.utc) - timedelta(hours=SOURCE_VALIDATION_TTL_HOURS)
    if checked_dt.tzinfo is None:
        checked_dt = checked_dt.replace(tzinfo=timezone.utc)
    return checked_dt < ttl_cutoff


def classify_validation_status(source_url: str, http_status: int | None, error_message: str | None) -> str:
    if http_status is not None:
        if 200 <= http_status < 400:
            return "valid"
        if http_status in {401, 403, 405, 429, 500, 501, 502, 503, 504}:
            if is_official_document_url(source_url):
                return "valid"
            return "unknown"
        if 400 <= http_status < 600:
            return "invalid"
    if is_official_document_url(source_url) and is_timeout_error(error_message):
        return "valid"
    if error_message:
        return "unknown"
    return "unknown"


def fetch_url_status(request_url: str, method: str) -> tuple[int | None, str, str | None]:
    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; GlobalMoneyFlowBot/1.0; +https://example.invalid)",
        "Accept": "*/*",
    }
    if method == "GET":
        headers["Range"] = "bytes=0-0"

    request = Request(request_url, headers=headers, method=method)

    try:
        with urlopen(request, timeout=SOURCE_VALIDATION_TIMEOUT_SECONDS) as response:
            status = getattr(response, "status", None) or response.getcode()
            final_url = response.geturl()
            if method == "GET":
                response.read(1)
            return status, final_url, None
    except HTTPError as exc:
        return exc.code, exc.geturl() or request_url, str(exc)
    except URLError as exc:
        return None, request_url, str(exc.reason)
    except Exception as exc:  # pragma: no cover - defensive
        return None, request_url, str(exc)


def validate_source_url(source_url: str) -> dict[str, Any]:
    request_url = strip_url_fragment(source_url)
    if not request_url or not is_http_url(request_url):
        return {
            "request_url": request_url,
            "final_url": request_url,
            "http_status": None,
            "validation_status": "invalid" if source_url else "unknown",
            "error_message": "non-http url" if source_url else "empty url",
            "checked_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        }

    head_status, head_final_url, head_error = fetch_url_status(request_url, "HEAD")
    if head_status is not None and 200 <= head_status < 400:
        return {
            "request_url": request_url,
            "final_url": head_final_url,
            "http_status": head_status,
            "validation_status": "valid",
            "error_message": None,
            "checked_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        }

    should_retry_with_get = head_status is None or head_status in {401, 403, 405, 406, 429, 500, 501, 502, 503, 504}
    if should_retry_with_get:
        get_status, get_final_url, get_error = fetch_url_status(request_url, "GET")
        return {
            "request_url": request_url,
            "final_url": get_final_url,
            "http_status": get_status,
            "validation_status": classify_validation_status(request_url, get_status, get_error),
            "error_message": get_error,
            "checked_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        }

    return {
        "request_url": request_url,
        "final_url": head_final_url,
        "http_status": head_status,
        "validation_status": classify_validation_status(request_url, head_status, head_error),
        "error_message": head_error,
        "checked_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
    }


def collect_source_urls_for_validation(conn: sqlite3.Connection) -> list[str]:
    urls: set[str] = set()

    table_specs = [
        ("source_provenance", "source_url"),
        ("budget_highlights", "source_url"),
        ("knowledge_note_sources", "source_url"),
        ("structured_fact_sources", "source_url"),
        ("implementation_site_sources", "source_url"),
    ]

    for table_name, column_name in table_specs:
        try:
            rows = conn.execute(
                f"SELECT DISTINCT {column_name} FROM {table_name} WHERE {column_name} IS NOT NULL AND TRIM({column_name}) <> ''"
            ).fetchall()
        except sqlite3.OperationalError:
            continue
        urls.update(str(row[0]).strip() for row in rows if row[0] and is_http_url(str(row[0]).strip()))

    return sorted(urls)


def validate_source_links(conn: sqlite3.Connection) -> None:
    ensure_source_link_health_table(conn)

    if not VALIDATE_SOURCE_URLS:
        return

    raw_urls = collect_source_urls_for_validation(conn)
    if raw_urls:
        placeholders = ", ".join("?" for _ in raw_urls)
        conn.execute(
            f"DELETE FROM source_link_health WHERE source_url NOT IN ({placeholders})",
            tuple(raw_urls),
        )
    else:
        conn.execute("DELETE FROM source_link_health")
    request_cache: dict[str, dict[str, Any]] = {}

    for raw_url in raw_urls:
        existing = conn.execute(
            """
            SELECT validation_status, checked_at, request_url, final_url, http_status, error_message
            FROM source_link_health
            WHERE source_url = ?
            """,
            (raw_url,),
        ).fetchone()

        request_url = strip_url_fragment(raw_url)
        if existing and not should_refresh_source_validation(existing[1]):
            cached_result = {
                "request_url": existing[2],
                "final_url": existing[3],
                "http_status": existing[4],
                "validation_status": existing[0],
                "error_message": existing[5],
                "checked_at": existing[1],
            }
            if cached_result["validation_status"] == "unknown" and is_official_document_url(request_url) and is_timeout_error(existing[5]):
                cached_result["validation_status"] = "valid"
                conn.execute(
                    """
                    UPDATE source_link_health
                    SET validation_status = ?, updated_at = datetime('now')
                    WHERE source_url = ?
                    """,
                    (cached_result["validation_status"], raw_url),
                )
            request_cache.setdefault(request_url, cached_result)
            continue

        result = request_cache.get(request_url)
        if result is None:
            result = validate_source_url(raw_url)
            request_cache[request_url] = result

        conn.execute(
            """
            INSERT INTO source_link_health (
              source_url,
              request_url,
              final_url,
              validation_status,
              http_status,
              error_message,
              checked_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(source_url) DO UPDATE SET
              request_url = excluded.request_url,
              final_url = excluded.final_url,
              validation_status = excluded.validation_status,
              http_status = excluded.http_status,
              error_message = excluded.error_message,
              checked_at = excluded.checked_at,
              updated_at = datetime('now')
            """,
            (
                raw_url,
                result.get("request_url"),
                result.get("final_url"),
                result.get("validation_status"),
                result.get("http_status"),
                result.get("error_message"),
                result.get("checked_at"),
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
        if should_skip_edge(edge):
            continue

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


def ensure_manual_reviewed_nodes(conn: sqlite3.Connection, node_ids: set[str]) -> None:
    manual_node_lookup = {node["id"]: node for node in MANUAL_REVIEWED_NODES}
    for node_id in node_ids:
        node = manual_node_lookup.get(node_id)
        if not node:
            continue
        conn.execute(
            """
            INSERT OR IGNORE INTO nodes (id, name, name_en, lat, lng, region, type, dataset)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                node["id"],
                node["name"],
                extract_name_en(node["name"]) or None,
                node["lat"],
                node["lng"],
                node["region"],
                node["type"],
                node["dataset"],
            ),
        )


def get_distribution_ratio(model: dict[str, Any], destination: dict[str, Any]) -> float:
    ratio = destination.get("ratio")
    if ratio is not None:
        return float(ratio)

    share_units = destination.get("share_units")
    ratio_basis_total = model.get("ratio_basis_total")
    if share_units is None or not ratio_basis_total:
        raise ValueError(f"distribution model {model.get('key')} requires either ratio or share_units/ratio_basis_total")
    return float(share_units) / float(ratio_basis_total)


def render_distribution_extracted_text(template: str | None, context: dict[str, Any]) -> str | None:
    if not template:
        return None
    safe_context = {key: ("" if value is None else value) for key, value in context.items()}
    return template.format(**safe_context)


def resolve_parent_edge_reference(
    conn: sqlite3.Connection,
    parent_edge_spec: dict[str, Any],
    fiscal_year: int,
) -> tuple[int, float, str | None, str | None, int | None] | None:
    parent_edge = conn.execute(
        """
        SELECT e.id, e.value_usd
        FROM edges e
        WHERE e.source_id = ?
          AND e.target_id = ?
          AND e.fiscal_year = ?
        ORDER BY e.id
        LIMIT 1
        """,
        (
            parent_edge_spec["source_id"],
            parent_edge_spec["target_id"],
            fiscal_year,
        ),
    ).fetchone()

    if not parent_edge or parent_edge[1] is None:
        return None

    parent_edge_id = int(parent_edge[0])
    parent_value_usd = float(parent_edge[1])
    parent_provenance = conn.execute(
        """
        SELECT source_url, source_title, page_number
        FROM source_provenance
        WHERE edge_id = ?
        ORDER BY id
        LIMIT 1
        """,
        (parent_edge_id,),
    ).fetchone()

    parent_source_url = parent_provenance[0] if parent_provenance else None
    parent_source_title = (
        parent_provenance[1]
        if parent_provenance and parent_provenance[1]
        else parent_edge_spec.get("fallback_source_title")
    )
    parent_page_number = (
        parent_provenance[2]
        if parent_provenance and parent_provenance[2] is not None
        else parent_edge_spec.get("fallback_page_number")
    )
    return parent_edge_id, parent_value_usd, parent_source_url, parent_source_title, parent_page_number


def build_implementation_site_node_id(site_key: str) -> str:
    normalized = re.sub(r"[^A-Z0-9]+", "_", site_key.upper()).strip("_")
    return f"IMPL_SITE_{normalized}"


def resolve_implementation_site_coordinates(
    conn: sqlite3.Connection,
    entity_id: str,
    ward: str | None,
    ward_site_index: int,
) -> tuple[float, float]:
    ward_hints = IMPLEMENTATION_SITE_COORDINATE_HINTS.get(entity_id, {})
    base_lat, base_lng = ward_hints.get(ward or "", (0.0, 0.0))
    if base_lat == 0.0 and base_lng == 0.0:
        entity_row = conn.execute(
            "SELECT lat, lng FROM nodes WHERE id = ? LIMIT 1",
            (entity_id,),
        ).fetchone()
        if entity_row and entity_row[0] is not None and entity_row[1] is not None:
            base_lat, base_lng = float(entity_row[0]), float(entity_row[1])
        else:
            base_lat, base_lng = 35.0, 135.0

    row_offset = ward_site_index // 4
    column_offset = ward_site_index % 4
    lat = base_lat + (row_offset - 0.5) * 0.003
    lng = base_lng + (column_offset - 1.5) * 0.003
    return round(lat, 6), round(lng, 6)


def ensure_generated_nodes(conn: sqlite3.Connection, nodes: list[dict[str, Any]]) -> int:
    inserted_nodes = 0
    for node in nodes:
        cursor = conn.execute(
            """
            INSERT OR IGNORE INTO nodes (id, name, name_en, lat, lng, region, type, dataset)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                node["id"],
                node["name"],
                extract_name_en(node["name"]) or None,
                node["lat"],
                node["lng"],
                node["region"],
                node["type"],
                node["dataset"],
            ),
        )
        inserted_nodes += cursor.rowcount
    return inserted_nodes


def seed_distribution_model(conn: sqlite3.Connection, model: dict[str, Any]) -> int:
    source_id = str(model["source_id"])
    fiscal_year = int(model["fiscal_year"])
    parent_edge_spec = model["parent_edge"]
    parent_reference = resolve_parent_edge_reference(conn, parent_edge_spec, fiscal_year)
    if not parent_reference:
        return 0

    _, parent_value_usd, parent_source_url, parent_source_title, parent_page_number = parent_reference

    destinations = model.get("destinations", [])
    ensure_manual_reviewed_nodes(conn, {str(item["target_id"]) for item in destinations})

    conn.execute(
        """
        DELETE FROM source_provenance
        WHERE edge_id IN (
          SELECT id
          FROM edges
          WHERE source_id = ?
            AND fiscal_year = ?
        )
        """,
        (source_id, fiscal_year),
    )
    conn.execute(
        """
        DELETE FROM edges
        WHERE source_id = ?
          AND fiscal_year = ?
        """,
        (source_id, fiscal_year),
    )

    source_dataset = str(model["source_dataset"])
    provenance = model.get("provenance", {})
    provenance_source_url = provenance.get("source_url") or ""
    provenance_source_title = provenance.get("source_title") or source_dataset
    provenance_page_number = provenance.get("page_number")
    confidence = float(model.get("confidence", 0.8))
    ds_source_id = DATASET_TO_SOURCE_ID.get(source_dataset)

    inserted_edges = 0
    for destination in destinations:
        target_id = str(destination["target_id"])
        description = destination.get("description")
        ratio = get_distribution_ratio(model, destination)
        value_usd = float(parent_value_usd) * ratio
        cursor = conn.execute(
            """
            INSERT INTO edges (
              source_id,
              target_id,
              category,
              sub_category,
              value_usd,
              value_jpy,
              fiscal_year,
              confidence,
              source_dataset,
              description
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                source_id,
                target_id,
                model["category"],
                model["sub_category"],
                value_usd,
                value_usd * JPY_PER_USD,
                fiscal_year,
                confidence,
                source_dataset,
                description,
            ),
        )
        edge_id = cursor.lastrowid
        inserted_edges += 1

        extracted_text = render_distribution_extracted_text(
            provenance.get("extracted_text_template"),
            {
                "description": description or "",
                "parent_source_title": parent_source_title or "",
                "parent_source_url": parent_source_url or "",
                "parent_page_number": parent_page_number if parent_page_number is not None else "",
                "source_dataset": source_dataset,
                "source_title": provenance_source_title,
                "page_number": provenance_page_number if provenance_page_number is not None else "",
            },
        )

        conn.execute(
            """
            INSERT INTO source_provenance (
              edge_id,
              source_id,
              source_url,
              source_title,
              page_number,
              extracted_text,
              extraction_method,
              confidence
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                edge_id,
                ds_source_id,
                provenance_source_url,
                provenance_source_title,
                provenance_page_number,
                extracted_text,
                "script_generated",
                confidence,
            ),
        )

    return inserted_edges


def seed_distribution_models(conn: sqlite3.Connection) -> list[tuple[str, int]]:
    results: list[tuple[str, int]] = []
    for model in DISTRIBUTION_MODELS:
        inserted_edges = seed_distribution_model(conn, model)
        results.append((str(model.get("label") or model.get("key") or model["source_id"]), inserted_edges))
    return results


def seed_implementation_site_flow_model(conn: sqlite3.Connection, model: dict[str, Any]) -> tuple[int, int]:
    source_id = str(model["source_id"])
    entity_id = str(model["entity_id"])
    fiscal_year = int(model["fiscal_year"])
    parent_reference = resolve_parent_edge_reference(conn, model["parent_edge"], fiscal_year)
    if not parent_reference:
        return 0, 0

    _, parent_value_usd, parent_source_url, parent_source_title, parent_page_number = parent_reference
    site_items = [
        item
        for item in IMPLEMENTATION_SITES
        if str(item.get("entity_id")) == entity_id
        and int(item.get("fiscal_year", 0)) == fiscal_year
        and str(item.get("program_key") or "") == str(model.get("program_key") or "")
        and str(item.get("flow_parent_id") or "") == source_id
    ]
    if not site_items:
        return 0, 0

    conn.execute(
        """
        DELETE FROM source_provenance
        WHERE edge_id IN (
          SELECT id
          FROM edges
          WHERE source_id = ?
            AND fiscal_year = ?
        )
        """,
        (source_id, fiscal_year),
    )
    conn.execute(
        """
        DELETE FROM edges
        WHERE source_id = ?
          AND fiscal_year = ?
        """,
        (source_id, fiscal_year),
    )

    per_site_value_usd = parent_value_usd / float(len(site_items))
    confidence = float(model.get("confidence", 0.7))
    source_dataset = str(model["source_dataset"])
    provenance = model.get("provenance", {})
    provenance_source_url = str(provenance.get("source_url") or "")
    provenance_source_title = str(provenance.get("source_title") or source_dataset)
    provenance_page_number = provenance.get("page_number")
    ds_source_id = DATASET_TO_SOURCE_ID.get(source_dataset)
    description_template = str(model.get("description_template") or "")
    node_type = str(model.get("node_type") or "implementation_site")
    node_region = str(model.get("node_region") or "Japan")
    node_dataset = str(model.get("node_dataset") or "manual_reviewed")

    generated_nodes: list[dict[str, Any]] = []
    ward_indexes: dict[str, int] = {}
    inserted_edges = 0
    for site in site_items:
        ward = str(site.get("ward") or "区未設定")
        ward_site_index = ward_indexes.get(ward, 0)
        ward_indexes[ward] = ward_site_index + 1
        node_id = build_implementation_site_node_id(str(site["site_key"]))
        lat, lng = resolve_implementation_site_coordinates(conn, entity_id, site.get("ward"), ward_site_index)
        generated_nodes.append(
            {
                "id": node_id,
                "name": str(site["site_name"]),
                "lat": lat,
                "lng": lng,
                "region": node_region,
                "type": node_type,
                "dataset": node_dataset,
            }
        )

    inserted_nodes = ensure_generated_nodes(conn, generated_nodes)

    for site in site_items:
        target_id = build_implementation_site_node_id(str(site["site_key"]))
        description = description_template.format(
            site_name=site["site_name"],
            ward=site.get("ward") or "区未設定",
            site_category=site.get("site_category") or "施設",
            site_count=len(site_items),
            parent_source_title=parent_source_title or "",
            parent_page_number=parent_page_number if parent_page_number is not None else "",
        )
        cursor = conn.execute(
            """
            INSERT INTO edges (
              source_id,
              target_id,
              category,
              sub_category,
              value_usd,
              value_jpy,
              fiscal_year,
              confidence,
              source_dataset,
              description
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                source_id,
                target_id,
                model["category"],
                model["sub_category"],
                per_site_value_usd,
                per_site_value_usd * JPY_PER_USD,
                fiscal_year,
                confidence,
                source_dataset,
                description,
            ),
        )
        edge_id = cursor.lastrowid
        inserted_edges += 1

        extracted_text = render_distribution_extracted_text(
            provenance.get("extracted_text_template"),
            {
                "description": description,
                "site_name": site["site_name"],
                "ward": site.get("ward") or "区未設定",
                "site_category": site.get("site_category") or "施設",
                "site_count": len(site_items),
                "parent_source_title": parent_source_title or "",
                "parent_source_url": parent_source_url or "",
                "parent_page_number": parent_page_number if parent_page_number is not None else "",
                "source_dataset": source_dataset,
                "source_title": provenance_source_title,
                "page_number": provenance_page_number if provenance_page_number is not None else "",
            },
        )

        conn.execute(
            """
            INSERT INTO source_provenance (
              edge_id,
              source_id,
              source_url,
              source_title,
              page_number,
              extracted_text,
              extraction_method,
              confidence
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                edge_id,
                ds_source_id,
                provenance_source_url,
                provenance_source_title,
                provenance_page_number,
                extracted_text,
                "script_generated",
                confidence,
            ),
        )

    return inserted_nodes, inserted_edges


def seed_implementation_site_flow_models(conn: sqlite3.Connection) -> list[tuple[str, int, int]]:
    results: list[tuple[str, int, int]] = []
    for model in IMPLEMENTATION_SITE_FLOW_MODELS:
        inserted_nodes, inserted_edges = seed_implementation_site_flow_model(conn, model)
        results.append((str(model.get("label") or model.get("key") or model["source_id"]), inserted_nodes, inserted_edges))
    return results


def seed_manual_reviewed_local_gov_entries(conn: sqlite3.Connection) -> tuple[int, int]:
    inserted_nodes = 0
    inserted_edges = 0

    for node in MANUAL_REVIEWED_NODES:
        cursor = conn.execute(
            """
            INSERT OR IGNORE INTO nodes (id, name, name_en, lat, lng, region, type, dataset)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                node["id"],
                node["name"],
                extract_name_en(node["name"]) or None,
                node["lat"],
                node["lng"],
                node["region"],
                node["type"],
                node["dataset"],
            ),
        )
        if cursor.rowcount:
            inserted_nodes += 1

    value_usd = KOBE_DAREDEMO_BUDGET_JPY / JPY_PER_USD
    cursor = conn.execute(
        """
        INSERT INTO edges (
          source_id,
          target_id,
          category,
          sub_category,
          value_usd,
          value_jpy,
          fiscal_year,
          confidence,
          source_dataset,
          description
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            "CITY_KOBE",
            "REC_KOBE_DAREDEMO_SITES",
            "welfare",
            "乳児等通園支援事業",
            value_usd,
            KOBE_DAREDEMO_BUDGET_JPY,
            2025,
            0.98,
            KOBE_DAREDEMO_BUDGET_DATASET,
            "神戸市の令和7年度予算説明書では、保育振興費の内数として「こども誰でも通園制度 137,500千円」を計上。実施事業者募集要項では、施設補助と賃借料・改修費補助の枠組みが示されている。",
        ),
    )
    edge_id = cursor.lastrowid
    inserted_edges += 1

    conn.execute(
        """
        INSERT INTO source_provenance (
          edge_id,
          source_id,
          source_url,
          source_title,
          page_number,
          extracted_text,
          extraction_method,
          confidence
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            edge_id,
            None,
            "https://www.city.kobe.lg.jp/documents/77626/r7kodomo.pdf#page=20&search=%E3%81%93%E3%81%A9%E3%82%82%E8%AA%B0%E3%81%A7%E3%82%82%E9%80%9A%E5%9C%92%E5%88%B6%E5%BA%A6",
            "神戸市 令和7年度予算説明書（こども家庭局）",
            20,
            "保育振興費 (8) こども誰でも通園制度 137,500千円",
            "script_generated",
            0.98,
        ),
    )

    return inserted_nodes, inserted_edges


def export_frontend_json(conn: sqlite3.Connection) -> Tuple[str, int, int]:
    """Export the unified DB back to a single JSON for the frontend"""
    export_path = os.path.join(DATA_DIR, "unified_data.json")
    seed_budget_highlights(conn)
    seed_knowledge_notes(conn)
    seed_structured_facts(conn)
    seed_implementation_sites(conn)
    validate_source_links(conn)

    source_health_by_url: dict[str, str] = {
        row[0]: row[1]
        for row in conn.execute(
            """
            SELECT source_url, validation_status
            FROM source_link_health
            """
        )
    }

    def is_displayable_source(source_url: str | None) -> bool:
        if not source_url:
            return True
        if not is_http_url(source_url):
            return False
        return source_health_by_url.get(source_url, "unknown") != "invalid"
    
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
        if row[10] and is_displayable_source(row[10]): # source_url
            edge_data["source_url"] = row[10]
        if row[11] and is_displayable_source(row[10]): # source_title
            edge_data["source_title"] = row[11]
        if row[12] is not None and is_displayable_source(row[10]): # page_number
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
        if row[8] and not is_displayable_source(row[8]):
            continue
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

    knowledge_sources_by_note: dict[int, list[dict[str, Any]]] = {}
    for row in conn.execute(
        """
        SELECT note_id, source_title, source_url, source_kind, authority_level, display_order
        FROM knowledge_note_sources
        ORDER BY note_id, display_order, id
        """
    ):
        if not is_displayable_source(row[2]):
            continue
        knowledge_sources_by_note.setdefault(row[0], []).append(
            {
                "source_title": row[1],
                "source_url": row[2],
                "source_kind": row[3],
                "authority_level": row[4],
                "display_order": row[5],
            }
        )

    knowledge_notes: list[dict[str, Any]] = []
    for row in conn.execute(
        """
        SELECT id, entity_id, fiscal_year, note_key, title, summary,
               key_points_json, body_markdown, doc_path, display_order
        FROM knowledge_notes
        ORDER BY fiscal_year DESC, entity_id, display_order, id
        """
    ):
        try:
            key_points = json.loads(row[6]) if row[6] else []
        except json.JSONDecodeError:
            key_points = []

        note_sources = knowledge_sources_by_note.get(row[0], [])
        if not note_sources:
            continue

        knowledge_notes.append(
            {
                "entity_id": row[1],
                "fiscal_year": row[2],
                "note_key": row[3],
                "title": row[4],
                "summary": row[5],
                "key_points": key_points,
                "body_markdown": row[7],
                "doc_path": row[8],
                "display_order": row[9],
                "sources": note_sources,
            }
        )

    fact_sources_by_fact: dict[int, list[dict[str, Any]]] = {}
    for row in conn.execute(
        """
        SELECT fact_id, source_title, source_url, source_kind, authority_level, display_order
        FROM structured_fact_sources
        ORDER BY fact_id, display_order, id
        """
    ):
        if not is_displayable_source(row[2]):
            continue
        fact_sources_by_fact.setdefault(row[0], []).append(
            {
                "source_title": row[1],
                "source_url": row[2],
                "source_kind": row[3],
                "authority_level": row[4],
                "display_order": row[5],
            }
        )

    structured_facts: list[dict[str, Any]] = []
    for row in conn.execute(
        """
        SELECT id, entity_id, fiscal_year, fact_key, fact_group, title, value_text,
               numeric_value, unit, summary, note_key, source_excerpt, display_order
        FROM structured_facts
        ORDER BY fiscal_year DESC, entity_id, display_order, id
        """
    ):
        fact_sources = fact_sources_by_fact.get(row[0], [])
        if not fact_sources:
            continue
        structured_facts.append(
            {
                "entity_id": row[1],
                "fiscal_year": row[2],
                "fact_key": row[3],
                "fact_group": row[4],
                "title": row[5],
                "value_text": row[6],
                "numeric_value": row[7],
                "unit": row[8],
                "summary": row[9],
                "note_key": row[10],
                "source_excerpt": row[11],
                "display_order": row[12],
                "sources": fact_sources,
            }
        )

    implementation_site_sources_by_site: dict[int, list[dict[str, Any]]] = {}
    for row in conn.execute(
        """
        SELECT site_id, source_title, source_url, source_kind, authority_level, display_order
        FROM implementation_site_sources
        ORDER BY site_id, display_order, id
        """
    ):
        if not is_displayable_source(row[2]):
            continue
        implementation_site_sources_by_site.setdefault(row[0], []).append(
            {
                "source_title": row[1],
                "source_url": row[2],
                "source_kind": row[3],
                "authority_level": row[4],
                "display_order": row[5],
            }
        )

    implementation_sites: list[dict[str, Any]] = []
    for row in conn.execute(
        """
        SELECT id, entity_id, fiscal_year, site_key, program_key, note_key, site_name,
               ward, site_category, operator_name, started_on, status_note, display_order
        FROM implementation_sites
        ORDER BY fiscal_year DESC, entity_id, display_order, id
        """
    ):
        site_sources = implementation_site_sources_by_site.get(row[0], [])
        if not site_sources:
            continue
        implementation_sites.append(
            {
                "entity_id": row[1],
                "fiscal_year": row[2],
                "site_key": row[3],
                "program_key": row[4],
                "note_key": row[5],
                "site_name": row[6],
                "ward": row[7],
                "site_category": row[8],
                "operator_name": row[9],
                "started_on": row[10],
                "status_note": row[11],
                "display_order": row[12],
                "sources": site_sources,
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
            "knowledgeNotes": knowledge_notes,
            "structuredFacts": structured_facts,
            "implementationSites": implementation_sites,
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
    knowledge_count = conn.execute("SELECT COUNT(*) FROM knowledge_notes").fetchone()[0]
    structured_fact_count = conn.execute("SELECT COUNT(*) FROM structured_facts").fetchone()[0]
    implementation_site_count = conn.execute("SELECT COUNT(*) FROM implementation_sites").fetchone()[0]
    print(f"  Knowledge Notes:   {knowledge_count} records")
    print(f"  Structured Facts: {structured_fact_count} records")
    print(f"  Implementation Sites: {implementation_site_count} records")
    try:
        health_counts = conn.execute(
            "SELECT validation_status, COUNT(*) FROM source_link_health GROUP BY validation_status ORDER BY validation_status"
        ).fetchall()
    except sqlite3.OperationalError:
        health_counts = []
    if health_counts:
        joined = ", ".join(f"{status or 'unknown'}={count}" for status, count in health_counts)
        print(f"  Source Link Health: {joined}")


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
    ensure_knowledge_notes_tables(conn)
    ensure_structured_facts_tables(conn)
    ensure_implementation_sites_tables(conn)
    ensure_source_link_health_table(conn)
    conn.execute("DELETE FROM budget_highlights")
    conn.execute("DELETE FROM knowledge_note_sources")
    conn.execute("DELETE FROM knowledge_notes")
    conn.execute("DELETE FROM structured_fact_sources")
    conn.execute("DELETE FROM structured_facts")
    conn.execute("DELETE FROM implementation_site_sources")
    conn.execute("DELETE FROM implementation_sites")
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

    for label, inserted_edges in seed_distribution_models(conn):
        conn.commit()
        if inserted_edges:
            print(f"  ✅ {label:45s} → {inserted_edges:>4d} edges")
            total_edges += inserted_edges

    manual_nodes, manual_edges = seed_manual_reviewed_local_gov_entries(conn)
    conn.commit()
    if manual_nodes or manual_edges:
        print(f"  ✅ {'Manual reviewed local-gov entries':45s} → {manual_nodes:>3d} nodes, {manual_edges:>4d} edges")
        total_nodes += manual_nodes
        total_edges += manual_edges

    for label, inserted_nodes, inserted_edges in seed_implementation_site_flow_models(conn):
        conn.commit()
        if inserted_nodes or inserted_edges:
            print(f"  ✅ {label:45s} → {inserted_nodes:>3d} nodes, {inserted_edges:>4d} edges")
            total_nodes += inserted_nodes
            total_edges += inserted_edges

    print(f"\n  Total imported: {total_nodes} nodes, {total_edges} edges")

    normalize_source_provenance(conn)
    conn.commit()
    
    # Export unified JSON for frontend
    print("\n📤 Exporting unified JSON for frontend...")
    path, n, e = export_frontend_json(conn)
    conn.commit()
    print(f"  ✅ {path}")
    print(f"     {n} nodes, {e} edges")
    
    # Print summary
    print_summary(conn)
    
    conn.close()


if __name__ == '__main__':
    main()
