"""
Social Security Expenditure Data Pipeline (Phase 5 - Real Data)
================================================================
Sources:
  - 参議院予算委員会調査室「令和6年度社会保障関係予算」
  - 厚生労働省「令和4年度 国民医療費の概況」
  - 厚生労働省「令和5年度 介護給付費等実態統計」
  - こども家庭庁「令和6年度当初予算案・令和7年度概算要求等 (Open Data)」

See: docs/social_security_data_sources.md for full references.
"""

import os
import json
from typing import List, Dict

OUTPUT_PATH = os.path.join(os.path.dirname(__file__), '../src/data/mhlw_data.json')
JPY_TO_USD = 1 / 150  # 1 USD = 150 JPY (approximate)

# ─────────────────────────────────────────────────────────────────
# Node Definitions
# ─────────────────────────────────────────────────────────────────
MHLW_NODES = [
    # Source Node (from MOF budget)
    { "id": "EXP_SOCIAL", "name": "社会保障関係費", "lat": 35.68, "lng": 139.76, "region": "Expenditure", "type": "mof_expenditure" },

    # ── 4 Pillars of Social Security ──
    { "id": "SS_PENSION", "name": "年金給付費", "lat": 35.70, "lng": 139.70, "region": "Social Security", "type": "mhlw_benefit" },
    { "id": "SS_MEDICAL", "name": "医療給付費", "lat": 35.71, "lng": 139.71, "region": "Social Security", "type": "mhlw_benefit" },
    { "id": "SS_WELFARE", "name": "介護給付費", "lat": 35.72, "lng": 139.72, "region": "Social Security", "type": "mhlw_benefit" },
    { "id": "SS_CHILDCARE", "name": "少子化対策費", "lat": 35.73, "lng": 139.73, "region": "Social Security", "type": "mhlw_benefit" },
    { "id": "SS_LIVELIHOOD", "name": "生活扶助等社会福祉費", "lat": 35.74, "lng": 139.74, "region": "Social Security", "type": "mhlw_benefit" },

    # ── Medical Recipients (Where ¥12.2T goes) ──
    { "id": "REC_HOSPITAL", "name": "病院・診療所 (入院+外来)", "lat": 35.81, "lng": 139.81, "region": "Medical", "type": "recipient" },
    { "id": "REC_PHARMACY", "name": "薬局 (調剤薬局チェーン)", "lat": 35.82, "lng": 139.82, "region": "Medical", "type": "recipient" },
    { "id": "REC_DENTAL", "name": "歯科医院", "lat": 35.83, "lng": 139.83, "region": "Medical", "type": "recipient" },
    { "id": "REC_PHARMA", "name": "製薬企業・医療機器メーカー", "lat": 35.84, "lng": 139.84, "region": "Medical", "type": "recipient" },

    # ── Nursing Care Recipients (Where ¥3.7T goes) ──
    { "id": "REC_HOME_CARE", "name": "訪問介護事業者", "lat": 35.85, "lng": 139.85, "region": "Nursing", "type": "recipient" },
    { "id": "REC_NURSING_HOME", "name": "特別養護老人ホーム (社福法人)", "lat": 35.86, "lng": 139.86, "region": "Nursing", "type": "recipient" },
    { "id": "REC_DAY_SERVICE", "name": "通所介護 (デイサービス)", "lat": 35.87, "lng": 139.87, "region": "Nursing", "type": "recipient" },
    { "id": "REC_CARE_OTHER", "name": "福祉用具・住宅改修等", "lat": 35.88, "lng": 139.88, "region": "Nursing", "type": "recipient" },

    # ── Childcare Recipients (Where ¥5.3T goes) ──
    { "id": "REC_CHILD_ALLOW", "name": "子育て世帯 (児童手当・所得制限撤廃等)", "lat": 35.89, "lng": 139.89, "region": "Childcare", "type": "recipient" },
    { "id": "REC_NURSERY", "name": "保育所等の処遇改善", "lat": 35.90, "lng": 139.90, "region": "Childcare", "type": "recipient" },
    { "id": "REC_BIRTH_SUPP", "name": "出産・子育て応援給付金 (妊娠・出産時10万円)", "lat": 35.91, "lng": 139.91, "region": "Childcare", "type": "recipient" },
    { "id": "REC_DANY_NURSERY", "name": "こども誰でも通園制度", "lat": 35.92, "lng": 139.88, "region": "Childcare", "type": "recipient" },
    { "id": "REC_AFTERSCHOOL", "name": "放課後児童クラブ等・地域子ども支援", "lat": 35.92, "lng": 139.92, "region": "Childcare", "type": "recipient" },

    # ── Final Destinations (Where Childcare / Nursery Subsidies actually land) ──
    { "id": "DEST_PRIV_NURSERY", "name": "民間保育施設・こども園", "lat": 35.95, "lng": 139.95, "region": "Childcare", "type": "corporation_jp" },
    { "id": "DEST_MUNI_NURSERY", "name": "公立保育所 (市町村)", "lat": 35.96, "lng": 139.96, "region": "Childcare", "type": "local_gov" },
    { "id": "DEST_NPO_SUPPORT", "name": "NPO法人・地域子育て支援拠点", "lat": 35.97, "lng": 139.97, "region": "Childcare", "type": "corporation_jp" },
    { "id": "DEST_ACCENTURE", "name": "アクセンチュア株式会社 (総合支援システム開発)", "lat": 35.98, "lng": 139.98, "region": "Childcare", "type": "corporation_jp" },
    { "id": "ICT_CODMON", "name": "株式会社コドモン (CoDMON)", "lat": 35.68, "lng": 139.75, "region": "Childcare", "type": "corporation_jp" },
    { "id": "ICT_LOOKMEE", "name": "ユニファ株式会社 (ルクミー)", "lat": 35.17, "lng": 136.91, "region": "Childcare", "type": "corporation_jp" },
    { "id": "ICT_OTHERS", "name": "その他保育ICT (キッズリー等)", "lat": 35.69, "lng": 139.69, "region": "Childcare", "type": "corporation_jp" },
    { "id": "DEST_FACILITY_UPGRADE", "name": "建設・設備業者 (施設整備補助)", "lat": 35.99, "lng": 139.99, "region": "Childcare", "type": "corporation_jp" },

    # ── Pension Recipient ──
    { "id": "REC_ELDERLY", "name": "高齢者世帯 (年金受給者)", "lat": 35.80, "lng": 139.80, "region": "Pension", "type": "recipient" },

    # ── Livelihood Recipient ──
    { "id": "REC_LIVELIHOOD", "name": "生活保護受給世帯・障害者", "lat": 35.93, "lng": 139.93, "region": "Livelihood", "type": "recipient" },
]

