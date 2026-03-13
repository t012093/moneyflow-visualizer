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

# Keep the reviewed FY2025 program amount intact and only model the second hop.
# This lets the 2D view show MIN_CFA -> こども誰でも通園制度 -> 配布先.
CFA_DAREDEMO_DISTRIBUTION_DESTINATIONS = [
    (
        "DEST_PRIV_NURSERY",
        0.60,
        "民間保育施設等への利用料補助。2025年度の reviewed 事業額を起点に、制度移行モデルの配布先比率で分解しています。",
    ),
    (
        "DEST_MUNI_NURSERY",
        0.15,
        "公立保育施設への利用料補助。制度資料の『実施主体は市町村』を前提に、国費部分の配布先として可視化しています。",
    ),
    (
        "DEST_ACCENTURE",
        0.10,
        "総合支援システムの運用保守開発。2025年度の reviewed 事業額に対し、既存の制度移行モデル比率を適用しています。",
    ),
    (
        "ICT_CODMON",
        0.03,
        "保育ICT 導入枠。2025年度の reviewed 事業額に対し、制度移行モデルの配布先比率を適用しています。",
    ),
    (
        "ICT_LOOKMEE",
        0.015,
        "保育ICT 導入枠。2025年度の reviewed 事業額に対し、制度移行モデルの配布先比率を適用しています。",
    ),
    (
        "ICT_OTHERS",
        0.005,
        "その他保育ICT。2025年度の reviewed 事業額に対し、制度移行モデルの配布先比率を適用しています。",
    ),
    (
        "DEST_FACILITY_UPGRADE",
        0.10,
        "施設整備費の国庫補助。2025年度の reviewed 事業額に対し、制度移行モデルの配布先比率を適用しています。",
    ),
]

KOBE_DAREDEMO_BUDGET_DATASET = "神戸市 令和7年度予算説明書"
KOBE_DAREDEMO_BUDGET_JPY = 137_500_000

MANUAL_REVIEWED_NODES = [
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


def seed_cfa_daredemo_distribution_edges(conn: sqlite3.Connection) -> int:
    parent_edge = conn.execute(
        """
        SELECT e.id, e.value_usd
        FROM edges e
        WHERE e.source_id = 'MIN_CFA'
          AND e.target_id = 'REC_CHILDCARE_ALL'
          AND e.fiscal_year = 2025
        ORDER BY e.id
        LIMIT 1
        """
    ).fetchone()

    if not parent_edge:
        return 0

    parent_edge_id, parent_value_usd = parent_edge

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

    if not parent_provenance:
        return 0

    _, source_title, page_number = parent_provenance
    source_title = source_title or "令和7年度こども家庭庁予算 事業別資料集"
    page_number = page_number if page_number is not None else 95

    inserted_edges = 0
    ds_source_id = DATASET_TO_SOURCE_ID.get(CFA_DAREDEMO_MODELED_DATASET)

    for target_id, ratio, description in CFA_DAREDEMO_DISTRIBUTION_DESTINATIONS:
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
                "REC_CHILDCARE_ALL",
                target_id,
                "services",
                "委託・助成金",
                value_usd,
                value_usd * JPY_PER_USD,
                2025,
                0.85,
                CFA_DAREDEMO_MODELED_DATASET,
                description,
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
                ds_source_id,
                CFA_DAREDEMO_MODELED_DATASET,
                CFA_DAREDEMO_MODELED_DATASET,
                None,
                f"{description} Reviewed amount reference: {source_title} p.{page_number}",
                "script_generated",
                0.85,
            ),
        )

    return inserted_edges


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
    print(f"  Knowledge Notes:   {knowledge_count} records")
    print(f"  Structured Facts: {structured_fact_count} records")
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
    ensure_source_link_health_table(conn)
    conn.execute("DELETE FROM budget_highlights")
    conn.execute("DELETE FROM knowledge_note_sources")
    conn.execute("DELETE FROM knowledge_notes")
    conn.execute("DELETE FROM structured_fact_sources")
    conn.execute("DELETE FROM structured_facts")
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

    bridged_edges = seed_cfa_daredemo_distribution_edges(conn)
    conn.commit()
    if bridged_edges:
        print(f"  ✅ {'CFA こども誰でも通園制度 bridge':45s} → {bridged_edges:>4d} edges")
        total_edges += bridged_edges

    manual_nodes, manual_edges = seed_manual_reviewed_local_gov_entries(conn)
    conn.commit()
    if manual_nodes or manual_edges:
        print(f"  ✅ {'Manual reviewed local-gov entries':45s} → {manual_nodes:>3d} nodes, {manual_edges:>4d} edges")
        total_nodes += manual_nodes
        total_edges += manual_edges

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
