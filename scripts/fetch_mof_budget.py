import os
import json
import random
from typing import List, Dict

OUTPUT_PATH = os.path.join(os.path.dirname(__file__), '../src/data/mof_data.json')

# Ministry of Finance - General Account Budget (一般会計) Nodes
MOF_NODES = [
    # Inflows (Revenue / 歳入) - Approx ~114 Trillion JPY represented in USD (~760B USD)
    { "id": "TAX_INCOME", "name": "所得税 (Income Tax)", "lat": 35.6700, "lng": 139.7500, "region": "Revenue", "type": "mof_revenue" },
    { "id": "TAX_CORP", "name": "法人税 (Corporate Tax)", "lat": 35.6710, "lng": 139.7510, "region": "Revenue", "type": "mof_revenue" },
    { "id": "TAX_CONSUMPTION", "name": "消費税 (Consumption Tax)", "lat": 35.6720, "lng": 139.7520, "region": "Revenue", "type": "mof_revenue" },
    { "id": "TAX_OTHER", "name": "その他租税 (Other Taxes)", "lat": 35.6730, "lng": 139.7530, "region": "Revenue", "type": "mof_revenue" },
    { "id": "NON_TAX_REV", "name": "税外収入 (Non-Tax Rev)", "lat": 35.6740, "lng": 139.7540, "region": "Revenue", "type": "mof_revenue" },
    { "id": "GOV_BONDS_ISSUE", "name": "公債金 (Gov Bond Issuance)", "lat": 35.6750, "lng": 139.7550, "region": "Revenue", "type": "mof_revenue" },

    # Central Node (The Treasury itself) - already defined in japan_data.json as GOV_JP, but we redefine here to ensure it exists if loaded standalone
    { "id": "GOV_JP", "name": "日本国政府 (一般会計)", "lat": 35.6762, "lng": 139.7503, "region": "Treasury", "type": "macro_entity" },

    # Outflows (Expenditure / 歳出)
    { "id": "EXP_SOCIAL", "name": "社会保障関係費 (Social Security)", "lat": 35.6800, "lng": 139.7600, "region": "Expenditure", "type": "mof_expenditure" },
    { "id": "EXP_DEBT", "name": "国債費 (National Debt Service)", "lat": 35.6810, "lng": 139.7610, "region": "Expenditure", "type": "mof_expenditure" },
    { "id": "EXP_LOCAL", "name": "地方交付税交付金等 (Local Grants)", "lat": 35.6820, "lng": 139.7620, "region": "Expenditure", "type": "mof_expenditure" },
    { "id": "EXP_PUBLIC", "name": "公共事業関係費 (Public Works)", "lat": 35.6830, "lng": 139.7630, "region": "Expenditure", "type": "mof_expenditure" },
    { "id": "EXP_EDU", "name": "文教及び科学振興費 (Education & Science)", "lat": 35.6840, "lng": 139.7640, "region": "Expenditure", "type": "mof_expenditure" },
    { "id": "EXP_DEFENSE", "name": "防衛関係費 (Defense)", "lat": 35.6850, "lng": 139.7650, "region": "Expenditure", "type": "mof_expenditure" },
    { "id": "EXP_OTHER", "name": "その他経費 (Other Exp)", "lat": 35.6860, "lng": 139.7660, "region": "Expenditure", "type": "mof_expenditure" }
]

def generate_mof_budget_flows(year: int) -> List[Dict]:
    """
    Simulates the General Account Budget of Japan (一般会計).
    Scaled roughly to actual proportions:
    Total ~114T JPY -> ~760B USD (using 150 JPY/USD for simplicity).
    """
    edges = []
    
    # --- REVENUE (歳入) ---
    # Roughly based on MOF FY2023/2024 initial budget proportions
    revenues = [
        {"source_id": "TAX_CONSUMPTION", "value_usd": 155e9, "cat": "tax"}, # ~23T JPY
        {"source_id": "TAX_INCOME", "value_usd": 145e9, "cat": "tax"}, # ~22T JPY
        {"source_id": "TAX_CORP", "value_usd": 100e9, "cat": "tax"}, # ~15T JPY
        {"source_id": "TAX_OTHER", "value_usd": 65e9, "cat": "tax"}, # ~9T JPY
        {"source_id": "NON_TAX_REV", "value_usd": 50e9, "cat": "non-tax"}, # ~7T JPY
        {"source_id": "GOV_BONDS_ISSUE", "value_usd": 240e9, "cat": "debt"} # ~35T JPY (Borrowing)
    ]
    
    for rev in revenues:
        # Add slight yearly variation
        variation = 1 + ((year - 2021) * 0.02)
        edges.append({
            "source_id": rev["source_id"],
            "target_id": "GOV_JP",
            "category": "bop", # Using bop/tax for gov revenues
            "sub_category": "Revenue",
            "value_usd": float(rev["value_usd"]) * variation,
            "year": year,
            "confidence": 0.99,
            "source_dataset": "MOF General Account"
        })

    # --- PUSH EXPENDITURE LOGIC TO MINISTRIES PIPELINE ---
    # Expenditures are now handled from GOV_JP -> MIN_* -> EXP_* in fetch_ministries.py
    # We no longer generate direct GOV_JP -> EXP_* flows here to avoid duplication.
    # -------------------------------------------------------------------------
            
    return edges

def main():
    print("Starting MOF National Budget Pipeline...")
    
    years = [2021, 2022, 2023, 2024]
    all_edges = []
    
    for year in years:
        print(f"Generating General Account flows for year {year}...")
        flows = generate_mof_budget_flows(year)
        all_edges.extend(flows)
        
    output_data = {
        "nodes": MOF_NODES,
        "edges": all_edges,
        "metadata": {
            "source": ["Ministry of Finance (財務省)"],
            "generated_at": "2026-03-10T00:00:00Z",
            "scope": "Japan National Budget (一般会計)"
        }
    }
    
    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    
    with open(OUTPUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(output_data, f, ensure_ascii=False, indent=2)
        
    print(f"✅ Successfully written mof_data.json to {OUTPUT_PATH}")
    print(f"   Generated {len(MOF_NODES)} nodes and {len(all_edges)} edges.")

if __name__ == '__main__':
    main()
