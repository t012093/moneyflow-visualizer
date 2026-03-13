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
        self.assertTrue(any(fact["fact_key"] == "kodomo-daredemo-tsuen-budget-frame" for fact in structured_facts))
        self.assertTrue(any(fact["fact_key"] == "kodomo-daredemo-tsuen-rollout-sites" for fact in structured_facts))

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