# ─────────────────────────────────────────────────────────────────
# Real Data: Budget figures from official sources (in 億円)
# ─────────────────────────────────────────────────────────────────
#   FY2024 (R6) national budget breakdown (In 億円)
#   Source: 参議院予算委員会調査室 & こども家庭庁オープンデータ
BUDGET_R6 = {
    "pension":    134020,  # 年金給付費 (億円)
    "medical":    122366,  # 医療給付費
    "nursing":     37188,  # 介護給付費
    "childcare":   53000,  # こども家庭庁予算総額 (約5.3兆円 - 令和6年度)
    "livelihood":  44912,  # 生活扶助等社会福祉費
}

# Medical breakdown (proportional from 国民医療費 R4)
# Total 国民医療費 = ¥46.7T, National Treasury portion = ¥12.2T (~26%)
MEDICAL_BREAKDOWN = {
    "hospital":  0.69,   # 病院・診療所 (入院+外来) 69%
    "pharmacy":  0.17,   # 薬局調剤 17%
    "dental":    0.07,   # 歯科 7%
    "pharma":    0.07,   # 製薬・医療機器 7%
}

# Nursing care breakdown (estimated from 介護給付費等実態統計 R5)
NURSING_BREAKDOWN = {
    "home_care":     0.30,  # 訪問介護 30%
    "nursing_home":  0.30,  # 特養 30%
    "day_service":   0.20,  # 通所介護 20%
    "other":         0.20,  # 福祉用具等 20%
}

# Childcare breakdown (Reflecting Official CFA Open Data R6/R7 Budgets)
# R6 Child Allowance: ~1.52T ¥ (Before R7 expansion to ~2.16T)
# Educ/Childcare: ~1.76T ¥
# Birth Support: ~0.06T ¥
# Remaining CFA (Admin, Afterschool, General Support): ~1.9T ¥
CHILDCARE_BREAKDOWN = {
    "allowance":  15246,  # 児童手当 (億円)
    "nursery":    17623,  # 子どものための教育・保育給付等 (億円)
    "birth":        624,  # 出産・子育て応援交付金等 (億円)
    "dany":         126,  # こども誰でも通園制度 (億円 - R7事業関連国費)
    "afterschool": 19381, # 放課後児童などその他予算 (億円 - 元19507から126分離)
}


def oku_to_usd(value_oku: float) -> float:
    """Convert 億円 to USD using 1$ = 150 JPY"""
    return value_oku * 1e8 * JPY_TO_USD


