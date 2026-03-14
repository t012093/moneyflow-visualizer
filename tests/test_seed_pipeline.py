import json
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = ROOT / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import seed_db  # noqa: E402


class SeedPipelineRegressionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        unified_path = ROOT / "src" / "data" / "unified_data.json"
        cls.unified_data = json.loads(unified_path.read_text(encoding="utf-8"))

    def test_distribution_models_config_is_loaded(self) -> None:
        self.assertGreaterEqual(len(seed_db.DISTRIBUTION_MODELS), 9)
        self.assertTrue(
            any(model["source_id"] == "REC_CHILDCARE_ALL" for model in seed_db.DISTRIBUTION_MODELS)
        )
        self.assertTrue(
            any(node["id"] == "DEST_AFTER_SCHOOL_PUBLIC_PRIVATE" for node in seed_db.DISTRIBUTION_MODEL_NODES)
        )
        self.assertTrue(
            any(node["id"] == "DEST_AFTER_SCHOOL_FAC_PUBLIC" for node in seed_db.DISTRIBUTION_MODEL_NODES)
        )
        self.assertTrue(
            any(node["id"] == "DEST_AFTER_SCHOOL_DX_VENDOR" for node in seed_db.DISTRIBUTION_MODEL_NODES)
        )
        self.assertTrue(
            any(node["id"] == "DEST_AFTER_SCHOOL_TRAINING_CERTIFICATION" for node in seed_db.DISTRIBUTION_MODEL_NODES)
        )
        self.assertTrue(
            any(node["id"] == "DEST_AFTER_SCHOOL_TRAINING_CERT_VENDOR" for node in seed_db.DISTRIBUTION_MODEL_NODES)
        )
        self.assertTrue(
            any(model["source_id"] == "REC_KOBE_DAREDEMO_SITES" for model in seed_db.IMPLEMENTATION_SITE_FLOW_MODELS)
        )

    def test_legacy_source_rewrites_cover_known_404s(self) -> None:
        self.assertEqual(
            seed_db.rewrite_source_url("https://www.mhlw.go.jp/toukei/saikin/hw/k-iryohi/"),
            "https://www.mhlw.go.jp/toukei/list/37-21a.html",
        )
        self.assertEqual(
            seed_db.rewrite_source_url("https://www.mhlw.go.jp/toukei/saikin/hw/kaigo/kyufu/"),
            "https://www.mhlw.go.jp/toukei/list/45-1b.html",
        )
        self.assertEqual(
            seed_db.rewrite_source_url("https://www.mof.go.jp/policy/budget/budger_workflow/budget/fy2022/seifuan2022/03.pdf"),
            "https://www.mof.go.jp/policy/budget/budger_workflow/budget/fy2022/sy030118.html",
        )

    def test_meti_modeled_edges_do_not_fall_back_to_homepage(self) -> None:
        source_url, source_title = seed_db.resolve_source_reference(
            edge={"description": "Corporate Tax Revenue from Toyota Motor Corp"},
            dataset_name="meti_data",
            fallback_url="https://www.meti.go.jp/",
        )
        self.assertEqual(source_url, "")
        self.assertEqual(source_title, "meti_data")

    def test_official_document_timeout_is_treated_as_valid(self) -> None:
        status = seed_db.classify_validation_status(
            "https://www.meti.go.jp/main/yosan/yosan_fy2024/pdf/01.pdf",
            None,
            "The read operation timed out",
        )
        self.assertEqual(status, "valid")

    def test_unified_export_contains_cfa_knowledge_notes_and_structured_facts(self) -> None:
        metadata = self.unified_data["metadata"]
        knowledge_notes = metadata.get("knowledgeNotes", [])
        structured_facts = metadata.get("structuredFacts", [])

        self.assertTrue(any(note["note_key"] == "kodomo-daredemo-tsuen-official-flow" for note in knowledge_notes))
        self.assertTrue(any(note["note_key"] == "after-school-club-support-2025" for note in knowledge_notes))
        self.assertTrue(any(note["note_key"] == "ibasho-model-recipients-2025" for note in knowledge_notes))
        self.assertTrue(any(note["note_key"] == "child-abuse-digital-procurement-2025" for note in knowledge_notes))
        ibasho_note = next(note for note in knowledge_notes if note["note_key"] == "ibasho-model-recipients-2025")
        self.assertEqual(ibasho_note.get("flow_focus_target_id"), "REC_IBASHO_SUPPORT")
        abuse_note = next(note for note in knowledge_notes if note["note_key"] == "child-abuse-digital-procurement-2025")
        self.assertEqual(abuse_note.get("flow_focus_target_id"), "REC_ABUSE_PREVENTION")
        self.assertTrue(any(fact["fact_key"] == "kodomo-daredemo-tsuen-budget-frame" for fact in structured_facts))
        self.assertTrue(any(fact["fact_key"] == "kodomo-daredemo-tsuen-rollout-sites" for fact in structured_facts))
        self.assertTrue(any(fact["fact_key"] == "ibasho-system-strengthening-budget-2025" for fact in structured_facts))
        self.assertTrue(any(fact["fact_key"] == "ibasho-model-subsidy-ceiling-2025" for fact in structured_facts))
        self.assertTrue(any(fact["fact_key"] == "ibasho-model-recipient-buckets-2025" for fact in structured_facts))
        self.assertTrue(any(fact["fact_key"] == "ibasho-model-municipal-examples-2025" for fact in structured_facts))
        self.assertTrue(any(fact["fact_key"] == "ibasho-model-private-examples-2025" for fact in structured_facts))
        self.assertTrue(any(fact["fact_key"] == "ibasho-model-disaster-selection-2025" for fact in structured_facts))
        self.assertTrue(any(fact["fact_key"] == "after-school-club-op-budget-2025" for fact in structured_facts))
        self.assertTrue(any(fact["fact_key"] == "after-school-club-training-budget-2025" for fact in structured_facts))
        self.assertTrue(any(fact["fact_key"] == "after-school-club-training-certification-2025" for fact in structured_facts))
        self.assertTrue(any(fact["fact_key"] == "after-school-club-training-upskilling-2025" for fact in structured_facts))
        self.assertTrue(any(fact["fact_key"] == "after-school-club-training-certification-examples-2025" for fact in structured_facts))
        self.assertTrue(any(fact["fact_key"] == "after-school-club-training-upskilling-examples-2025" for fact in structured_facts))
        self.assertTrue(any(fact["fact_key"] == "after-school-club-dx-pilot-budget-2025" for fact in structured_facts))
        self.assertTrue(any(fact["fact_key"] == "after-school-club-dx-pilot-consortium-2025" for fact in structured_facts))
        self.assertTrue(any(fact["fact_key"] == "after-school-club-ict-inner-frame-2025" for fact in structured_facts))
        self.assertTrue(any(fact["fact_key"] == "after-school-club-operators-2025" for fact in structured_facts))
        self.assertTrue(any(fact["fact_key"] == "after-school-club-fac-public-route-2025" for fact in structured_facts))
        self.assertTrue(any(fact["fact_key"] == "after-school-club-fac-public-eligibility-2025" for fact in structured_facts))
        self.assertTrue(any(fact["fact_key"] == "after-school-club-fac-private-route-2025" for fact in structured_facts))
        self.assertTrue(any(fact["fact_key"] == "after-school-club-fac-creation-eligible-costs-2025" for fact in structured_facts))
        self.assertTrue(any(fact["fact_key"] == "after-school-club-fac-creation-ineligible-costs-2025" for fact in structured_facts))
        self.assertTrue(any(fact["fact_key"] == "after-school-club-fac-creation-requirements-2025" for fact in structured_facts))
        self.assertTrue(any(fact["fact_key"] == "after-school-club-fac-public-examples-2025" for fact in structured_facts))
        self.assertTrue(any(fact["fact_key"] == "after-school-club-fac-private-examples-2025" for fact in structured_facts))
        self.assertTrue(any(fact["fact_key"] == "child-abuse-digital-central-contract-total-2025" for fact in structured_facts))
        self.assertTrue(any(fact["fact_key"] == "child-abuse-digital-sns-central-2025" for fact in structured_facts))
        self.assertTrue(any(fact["fact_key"] == "child-abuse-digital-ai-central-2025" for fact in structured_facts))
        self.assertTrue(any(fact["fact_key"] == "child-abuse-digital-local-examples-2025" for fact in structured_facts))

        edges = self.unified_data["edges"]
        self.assertTrue(any(edge["year"] == 2025 and edge["target_id"] == "REC_AFTER_SCHOOL_DX_PILOT" for edge in edges))
        self.assertTrue(any(edge["year"] == 2025 and edge["target_id"] == "REC_IBASHO_SUPPORT" for edge in edges))
        self.assertTrue(any(edge["year"] == 2025 and edge["target_id"] == "REC_ABUSE_PREVENTION" for edge in edges))

    def test_unified_export_contains_exact_child_abuse_digital_downstream_in_2025(self) -> None:
        edges = self.unified_data["edges"]
        abuse_downstream = [
            edge
            for edge in edges
            if edge["year"] == 2025 and edge["source_id"] == "REC_ABUSE_PREVENTION"
        ]
        self.assertEqual(
            {edge["target_id"] for edge in abuse_downstream},
            {
                "REC_ABUSE_SNS_SYSTEM",
                "REC_ABUSE_AI_TOOL",
                "REC_ABUSE_AI_PM",
                "REC_ABUSE_LINE_PUSH",
            },
        )
        self.assertTrue(
            all(edge["source_dataset"] == "こども家庭庁 令和7年度契約公表（児童虐待防止デジタル案件）" for edge in abuse_downstream)
        )
        self.assertAlmostEqual(
            sum(edge["value_usd"] for edge in abuse_downstream),
            735346700 / 150,
            delta=1e-6,
        )

    def test_training_example_facts_include_confirmed_2025_recipients(self) -> None:
        structured_facts = self.unified_data["metadata"].get("structuredFacts", [])
        certification_examples = next(
            fact for fact in structured_facts if fact["fact_key"] == "after-school-club-training-certification-examples-2025"
        )
        upskilling_examples = next(
            fact for fact in structured_facts if fact["fact_key"] == "after-school-club-training-upskilling-examples-2025"
        )

        self.assertIn("神戸市=東京リーガルマインド", certification_examples["value_text"])
        self.assertIn("山口県=NPO法人学童保育協会", certification_examples["value_text"])
        self.assertIn("千葉県=東京リーガルマインド", upskilling_examples["value_text"])

    def test_unified_export_bridges_cfa_daredemo_to_distribution_targets_in_2025(self) -> None:
        edges = self.unified_data["edges"]
        parent_edge = next(
            (
                edge
                for edge in edges
                if edge["year"] == 2025
                and edge["source_id"] == "MIN_CFA"
                and edge["target_id"] == "REC_CHILDCARE_ALL"
            ),
            None,
        )
        self.assertIsNotNone(parent_edge)

        child_edges = [
            edge
            for edge in edges
            if edge["year"] == 2025 and edge["source_id"] == "REC_CHILDCARE_ALL"
        ]
        self.assertEqual({edge["target_id"] for edge in child_edges}, {
            "DEST_PRIV_NURSERY",
            "DEST_MUNI_NURSERY",
            "DEST_ACCENTURE",
            "ICT_CODMON",
            "ICT_LOOKMEE",
            "ICT_OTHERS",
            "DEST_FACILITY_UPGRADE",
        })
        self.assertTrue(
            all(edge["source_dataset"] == seed_db.CFA_DAREDEMO_MODELED_DATASET for edge in child_edges)
        )
        self.assertAlmostEqual(
            sum(edge["value_usd"] for edge in child_edges),
            parent_edge["value_usd"],
            delta=1e-6,
        )

    def test_unified_export_bridges_after_school_op_to_operator_buckets_in_2025(self) -> None:
        edges = self.unified_data["edges"]
        parent_edge = next(
            (
                edge
                for edge in edges
                if edge["year"] == 2025
                and edge["source_id"] == "MIN_CFA"
                and edge["target_id"] == "REC_AFTER_SCHOOL_OP"
            ),
            None,
        )
        self.assertIsNotNone(parent_edge)

        child_edges = [
            edge
            for edge in edges
            if edge["year"] == 2025 and edge["source_id"] == "REC_AFTER_SCHOOL_OP"
        ]
        self.assertEqual(
            {edge["target_id"] for edge in child_edges},
            {
                "DEST_AFTER_SCHOOL_PUBLIC_PUBLIC",
                "DEST_AFTER_SCHOOL_PUBLIC_PRIVATE",
                "DEST_AFTER_SCHOOL_PRIVATE_PRIVATE",
            },
        )
        self.assertTrue(
            all(edge["source_dataset"] == seed_db.CFA_AFTER_SCHOOL_OP_MODELED_DATASET for edge in child_edges)
        )
        self.assertAlmostEqual(
            sum(edge["value_usd"] for edge in child_edges),
            parent_edge["value_usd"],
            delta=1e-6,
        )

    def test_unified_export_bridges_after_school_op_to_operator_subtypes_in_2025(self) -> None:
        edges = self.unified_data["edges"]
        public_private_parent = next(
            (
                edge
                for edge in edges
                if edge["year"] == 2025
                and edge["source_id"] == "REC_AFTER_SCHOOL_OP"
                and edge["target_id"] == "DEST_AFTER_SCHOOL_PUBLIC_PRIVATE"
            ),
            None,
        )
        private_private_parent = next(
            (
                edge
                for edge in edges
                if edge["year"] == 2025
                and edge["source_id"] == "REC_AFTER_SCHOOL_OP"
                and edge["target_id"] == "DEST_AFTER_SCHOOL_PRIVATE_PRIVATE"
            ),
            None,
        )
        self.assertIsNotNone(public_private_parent)
        self.assertIsNotNone(private_private_parent)

        public_private_children = [
            edge
            for edge in edges
            if edge["year"] == 2025 and edge["source_id"] == "DEST_AFTER_SCHOOL_PUBLIC_PRIVATE"
        ]
        self.assertEqual(
            {edge["target_id"] for edge in public_private_children},
            {
                "DEST_AFTER_SCHOOL_PUBLIC_PRIVATE_SOCIAL_WELFARE",
                "DEST_AFTER_SCHOOL_PUBLIC_PRIVATE_PUBLIC_INTEREST",
                "DEST_AFTER_SCHOOL_PUBLIC_PRIVATE_NPO",
                "DEST_AFTER_SCHOOL_PUBLIC_PRIVATE_COMMITTEE",
                "DEST_AFTER_SCHOOL_PUBLIC_PRIVATE_VOLUNTARY",
                "DEST_AFTER_SCHOOL_PUBLIC_PRIVATE_CORPORATION",
                "DEST_AFTER_SCHOOL_PUBLIC_PRIVATE_SCHOOL",
                "DEST_AFTER_SCHOOL_PUBLIC_PRIVATE_OTHER",
            },
        )
        self.assertTrue(
            all(edge["source_dataset"] == seed_db.CFA_AFTER_SCHOOL_OP_MODELED_DATASET for edge in public_private_children)
        )
        self.assertAlmostEqual(
            sum(edge["value_usd"] for edge in public_private_children),
            public_private_parent["value_usd"],
            delta=1e-6,
        )

        private_private_children = [
            edge
            for edge in edges
            if edge["year"] == 2025 and edge["source_id"] == "DEST_AFTER_SCHOOL_PRIVATE_PRIVATE"
        ]
        self.assertEqual(
            {edge["target_id"] for edge in private_private_children},
            {
                "DEST_AFTER_SCHOOL_PRIVATE_PRIVATE_SOCIAL_WELFARE",
                "DEST_AFTER_SCHOOL_PRIVATE_PRIVATE_PUBLIC_INTEREST",
                "DEST_AFTER_SCHOOL_PRIVATE_PRIVATE_NPO",
                "DEST_AFTER_SCHOOL_PRIVATE_PRIVATE_COMMITTEE",
                "DEST_AFTER_SCHOOL_PRIVATE_PRIVATE_VOLUNTARY",
                "DEST_AFTER_SCHOOL_PRIVATE_PRIVATE_CORPORATION",
                "DEST_AFTER_SCHOOL_PRIVATE_PRIVATE_SCHOOL",
                "DEST_AFTER_SCHOOL_PRIVATE_PRIVATE_OTHER",
            },
        )
        self.assertTrue(
            all(edge["source_dataset"] == seed_db.CFA_AFTER_SCHOOL_OP_MODELED_DATASET for edge in private_private_children)
        )
        self.assertAlmostEqual(
            sum(edge["value_usd"] for edge in private_private_children),
            private_private_parent["value_usd"],
            delta=1e-6,
        )

    def test_unified_export_bridges_after_school_fac_to_public_private_buckets_in_2025(self) -> None:
        edges = self.unified_data["edges"]
        parent_edge = next(
            (
                edge
                for edge in edges
                if edge["year"] == 2025
                and edge["source_id"] == "MIN_CFA"
                and edge["target_id"] == "REC_AFTER_SCHOOL_FAC"
            ),
            None,
        )
        self.assertIsNotNone(parent_edge)

        child_edges = [
            edge
            for edge in edges
            if edge["year"] == 2025 and edge["source_id"] == "REC_AFTER_SCHOOL_FAC"
        ]
        self.assertEqual(
            {edge["target_id"] for edge in child_edges},
            {
                "DEST_AFTER_SCHOOL_FAC_PUBLIC",
                "DEST_AFTER_SCHOOL_FAC_PRIVATE",
            },
        )
        self.assertTrue(
            all(edge["source_dataset"] == seed_db.CFA_AFTER_SCHOOL_FAC_MODELED_DATASET for edge in child_edges)
        )
        self.assertAlmostEqual(
            sum(edge["value_usd"] for edge in child_edges),
            parent_edge["value_usd"],
            delta=1e-6,
        )

    def test_unified_export_bridges_after_school_dx_pilot_to_consortium_roles_in_2025(self) -> None:
        edges = self.unified_data["edges"]
        parent_edge = next(
            (
                edge
                for edge in edges
                if edge["year"] == 2025
                and edge["source_id"] == "MIN_CFA"
                and edge["target_id"] == "REC_AFTER_SCHOOL_DX_PILOT"
            ),
            None,
        )
        self.assertIsNotNone(parent_edge)

        child_edges = [
            edge
            for edge in edges
            if edge["year"] == 2025 and edge["source_id"] == "REC_AFTER_SCHOOL_DX_PILOT"
        ]
        self.assertEqual(
            {edge["target_id"] for edge in child_edges},
            {
                "DEST_AFTER_SCHOOL_DX_MUNICIPAL",
                "DEST_AFTER_SCHOOL_DX_OPERATORS",
                "DEST_AFTER_SCHOOL_DX_VENDOR",
            },
        )
        self.assertTrue(
            all(
                edge["source_dataset"] == "放課後児童クラブDX推進実証 構成員別均等按分 (事業別資料集ベース)"
                for edge in child_edges
            )
        )
        self.assertAlmostEqual(
            sum(edge["value_usd"] for edge in child_edges),
            parent_edge["value_usd"],
            delta=1e-6,
        )

    def test_unified_export_bridges_after_school_training_to_two_training_types_in_2025(self) -> None:
        edges = self.unified_data["edges"]
        parent_edge = next(
            (
                edge
                for edge in edges
                if edge["year"] == 2025
                and edge["source_id"] == "MIN_CFA"
                and edge["target_id"] == "REC_AFTER_SCHOOL_DX"
            ),
            None,
        )
        self.assertIsNotNone(parent_edge)

        child_edges = [
            edge
            for edge in edges
            if edge["year"] == 2025 and edge["source_id"] == "REC_AFTER_SCHOOL_DX"
        ]
        self.assertEqual(
            {edge["target_id"] for edge in child_edges},
            {
                "DEST_AFTER_SCHOOL_TRAINING_CERTIFICATION",
                "DEST_AFTER_SCHOOL_TRAINING_UPSKILLING",
            },
        )
        self.assertTrue(
            all(
                edge["source_dataset"] == "放課後児童クラブ研修関係 研修区分別均等按分 (事業別資料集ベース)"
                for edge in child_edges
            )
        )
        self.assertAlmostEqual(
            sum(edge["value_usd"] for edge in child_edges),
            parent_edge["value_usd"],
            delta=1e-6,
        )

    def test_unified_export_bridges_training_types_to_public_and_vendor_routes_in_2025(self) -> None:
        edges = self.unified_data["edges"]

        cert_parent = next(
            (
                edge
                for edge in edges
                if edge["year"] == 2025
                and edge["source_id"] == "REC_AFTER_SCHOOL_DX"
                and edge["target_id"] == "DEST_AFTER_SCHOOL_TRAINING_CERTIFICATION"
            ),
            None,
        )
        self.assertIsNotNone(cert_parent)
        cert_children = [
            edge
            for edge in edges
            if edge["year"] == 2025 and edge["source_id"] == "DEST_AFTER_SCHOOL_TRAINING_CERTIFICATION"
        ]
        self.assertEqual(
            {edge["target_id"] for edge in cert_children},
            {
                "DEST_AFTER_SCHOOL_TRAINING_CERT_PUBLIC",
                "DEST_AFTER_SCHOOL_TRAINING_CERT_VENDOR",
            },
        )
        self.assertAlmostEqual(
            sum(edge["value_usd"] for edge in cert_children),
            cert_parent["value_usd"],
            delta=1e-6,
        )

        upskill_parent = next(
            (
                edge
                for edge in edges
                if edge["year"] == 2025
                and edge["source_id"] == "REC_AFTER_SCHOOL_DX"
                and edge["target_id"] == "DEST_AFTER_SCHOOL_TRAINING_UPSKILLING"
            ),
            None,
        )
        self.assertIsNotNone(upskill_parent)
        upskill_children = [
            edge
            for edge in edges
            if edge["year"] == 2025 and edge["source_id"] == "DEST_AFTER_SCHOOL_TRAINING_UPSKILLING"
        ]
        self.assertEqual(
            {edge["target_id"] for edge in upskill_children},
            {
                "DEST_AFTER_SCHOOL_TRAINING_UPSKILL_PUBLIC",
                "DEST_AFTER_SCHOOL_TRAINING_UPSKILL_VENDOR",
            },
        )
        self.assertAlmostEqual(
            sum(edge["value_usd"] for edge in upskill_children),
            upskill_parent["value_usd"],
            delta=1e-6,
        )

    def test_unified_export_contains_reviewed_ministry_knowledge_for_other_agencies(self) -> None:
        metadata = self.unified_data["metadata"]
        knowledge_notes = metadata.get("knowledgeNotes", [])
        structured_facts = metadata.get("structuredFacts", [])

        expected_note_keys = {
            "mhlw-reviewed-budget-2025",
            "mext-reviewed-budget-2025",
            "mlit-reviewed-budget-2024",
            "meti-reviewed-budget-2025",
        }
        expected_fact_keys = {
            "mhlw-fy2025-total-budget",
            "mext-fy2025-total-budget",
            "mlit-fy2024-total-budget",
            "meti-fy2025-total-budget",
        }

        self.assertTrue(expected_note_keys.issubset({note["note_key"] for note in knowledge_notes}))
        self.assertTrue(expected_fact_keys.issubset({fact["fact_key"] for fact in structured_facts}))

    def test_unified_export_contains_kobe_reviewed_local_gov_data(self) -> None:
        node_ids = {node["id"] for node in self.unified_data["nodes"]}
        self.assertIn("CITY_KOBE", node_ids)
        self.assertIn("REC_KOBE_DAREDEMO_SITES", node_ids)

        kobe_edge = next(
            (
                edge
                for edge in self.unified_data["edges"]
                if edge["year"] == 2025
                and edge["source_id"] == "CITY_KOBE"
                and edge["target_id"] == "REC_KOBE_DAREDEMO_SITES"
            ),
            None,
        )
        self.assertIsNotNone(kobe_edge)
        self.assertEqual(kobe_edge["source_dataset"], seed_db.KOBE_DAREDEMO_BUDGET_DATASET)
        self.assertAlmostEqual(kobe_edge["value_usd"], seed_db.KOBE_DAREDEMO_BUDGET_JPY / seed_db.JPY_PER_USD)

        metadata = self.unified_data["metadata"]
        self.assertTrue(any(item["entity_id"] == "CITY_KOBE" for item in metadata.get("budgetHighlights", [])))
        self.assertTrue(
            any(
                item["entity_id"] == "CITY_KOBE" and item["title"] == "施設向け補助ルール"
                for item in metadata.get("budgetHighlights", [])
            )
        )
        self.assertTrue(any(note["note_key"] == "kobe-daredemo-reviewed-2025" for note in metadata.get("knowledgeNotes", [])))
        self.assertTrue(any(fact["fact_key"] == "kobe-daredemo-facilities-2025-07" for fact in metadata.get("structuredFacts", [])))
        self.assertTrue(any(fact["fact_key"] == "kobe-daredemo-rent-cap-2025" for fact in metadata.get("structuredFacts", [])))
        self.assertTrue(any(fact["fact_key"] == "kobe-daredemo-renovation-cap-2025" for fact in metadata.get("structuredFacts", [])))

    def test_unified_export_contains_kobe_implementation_sites(self) -> None:
        implementation_sites = self.unified_data["metadata"].get("implementationSites", [])
        kobe_sites = [
            site
            for site in implementation_sites
            if site["entity_id"] == "CITY_KOBE" and site["fiscal_year"] == 2025
        ]

        self.assertEqual(len(kobe_sites), 35)
        self.assertEqual(
            {site["ward"] for site in kobe_sites},
            {"東灘区", "灘区", "中央区", "兵庫区", "北区", "長田区", "須磨区", "垂水区", "西区"},
        )
        self.assertTrue(any(site["site_name"] == "御影ちぬっこ保育ルーム" for site in kobe_sites))
        self.assertTrue(all(site["sources"] for site in kobe_sites))

    def test_unified_export_bridges_kobe_to_implementation_sites(self) -> None:
        edges = self.unified_data["edges"]
        parent_edge = next(
            (
                edge
                for edge in edges
                if edge["year"] == 2025
                and edge["source_id"] == "CITY_KOBE"
                and edge["target_id"] == "REC_KOBE_DAREDEMO_SITES"
            ),
            None,
        )
        self.assertIsNotNone(parent_edge)

        child_edges = [
            edge
            for edge in edges
            if edge["year"] == 2025 and edge["source_id"] == "REC_KOBE_DAREDEMO_SITES"
        ]
        self.assertEqual(len(child_edges), 35)
        self.assertTrue(all(edge["target_id"].startswith("IMPL_SITE_KOBE_DAREDEMO_") for edge in child_edges))
        self.assertTrue(
            all(edge["source_dataset"] == "神戸市こども誰でも通園制度 実施施設別按分 (35施設均等)" for edge in child_edges)
        )
        self.assertAlmostEqual(
            sum(edge["value_usd"] for edge in child_edges),
            parent_edge["value_usd"],
            delta=1e-6,
        )
        target_node_ids = {node["id"] for node in self.unified_data["nodes"]}
        self.assertIn("IMPL_SITE_KOBE_DAREDEMO_01", target_node_ids)

    def test_doc_paths_referenced_by_knowledge_notes_exist(self) -> None:
        for note in self.unified_data["metadata"].get("knowledgeNotes", []):
            doc_path = note.get("doc_path")
            if not doc_path:
                continue

            self.assertTrue((ROOT / doc_path).exists(), msg=f"Missing knowledge note doc: {doc_path}")

    def test_unified_export_has_no_generic_meti_homepage_provenance(self) -> None:
        urls = set()

        for edge in self.unified_data["edges"]:
            source_url = edge.get("source_url")
            if source_url:
                urls.add(source_url)

        for item in self.unified_data["metadata"].get("budgetHighlights", []):
            source_url = item.get("source_url")
            if source_url:
                urls.add(source_url)

        for note in self.unified_data["metadata"].get("knowledgeNotes", []):
            for source in note.get("sources", []):
                urls.add(source["source_url"])

        for fact in self.unified_data["metadata"].get("structuredFacts", []):
            for source in fact.get("sources", []):
                urls.add(source["source_url"])

        self.assertNotIn("https://www.meti.go.jp/", urls)


if __name__ == "__main__":
    unittest.main()
