#!/usr/bin/env python3
from __future__ import annotations

import argparse
from datetime import datetime
import json
import os
from pathlib import Path
import re
import sys
import time
from typing import Any
import unicodedata


ROOT_DIR = Path(__file__).resolve().parents[1]
DEFAULT_ENV_FILE = ROOT_DIR / ".env"
DEFAULT_QUESTIONS_FILE = ROOT_DIR / "eval" / "questions.json"
DEFAULT_RESULTS_FILE = ROOT_DIR / "eval" / "latest_results.json"
DEFAULT_REPORT_FILE = ROOT_DIR / "eval" / "latest_report.md"


def load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        os.environ.setdefault(key, value)


def normalize_match_text(text: str) -> str:
    normalized = unicodedata.normalize("NFKC", text or "").lower()
    normalized = re.sub(r"\s+", "", normalized)
    return normalized


def match_all_terms(text: str, terms: list[str]) -> bool:
    normalized_text = normalize_match_text(text)
    return all(normalize_match_text(term) in normalized_text for term in terms)


def match_any_terms(text: str, terms: list[str]) -> bool:
    normalized_text = normalize_match_text(text)
    return any(normalize_match_text(term) in normalized_text for term in terms)


def flatten_citation_text(citations: list[dict[str, Any]]) -> str:
    parts: list[str] = []
    for citation in citations:
        for key in ("file_name", "snippet", "content"):
            value = citation.get(key)
            if value:
                parts.append(str(value))
    return "\n".join(parts)


def has_citation_markers(text: str) -> bool:
    return bool(re.search(r"\[\d+\]", text or ""))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run local RAG evaluation against eval/questions.json.")
    parser.add_argument("--questions", default=str(DEFAULT_QUESTIONS_FILE), help="Path to questions JSON.")
    parser.add_argument("--env-file", default=str(DEFAULT_ENV_FILE), help="Path to .env file.")
    parser.add_argument("--output-json", default=str(DEFAULT_RESULTS_FILE), help="Path to write JSON results.")
    parser.add_argument("--output-md", default=str(DEFAULT_REPORT_FILE), help="Path to write Markdown report.")
    parser.add_argument("--provider", default=None, help="Override answer provider.")
    parser.add_argument("--model", default=None, help="Override answer model.")
    parser.add_argument("--mode", default="hybrid", help="Default retrieval mode.")
    parser.add_argument("--limit", type=int, default=2, help="Default citation limit per question.")
    parser.add_argument("--max-output-tokens", type=int, default=240, help="Default generation max output tokens.")
    parser.add_argument("--temperature", type=float, default=0.1, help="Default generation temperature.")
    parser.add_argument("--citation-retry-limit", type=int, default=None, help="Override citation retry limit.")
    parser.add_argument("--sample", type=int, default=None, help="Only run the first N questions.")
    return parser.parse_args()


def build_request_args(question: dict[str, Any], args: argparse.Namespace) -> dict[str, Any]:
    request = {
        "query": question["query"],
        "mode": question.get("mode", args.mode),
        "limit": int(question.get("limit", args.limit)),
        "max_output_tokens": int(question.get("max_output_tokens", args.max_output_tokens)),
        "temperature": float(question.get("temperature", args.temperature)),
    }
    if args.provider or question.get("provider"):
        request["provider"] = question.get("provider", args.provider)
    if args.model or question.get("model"):
        request["model"] = question.get("model", args.model)
    if question.get("document_id") is not None:
        request["document_id"] = int(question["document_id"])
    if args.citation_retry_limit is not None or question.get("citation_retry_limit") is not None:
        request["citation_retry_limit"] = int(question.get("citation_retry_limit", args.citation_retry_limit))
    return request


