import os
import json
import random
from typing import List, Dict

# Output path for the distinct Japan dataset
OUTPUT_PATH = os.path.join(os.path.dirname(__file__), '../src/data/japan_data.json')

# 1. Define Japan-specific Node schemas (`prefecture`, `local_gov`, `corporation_jp`, `macro_entity`)
JAPAN_NODES = [
    # Macro Entities (BOJ Flow of Funds context)
    { "id": "GOV_JP", "name": "日本国政府 (国庫)", "lat": 35.6762, "lng": 139.7503, "region": "Japan", "type": "macro_entity" },
    { "id": "BOJ", "name": "日本銀行", "lat": 35.6865, "lng": 139.7713, "region": "Japan", "type": "macro_entity" },
    { "id": "HH_JP", "name": "日本の家計 (約2000兆円)", "lat": 35.6895, "lng": 139.6917, "region": "Japan", "type": "macro_entity" },
    { "id": "COMM_BANKS", "name": "国内銀行", "lat": 35.6812, "lng": 139.7671, "region": "Japan", "type": "macro_entity" },

    # Prefectures / Local Govs (RESAS context)
    { "id": "PREF_13", "name": "東京都", "lat": 35.6894, "lng": 139.6917, "region": "Kanto", "type": "prefecture" },
    { "id": "PREF_27", "name": "大阪府", "lat": 34.6937, "lng": 135.5023, "region": "Kansai", "type": "prefecture" },
    { "id": "PREF_23", "name": "愛知県", "lat": 35.1815, "lng": 136.9066, "region": "Chubu", "type": "prefecture" },
    { "id": "PREF_40", "name": "福岡県", "lat": 33.5902, "lng": 130.4017, "region": "Kyushu", "type": "prefecture" },
    { "id": "PREF_01", "name": "北海道", "lat": 43.0618, "lng": 141.3545, "region": "Hokkaido", "type": "prefecture" },

    # Corporations (EDINET context)
    { "id": "CORP_7203", "name": "トヨタ自動車", "lat": 35.0828, "lng": 137.1562, "region": "Chubu", "type": "corporation_jp" },
    { "id": "CORP_6758", "name": "ソニーグループ", "lat": 35.6266, "lng": 139.7408, "region": "Kanto", "type": "corporation_jp" },
    { "id": "CORP_9984", "name": "ソフトバンクグループ", "lat": 35.6605, "lng": 139.7621, "region": "Kanto", "type": "corporation_jp" }
]

def fetch_boj_flow_of_funds(year: int) -> List[Dict]:
    """
    Simulate fetching BOJ Flow of Funds data (資金循環統計).
    Represents the massive macro flows of Japanese household wealth.
    """
    edges = []
    # Base wealth in USD for scale (Assume 1 USD = 150 JPY roughly, Household assets ~ 14 Trillion USD)
    base_savings_usd = 14e12 
    
    # Household -> Bank Deposits (Flow of new savings)
    edges.append({
        "source_id": "HH_JP",
        "target_id": "COMM_BANKS",
        "category": "banking",
        "sub_category": "Deposits",
        "value_usd": 250e9 * (1 + (year-2021)*0.02),
        "year": year,
        "confidence": 0.95,
        "source_dataset": "BOJ Flow of Funds (Proxy)"
    })
    
    # Banks -> Government Bonds (JGBs)
    edges.append({
        "source_id": "COMM_BANKS",
        "target_id": "GOV_JP",
        "category": "bop", # Using bop for sovereign debt flows
        "sub_category": "JGB Purchases",
        "value_usd": 300e9 * (1 + (year-2021)*0.05),
        "year": year,
        "confidence": 0.98,
        "source_dataset": "BOJ Flow of Funds (Proxy)"
    })
    
    # BOJ -> Government (Quantitative Easing / JGB holdings)
    edges.append({
        "source_id": "BOJ",
        "target_id": "GOV_JP",
        "category": "bop",
        "sub_category": "QE JGB Purchases",
        "value_usd": 400e9,
        "year": year,
        "confidence": 0.99,
        "source_dataset": "BOJ Statistics"
    })
    
    return edges

