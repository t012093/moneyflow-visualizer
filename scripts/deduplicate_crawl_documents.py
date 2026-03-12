#!/usr/bin/env python3
"""
Remove duplicate crawl documents that share the same source_url and content_hash.

Usage:
  python scripts/deduplicate_crawl_documents.py --dry-run
  python scripts/deduplicate_crawl_documents.py --apply
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys

SCRIPT_DIR = pathlib.Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import mcp_server


def main() -> None:
    parser = argparse.ArgumentParser(description="Deduplicate crawl_documents by source_url + content_hash")
    parser.add_argument("--apply", action="store_true", help="Delete older duplicates instead of only reporting")
    parser.add_argument("--source-url", help="Limit deduplication to a specific source_url")
    args = parser.parse_args()

    conn = mcp_server.get_db()
    try:
        conditions = ["content_hash IS NOT NULL", "content_hash != ''"]
        params: list[object] = []
        if args.source_url:
            conditions.append("source_url = ?")
            params.append(args.source_url)

        rows = conn.execute(
            f"""
            SELECT source_url, content_hash, COUNT(*) AS duplicate_count, MAX(id) AS keep_document_id
            FROM crawl_documents
            WHERE {' AND '.join(conditions)}
            GROUP BY source_url, content_hash
            HAVING COUNT(*) > 1
            ORDER BY duplicate_count DESC, source_url
            """,
            params,
        ).fetchall()

        summary: list[dict[str, object]] = []
        deleted_documents = 0
        deleted_chunks = 0
        deleted_embeddings = 0

        for row in rows:
            duplicate_ids = [
                item["id"]
                for item in conn.execute(
                    """
                    SELECT id
                    FROM crawl_documents
                    WHERE source_url = ? AND content_hash = ? AND id != ?
                    ORDER BY id
                    """,
                    (row["source_url"], row["content_hash"], row["keep_document_id"]),
                ).fetchall()
            ]
            chunk_count = conn.execute(
                f"""
                SELECT COUNT(*)
                FROM document_chunks
                WHERE document_id IN ({','.join('?' for _ in duplicate_ids)})
                """,
                duplicate_ids,
            ).fetchone()[0] if duplicate_ids else 0
            embedding_count = conn.execute(
                f"""
                SELECT COUNT(*)
                FROM chunk_embeddings
                WHERE chunk_id IN (
                    SELECT id
                    FROM document_chunks
                    WHERE document_id IN ({','.join('?' for _ in duplicate_ids)})
                )
                """,
                duplicate_ids,
            ).fetchone()[0] if duplicate_ids else 0

            summary.append(
                {
                    "source_url": row["source_url"],
                    "content_hash": row["content_hash"],
                    "keep_document_id": row["keep_document_id"],
                    "delete_document_ids": duplicate_ids,
                    "delete_chunk_count": chunk_count,
                    "delete_embedding_count": embedding_count,
                }
            )

            if args.apply and duplicate_ids:
                conn.execute(
                    f"DELETE FROM crawl_documents WHERE id IN ({','.join('?' for _ in duplicate_ids)})",
                    duplicate_ids,
                )
                deleted_documents += len(duplicate_ids)
                deleted_chunks += chunk_count
                deleted_embeddings += embedding_count

        if args.apply:
            conn.commit()

        print(
            json.dumps(
                {
                    "mode": "apply" if args.apply else "dry_run",
                    "duplicate_groups": len(summary),
                    "deleted_documents": deleted_documents,
                    "deleted_chunks": deleted_chunks,
                    "deleted_embeddings": deleted_embeddings,
                    "groups": summary,
                },
                ensure_ascii=False,
                indent=2,
            )
        )
    finally:
        conn.close()


if __name__ == "__main__":
    main()