def evaluate_result(question: dict[str, Any], result: dict[str, Any], duration_seconds: float) -> dict[str, Any]:
    citations = result.get("citations", [])
    answer = result.get("answer", "")
    warnings = result.get("warnings") or []
    generation = result.get("answer_generation", {})
    citation_text = flatten_citation_text(citations)
    citation_files = sorted({citation.get("file_name", "") for citation in citations if citation.get("file_name")})
    citation_pages = sorted({int(citation["page_number"]) for citation in citations if citation.get("page_number") is not None})

    expected_file_name = question.get("expected_file_name")
    expected_pages = question.get("expected_page_numbers_any", [])
    expected_citation_terms_all = question.get("expected_citation_terms_all", [])
    expected_answer_terms_any = question.get("expected_answer_terms_any", [])

    criteria = {
        "answer_generated": generation.get("status") == "generated",
        "citation_markers_present": has_citation_markers(answer),
        "citation_count_ok": len(citations) >= int(question.get("min_citation_count", 1)),
        "expected_file_hit": (not expected_file_name) or expected_file_name in citation_files,
        "expected_page_hit": (not expected_pages) or any(page in set(expected_pages) for page in citation_pages),
        "citation_terms_hit": (not expected_citation_terms_all) or match_all_terms(citation_text, expected_citation_terms_all),
        "answer_terms_hit": (not expected_answer_terms_any) or match_any_terms(answer, expected_answer_terms_any),
    }

    passed = all(criteria.values())

    return {
        "id": question["id"],
        "query": question["query"],
        "notes": question.get("notes", ""),
        "pass": passed,
        "criteria": criteria,
        "duration_seconds": round(duration_seconds, 3),
        "metrics": {
            "search_count": int(result.get("search_count", 0)),
            "citation_count": len(citations),
            "warning_count": len(warnings),
            "fallback_used": bool(generation.get("citation_fallback")),
            "citation_attempt_count": len(generation.get("citation_attempts") or []),
        },
        "expected": {
            "file_name": expected_file_name,
            "page_numbers_any": expected_pages,
            "citation_terms_all": expected_citation_terms_all,
            "answer_terms_any": expected_answer_terms_any,
        },
        "observed": {
            "file_names": citation_files,
            "page_numbers": citation_pages,
            "warnings": warnings,
            "answer": answer,
            "citation_fallback_format": generation.get("citation_fallback_format"),
        },
        "citations": [
            {
                "citation_id": citation.get("citation_id"),
                "file_name": citation.get("file_name"),
                "page_number": citation.get("page_number"),
                "score": citation.get("score"),
                "snippet": citation.get("snippet"),
            }
            for citation in citations
        ],
    }


def build_summary(results: list[dict[str, Any]]) -> dict[str, Any]:
    total = len(results)
    passed = sum(1 for result in results if result["pass"])
    generated = sum(1 for result in results if result["criteria"]["answer_generated"])
    citation_markers = sum(1 for result in results if result["criteria"]["citation_markers_present"])
    expected_files = sum(1 for result in results if result["criteria"]["expected_file_hit"])
    expected_pages = sum(1 for result in results if result["criteria"]["expected_page_hit"])
    citation_terms = sum(1 for result in results if result["criteria"]["citation_terms_hit"])
    answer_terms = sum(1 for result in results if result["criteria"]["answer_terms_hit"])
    fallback_used = sum(1 for result in results if result["metrics"]["fallback_used"])
    avg_duration = round(sum(result["duration_seconds"] for result in results) / total, 3) if total else 0.0

    return {
        "total_questions": total,
        "passed_questions": passed,
        "pass_rate": round((passed / total) * 100, 1) if total else 0.0,
        "generated_answers": generated,
        "citation_marker_answers": citation_markers,
        "expected_file_hits": expected_files,
        "expected_page_hits": expected_pages,
        "citation_term_hits": citation_terms,
        "answer_term_hits": answer_terms,
        "fallback_used": fallback_used,
        "average_duration_seconds": avg_duration,
        "failed_ids": [result["id"] for result in results if not result["pass"]],
    }


def escape_markdown(text: str) -> str:
    return text.replace("|", "\\|").replace("\n", " ")


def build_markdown_report(payload: dict[str, Any]) -> str:
    summary = payload["summary"]
    lines = [
        "# Local RAG Eval Report",
        "",
        f"- Generated at: `{payload['generated_at']}`",
        f"- Questions: `{summary['total_questions']}`",
        f"- Passed: `{summary['passed_questions']}` / `{summary['total_questions']}` ({summary['pass_rate']}%)",
        f"- Average duration: `{summary['average_duration_seconds']} sec`",
        f"- Fallback used: `{summary['fallback_used']}`",
        "",
        "## Summary",
        "",
        "| Metric | Value |",
        "| --- | ---: |",
        f"| Generated answers | {summary['generated_answers']} |",
        f"| Citation marker answers | {summary['citation_marker_answers']} |",
        f"| Expected file hits | {summary['expected_file_hits']} |",
        f"| Expected page hits | {summary['expected_page_hits']} |",
        f"| Citation term hits | {summary['citation_term_hits']} |",
        f"| Answer term hits | {summary['answer_term_hits']} |",
        "",
        "## Results",
        "",
        "| ID | Pass | File | Pages | Citations | Fallback | Sec |",
        "| --- | --- | --- | --- | ---: | --- | ---: |",
    ]

    for result in payload["results"]:
        observed = result["observed"]
        lines.append(
            f"| {result['id']} | {'PASS' if result['pass'] else 'FAIL'} | "
            f"{escape_markdown(', '.join(observed['file_names']) or '-')} | "
            f"{escape_markdown(', '.join(str(page) for page in observed['page_numbers']) or '-')} | "
            f"{result['metrics']['citation_count']} | "
            f"{'yes' if result['metrics']['fallback_used'] else 'no'} | "
            f"{result['duration_seconds']} |"
        )

    failures = [result for result in payload["results"] if not result["pass"]]
    lines.extend(["", "## Failures", ""])
    if not failures:
        lines.append("No failures.")
    else:
        for result in failures:
            failed_checks = [name for name, ok in result["criteria"].items() if not ok]
            answer_preview = escape_markdown(result["observed"]["answer"][:240]) or "-"
            warnings = escape_markdown("; ".join(result["observed"]["warnings"])) or "-"
            lines.extend([
                f"### {result['id']}",
                "",
                f"- Query: `{result['query']}`",
                f"- Failed checks: `{', '.join(failed_checks)}`",
                f"- Answer: {answer_preview}",
                f"- Warnings: {warnings}",
                "",
            ])

    return "\n".join(lines) + "\n"