def fetch_resas_meso_flows(year: int) -> List[Dict]:
    """
    Simulate fetching RESAS API (地域経済分析システム) / e-Stat.
    Focuses on Local Allocation Tax (地方交付税交付金) and Inter-prefectural trade.
    """
    edges = []
    
    # National Gov -> Prefectures (Local Allocation Tax & Subsidies)
    regional_prefs = ["PREF_01", "PREF_40"] # Hokkaido, Fukuoka
    for pref in regional_prefs:
        edges.append({
            "source_id": "GOV_JP",
            "target_id": pref,
            "category": "remittance", # Using remittance for subsidies
            "sub_category": "Local Allocation Tax",
            "value_usd": random.uniform(5e9, 15e9),
            "year": year,
            "confidence": 0.90,
            "source_dataset": "MIC Local Finance (Proxy)"
        })
        
    # Inter-prefectural corporate trade (Supply chains)
    edges.append({
        "source_id": "PREF_23", # Aichi (Manufacturing hub)
        "target_id": "PREF_13", # Tokyo (Consumption/Headquarters)
        "category": "trade",
        "sub_category": "Domestic Supply Chain",
        "value_usd": 120e9,
        "year": year,
        "confidence": 0.85,
        "source_dataset": "RESAS Inter-Regional Trade (Proxy)"
    })
    
    edges.append({
        "source_id": "PREF_27", # Osaka
        "target_id": "PREF_13", # Tokyo
        "category": "trade",
        "sub_category": "Domestic Trade",
        "value_usd": 80e9,
        "year": year,
        "confidence": 0.85,
        "source_dataset": "RESAS Inter-Regional Trade (Proxy)"
    })

    return edges

def fetch_edinet_corporate_cashflow(year: int) -> List[Dict]:
    """
    Simulate parsing EDINET XBRL Cash Flow Statements.
    Highlights Operating Revenue -> Taxes -> Dividends -> Capex.
    """
    edges = []
    
    # Toyota Cash Flow Simulation (~250B USD Revenue)
    # Revenue originating from Household & Global (Represented by Tokyo/Aichi proxies)
    edges.append({
        "source_id": "HH_JP",
        "target_id": "CORP_7203",
        "category": "trade",
        "sub_category": "Domestic Auto Sales",
        "value_usd": 15e9 * (1 + (year-2021)*0.03),
        "year": year,
        "confidence": 0.99,
        "source_dataset": "EDINET XBRL (Toyota)"
    })
    
    # Taxes paid to Gov
    edges.append({
        "source_id": "CORP_7203",
        "target_id": "GOV_JP",
        "category": "bop",
        "sub_category": "Corporate Tax",
        "value_usd": 8e9,
        "year": year,
        "confidence": 0.99,
        "source_dataset": "EDINET XBRL (Toyota)"
    })
    
    # Capex / R&D flowing back to Aichi (Suppliers)
    edges.append({
        "source_id": "CORP_7203",
        "target_id": "PREF_23",
        "category": "trade",
        "sub_category": "Capex & Procurement",
        "value_usd": 25e9,
        "year": year,
        "confidence": 0.90,
        "source_dataset": "EDINET / IR Reports"
    })
    
    # Sony Group Simulation
    edges.append({
        "source_id": "HH_JP",
        "target_id": "CORP_6758",
        "category": "trade",
        "sub_category": "Electronics & Entertainment",
        "value_usd": 10e9,
        "year": year,
        "confidence": 0.99,
        "source_dataset": "EDINET XBRL (Sony)"
    })
    edges.append({
        "source_id": "CORP_6758",
        "target_id": "PREF_13",
        "category": "trade",
        "sub_category": "Payroll & Domestic Capex",
        "value_usd": 8e9,
        "year": year,
        "confidence": 0.90,
        "source_dataset": "EDINET XBRL (Sony)"
    })

    return edges

def main():
    print("Starting Japan Domestic Data Pipeline PoC...")
    
    years = [2021, 2022, 2023, 2024]
    all_edges = []
    
    for year in years:
        print(f"Fetching / Simulating Japan flows for year {year}...")
        
        # 1. BOJ Flow of Funds
        boj_edges = fetch_boj_flow_of_funds(year)
        all_edges.extend(boj_edges)
        
        # 2. RESAS Meso Flows
        resas_edges = fetch_resas_meso_flows(year)
        all_edges.extend(resas_edges)
        
        # 3. EDINET Micro Flows
        edinet_edges = fetch_edinet_corporate_cashflow(year)
        all_edges.extend(edinet_edges)
        
    # Serialize to JSON
    output_data = {
        "nodes": JAPAN_NODES,
        "edges": all_edges,
        "metadata": {
            "source": ["BOJ Flow of Funds", "RESAS Inter-Regional", "EDINET XBRL Analytics"],
            "generated_at": "2026-03-10T00:00:00Z",
            "scope": "Japan Domestic Deep Dive"
        }
    }
    
    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    
    with open(OUTPUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(output_data, f, ensure_ascii=False, indent=2)
        
    print(f"✅ Successfully written japan_data.json to {OUTPUT_PATH}")
    print(f"   Generated {len(JAPAN_NODES)} nodes and {len(all_edges)} edges.")

if __name__ == '__main__':
    main()
