#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys


ROOT_DIR = Path(__file__).resolve().parents[1]
DEFAULT_ENV_FILE = ROOT_DIR / ".env"
DEFAULT_PIPELINE_LOG_FILE = ROOT_DIR / "eval" / "latest_daily_pipeline.json"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run the daily trusted ingest pipeline from discovery through eval."
    )
    parser.add_argument(
        "--env-file",
        default=str(DEFAULT_ENV_FILE),
        help="Path to .env file.",
    )
    parser.add_argument(
        "--listing-page-url",
        action="append",
        dest="listing_page_urls",
        default=[],
        help="Listing page URL to scan. Repeat for multiple pages.",
    )
    parser.add_argument(
        "--search-query",
        action="append",
        dest="search_queries",
        default=[],
        help="Optional discovery search query. Repeat for multiple queries.",
    )
    parser.add_argument(
        "--allowed-domain",
        action="append",
        dest="allowed_domains",
        default=[],
        help="Allowed domain. Current pipeline expects exactly one domain per run.",
    )
    parser.add_argument(
        "--file-type",
        action="append",
        dest="file_types",
        default=[],
        help="Optional discovery file type filter such as pdf or html.",
    )
    parser.add_argument(
        "--candidate-limit-per-source",
        type=int,
        default=20,
        help="Max discovery candidates per listing page or search query.",
    )
    parser.add_argument(
        "--review-limit",
        type=int,
        default=50,
        help="Max candidate count to include in the review stage.",
    )
    parser.add_argument(
        "--ingest-limit",
        type=int,
        default=50,
        help="Max approved candidates to ingest.",
    )
    parser.add_argument(
        "--eval-sample",
        type=int,
        default=None,
        help="Only run the first N eval questions.",
    )
    parser.add_argument(
        "--provider",
        default=None,
        help="Override eval answer provider.",
    )
    parser.add_argument(
        "--model",
        default=None,
        help="Override eval answer model.",
    )
    parser.add_argument(
        "--mode",
        default="hybrid",
        choices=["lexical", "semantic", "hybrid"],
        help="Eval retrieval mode.",
    )
    parser.add_argument(
        "--eval-limit",
        type=int,
        default=2,
        help="Citation limit used during eval.",
    )
    parser.add_argument(
        "--max-output-tokens",
        type=int,
        default=240,
        help="Eval generation max output tokens.",
    )
    parser.add_argument(
        "--temperature",
        type=float,
        default=0.1,
        help="Eval generation temperature.",
    )
    parser.add_argument(
        "--candidate-review-status",
        default="approved",
        choices=["approved", "pending", "rejected", "blocked", "all"],
        help="Candidate status to ingest in the trusted-ingest stage.",
    )
    parser.add_argument(
        "--owner-note",
        default=None,
        help="Owner note passed to the bulk review stage.",
    )
    parser.add_argument(
        "--pipeline-output-json-path",
        default=str(DEFAULT_PIPELINE_LOG_FILE),
        help="JSON log file path when writing pipeline output.",
    )
    parser.add_argument(
        "--no-write-log-file",
        action="store_true",
        help="Do not write the pipeline JSON log file.",
    )
    parser.add_argument(
        "--no-write-eval-files",
        action="store_true",
        help="Do not write eval/latest_results.json and eval/latest_report.md.",
    )
    parser.add_argument(
        "--disable-quality-gate",
        action="store_true",
        help="Disable the post-ingest eval quality gate.",
    )
    parser.add_argument(
        "--quality-gate-min-pass-rate",
        type=float,
        default=100.0,
        help="Fail when eval pass_rate falls below this value.",
    )
    parser.add_argument(
        "--quality-gate-max-failed-questions",
        type=int,
        default=0,
        help="Fail when eval failed question count exceeds this value.",
    )
    parser.add_argument(
        "--quality-gate-max-fallback-used",
        type=int,
        default=None,
        help="Optional max fallback_used count allowed by the quality gate.",
    )
    parser.add_argument(
        "--quality-gate-max-ingest-errors",
        type=int,
        default=0,
        help="Fail when ingest error count exceeds this value.",
    )
    parser.add_argument(
        "--quality-gate-fail-when-no-ingest",
        action="store_true",
        help="Fail even when the pipeline ingests no new documents.",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Run the pipeline for real. Without this flag the command stays in dry-run mode.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    sys.path.insert(0, str(ROOT_DIR / "scripts"))
    import run_rag_eval  # pylint: disable=import-error

    run_rag_eval.load_env_file(Path(args.env_file))
    import mcp_server  # pylint: disable=import-error

    request_args = {
        "listing_page_urls": args.listing_page_urls,
        "search_queries": args.search_queries,
        "allowed_domains": args.allowed_domains,
        "file_types": args.file_types,
        "candidate_limit_per_source": args.candidate_limit_per_source,
        "review_limit": args.review_limit,
        "ingest_limit": args.ingest_limit,
        "eval_sample": args.eval_sample,
        "provider": args.provider,
        "model": args.model,
        "mode": args.mode,
        "eval_limit": args.eval_limit,
        "max_output_tokens": args.max_output_tokens,
        "temperature": args.temperature,
        "candidate_review_status": args.candidate_review_status,
        "owner_note": args.owner_note,
        "write_log_file": not args.no_write_log_file,
        "write_eval_files": not args.no_write_eval_files,
        "pipeline_output_json_path": args.pipeline_output_json_path,
        "quality_gate_enabled": not args.disable_quality_gate,
        "quality_gate_min_pass_rate": args.quality_gate_min_pass_rate,
        "quality_gate_max_failed_questions": args.quality_gate_max_failed_questions,
        "quality_gate_max_fallback_used": args.quality_gate_max_fallback_used,
        "quality_gate_max_ingest_errors": args.quality_gate_max_ingest_errors,
        "quality_gate_fail_when_no_ingest": args.quality_gate_fail_when_no_ingest,
        "dry_run": not args.apply,
    }

    conn = mcp_server.get_db()
    try:
        result = mcp_server._daily_trusted_ingest_pipeline(request_args, conn)
    finally:
        conn.close()

    print(json.dumps(result, ensure_ascii=False, indent=2, default=str))
    if result.get("error"):
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