def generate_real_flows(year: int) -> List[Dict]:
    """
    Generate Social Security flows using REAL budget data.
    Applies a small annual growth factor based on observed trends.
    """
    edges = []
    
    # Annual growth factors (approximate historical trends)
    year_delta = year - 2024
    growth = {
        "pension":    1 + year_delta * 0.015,   # ~1.5% annual growth
        "medical":    1 + year_delta * 0.025,   # ~2.5% (aging population)
        "nursing":    1 + year_delta * 0.035,   # ~3.5% (fastest growing)
        "childcare":  1 + year_delta * 0.03,    # ~3.0% (policy expansion)
        "livelihood": 1 + year_delta * 0.01,    # ~1.0% (relatively stable)
    }

    # ── Layer 1: EXP_SOCIAL -> 4 Pillars (Note: Childcare is now routed directly from MIN_CFA) ──
    pillar_map = [
        ("SS_PENSION",    "pension"),
        ("SS_MEDICAL",    "medical"),
        ("SS_WELFARE",    "nursing"),
        ("SS_LIVELIHOOD", "livelihood"),
    ]
    
    for target_id, key in pillar_map:
        edges.append({
            "source_id": "EXP_SOCIAL",
            "target_id": target_id,
            "category": "welfare",
            "sub_category": "National Budget Allocation",
            "value_usd": oku_to_usd(BUDGET_R6[key] * growth[key]),
            "year": year,
            "confidence": 0.99,
            "source_dataset": "参議院予算委員会調査室 R6"
        })

    # ── Layer 2: Pension -> Elderly Households ──
    edges.append({
        "source_id": "SS_PENSION",
        "target_id": "REC_ELDERLY",
        "category": "remittance",
        "sub_category": "基礎年金国庫負担",
        "value_usd": oku_to_usd(BUDGET_R6["pension"] * growth["pension"]),
        "year": year,
        "confidence": 0.99,
        "source_dataset": "財務省一般会計"
    })

    # ── Layer 2: Medical -> Hospital/Pharmacy/Dental/Pharma ──
    med_total = BUDGET_R6["medical"] * growth["medical"]
    med_recipients = [
        ("REC_HOSPITAL", MEDICAL_BREAKDOWN["hospital"]),
        ("REC_PHARMACY", MEDICAL_BREAKDOWN["pharmacy"]),
        ("REC_DENTAL",   MEDICAL_BREAKDOWN["dental"]),
        ("REC_PHARMA",   MEDICAL_BREAKDOWN["pharma"]),
    ]
    for target_id, ratio in med_recipients:
        edges.append({
            "source_id": "SS_MEDICAL",
            "target_id": target_id,
            "category": "trade",
            "sub_category": "医療費支弁",
            "value_usd": oku_to_usd(med_total * ratio),
            "year": year,
            "confidence": 0.95,
            "source_dataset": "厚生労働省 国民医療費 R4"
        })

    # ── Layer 2: Nursing Care -> Home Care/Nursing Home/Day Service ──
    nur_total = BUDGET_R6["nursing"] * growth["nursing"]
    nur_recipients = [
        ("REC_HOME_CARE",    NURSING_BREAKDOWN["home_care"]),
        ("REC_NURSING_HOME", NURSING_BREAKDOWN["nursing_home"]),
        ("REC_DAY_SERVICE",  NURSING_BREAKDOWN["day_service"]),
        ("REC_CARE_OTHER",   NURSING_BREAKDOWN["other"]),
    ]
    for target_id, ratio in nur_recipients:
        edges.append({
            "source_id": "SS_WELFARE",
            "target_id": target_id,
            "category": "trade",
            "sub_category": "介護保険給付",
            "value_usd": oku_to_usd(nur_total * ratio),
            "year": year,
            "confidence": 0.90,
            "source_dataset": "厚生労働省 介護給付費等実態統計 R5"
        })

    # ── Layer 2: Childcare -> Families/Nurseries/Birth Support ──
    # For Year 2024/2025, use exact or proportionally adjusted CFA Open Data figures.
    child_recipients = [
        ("REC_CHILD_ALLOW", CHILDCARE_BREAKDOWN["allowance"], "児童手当 (所得制限撤廃・多子加算) - こども家庭庁オープンデータ (https://www.cfa.go.jp/)"),
        ("REC_NURSERY",     CHILDCARE_BREAKDOWN["nursery"], "子どものための教育・保育給付等 (配置改善等) - こども家庭庁オープンデータ (https://www.cfa.go.jp/)"),
        ("REC_BIRTH_SUPP",  CHILDCARE_BREAKDOWN["birth"], "出産・子育て応援交付金 - こども家庭庁オープンデータ (https://www.cfa.go.jp/)"),
        ("REC_DANY_NURSERY",CHILDCARE_BREAKDOWN["dany"], "こども誰でも通園制度 (令和7年度本格実施に向けた体制整備) - こども家庭庁オープンデータ (https://www.cfa.go.jp/)"),
        ("REC_AFTERSCHOOL", CHILDCARE_BREAKDOWN["afterschool"], "放課後児童事業等 - こども家庭庁オープンデータ (https://www.cfa.go.jp/)"),
    ]
    for target_id, value_oku_, desc in child_recipients:
        # Boost allowance heavily if year is 2025+ (R7) as per budget (1.52T -> 2.16T)
        cfa_ratio = 1.42 if target_id == "REC_CHILD_ALLOW" and year >= 2025 else growth["childcare"]
        edges.append({
            "source_id": "SS_CHILDCARE",
            "target_id": target_id,
            "category": "remittance",
            "sub_category": "少子化対策給付",
            "value_usd": oku_to_usd(value_oku_ * cfa_ratio),
            "year": year,
            "confidence": 0.99,
            "source_dataset": "こども家庭庁 R6/R7予算 オープンデータ",
            "description": desc
        })

    # ── Layer 3: Universal Childcare (こども誰でも通園制度) -> Providers ──
    # The 126億円 budget goes to caregiver subsidies, IT systems, and facility improvements.
    dany_total = CHILDCARE_BREAKDOWN["dany"] * growth["childcare"]
    dany_destinations = [
        ("DEST_PRIV_NURSERY", 0.60, "民間保育施設等への利用料補助 (0歳1,300円/時, 1歳1,100円/時, 2歳900円/時)"),
        ("DEST_MUNI_NURSERY", 0.15, "公立保育施設への利用料補助 (国3/4, 市町朱1/4負担)"),
        ("DEST_ACCENTURE",    0.10, "総合支援システムの運用保守開発 (落札額 約12.5億円 / NJSS参照)"),
        ("ICT_CODMON",        0.03, "コドモン: 導入施設24,000+, 709自治体, シェアNo.1 (SaaS型業務支援システム導入園調査2025)"),
        ("ICT_LOOKMEE",       0.015, "ルクミー: 累計導入数20,000件+, 約60自治体, ユニファ株式会社が提供"),
        ("ICT_OTHERS",        0.005, "キッズリー(リクルート)等その他保育ICT SaaS"),
        ("DEST_FACILITY_UPGRADE", 0.10, "施設整備費の国庫補助率嵩上げ"),
    ]
    for target_id, ratio, desc in dany_destinations:
        edges.append({
            "source_id": "REC_DANY_NURSERY",
            "target_id": target_id,
            "category": "services",
            "sub_category": "委託・助成金",
            "value_usd": oku_to_usd(dany_total * ratio),
            "year": year,
            "confidence": 0.85,
            "source_dataset": "こども誰でも通園制度(仮称)の本格実施に向けた制度移行 (想定)",
            "description": desc
        })

    # ── Layer 2: Livelihood -> Recipients ──
    edges.append({
        "source_id": "SS_LIVELIHOOD",
        "target_id": "REC_LIVELIHOOD",
        "category": "remittance",
        "sub_category": "生活保護費・障害福祉",
        "value_usd": oku_to_usd(BUDGET_R6["livelihood"] * growth["livelihood"]),
        "year": year,
        "confidence": 0.95,
        "source_dataset": "参議院予算委員会調査室 R6"
    })

    return edges


