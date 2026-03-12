#!/usr/bin/env python3
"""
Index local embeddings for existing crawl documents.

Usage:
  python scripts/index_local_embeddings.py
  python scripts/index_local_embeddings.py --document-id 7 --force
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
    parser = argparse.ArgumentParser(description="Generate chunk embeddings for crawl documents")
    parser.add_argument("--document-id", type=int, help="Target crawl_documents.id")
    parser.add_argument("--limit", type=int, default=20, help="Max documents when document-id is omitted")
    parser.add_argument("--force", action="store_true", help="Rebuild embeddings even if they already exist")
    args = parser.parse_args()

    conn = mcp_server.get_db()
    try:
        result = mcp_server._index_document_embeddings(
            {
                "document_id": args.document_id,
                "limit": args.limit,
                "force": args.force,
            },
            conn,
        )
        print(json.dumps(result, ensure_ascii=False, indent=2))
    finally:
        conn.close()


if __name__ == "__main__":
    main()