def load_questions(path: Path, sample: int | None = None) -> list[dict[str, Any]]:
    questions = json.loads(path.read_text(encoding="utf-8"))
    if sample is not None:
        questions = questions[:sample]
    return questions


def run_eval(
    *,
    conn: Any,
    questions: list[dict[str, Any]],
    provider: str | None = None,
    model: str | None = None,
    mode: str = "hybrid",
    limit: int = 2,
    max_output_tokens: int = 240,
    temperature: float = 0.1,
    citation_retry_limit: int | None = None,
) -> dict[str, Any]:
    import mcp_server  # pylint: disable=import-error

    class EvalArgs:
        def __init__(self) -> None:
            self.provider = provider
            self.model = model
            self.mode = mode
            self.limit = limit
            self.max_output_tokens = max_output_tokens
            self.temperature = temperature
            self.citation_retry_limit = citation_retry_limit

    eval_args = EvalArgs()
    results: list[dict[str, Any]] = []
    for question in questions:
        request_args = build_request_args(question, eval_args)
        started_at = time.perf_counter()
        result = mcp_server._generate_document_answer(request_args, conn)
        duration_seconds = time.perf_counter() - started_at
        results.append(evaluate_result(question, result, duration_seconds))

    return {
        "generated_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "config": {
            "provider": provider or os.environ.get("ANSWER_LLM_PROVIDER", ""),
            "model": model or os.environ.get("ANSWER_LLM_MODEL", ""),
            "mode": mode,
            "limit": limit,
            "max_output_tokens": max_output_tokens,
            "temperature": temperature,
            "citation_retry_limit": citation_retry_limit,
        },
        "summary": build_summary(results),
        "results": results,
    }


def write_eval_outputs(
    *,
    payload: dict[str, Any],
    output_json_path: Path,
    output_md_path: Path,
) -> None:
    output_json_path.parent.mkdir(parents=True, exist_ok=True)
    output_md_path.parent.mkdir(parents=True, exist_ok=True)
    output_json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    output_md_path.write_text(build_markdown_report(payload), encoding="utf-8")


def execute_eval(
    *,
    conn: Any,
    questions_path: Path,
    provider: str | None = None,
    model: str | None = None,
    mode: str = "hybrid",
    limit: int = 2,
    max_output_tokens: int = 240,
    temperature: float = 0.1,
    citation_retry_limit: int | None = None,
    sample: int | None = None,
    output_json_path: Path | None = None,
    output_md_path: Path | None = None,
) -> dict[str, Any]:
    questions = load_questions(questions_path, sample=sample)
    payload = run_eval(
        conn=conn,
        questions=questions,
        provider=provider,
        model=model,
        mode=mode,
        limit=limit,
        max_output_tokens=max_output_tokens,
        temperature=temperature,
        citation_retry_limit=citation_retry_limit,
    )
    payload["config"]["questions_file"] = str(questions_path)
    payload["config"]["sample"] = sample

    if output_json_path and output_md_path:
        write_eval_outputs(
            payload=payload,
            output_json_path=output_json_path,
            output_md_path=output_md_path,
        )
    return payload


def main() -> int:
    args = parse_args()
    load_env_file(Path(args.env_file))

    sys.path.insert(0, str(ROOT_DIR / "scripts"))
    import mcp_server  # pylint: disable=import-error

    questions_path = Path(args.questions)
    output_json_path = Path(args.output_json)
    output_md_path = Path(args.output_md)
    conn = mcp_server.get_db()
    try:
        questions = load_questions(questions_path, sample=args.sample)
        for index, question in enumerate(questions, start=1):
            print(f"[{index}/{len(questions)}] {question['id']}: {question['query']}", file=sys.stderr)
        payload = execute_eval(
            conn=conn,
            questions_path=questions_path,
            provider=args.provider,
            model=args.model,
            mode=args.mode,
            limit=args.limit,
            max_output_tokens=args.max_output_tokens,
            temperature=args.temperature,
            citation_retry_limit=args.citation_retry_limit,
            sample=args.sample,
            output_json_path=output_json_path,
            output_md_path=output_md_path,
        )
    finally:
        conn.close()

    print(json.dumps(payload["summary"], ensure_ascii=False, indent=2))
    print(f"JSON report: {output_json_path}")
    print(f"Markdown report: {output_md_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