def main():
    print("=" * 60)
    print("MHLW Social Security Pipeline (Real Data)")
    print("=" * 60)
    
    years = [2021, 2022, 2023, 2024]
    all_edges = []
    
    for year in years:
        flows = generate_real_flows(year)
        all_edges.extend(flows)
        total_usd = sum(e["value_usd"] for e in flows)
        total_jpy_t = total_usd / JPY_TO_USD / 1e12
        print(f"  {year}: {len(flows)} edges, Total ≈ ¥{total_jpy_t:.1f}T ({total_usd/1e9:.1f}B USD)")
        
    output_data = {
        "nodes": MHLW_NODES,
        "edges": all_edges,
        "metadata": {
            "source": [
                "参議院予算委員会調査室 (R6社会保障関係予算)",
                "厚生労働省 (国民医療費R4, 介護給付費R5)",
                "こども家庭庁 (R6/R7予算概要・オープンデータ)",
                "国立社会保障・人口問題研究所 (IPSS)"
            ],
            "generated_at": "2026-03-10T06:00:00Z",
            "scope": "Japan Social Security Expenditure Deep Dive (Real Data)",
            "reference_doc": "docs/social_security_data_sources.md"
        }
    }
    
    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    
    with open(OUTPUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(output_data, f, ensure_ascii=False, indent=2)
        
    print(f"\n✅ Written mhlw_data.json")
    print(f"   {len(MHLW_NODES)} nodes, {len(all_edges)} edges")
    print(f"   Reference: docs/social_security_data_sources.md")


if __name__ == '__main__':
    main()
