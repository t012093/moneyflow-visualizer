#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_NAME="${SERVER_NAME:-money-flow}"
START_SCRIPT="$ROOT_DIR/scripts/run_local_rag_server.sh"

if ! command -v codex >/dev/null 2>&1; then
  echo "codex command not found" >&2
  exit 1
fi

if [[ ! -x "$START_SCRIPT" ]]; then
  echo "start script is missing or not executable: $START_SCRIPT" >&2
  exit 1
fi

if codex mcp get "$SERVER_NAME" >/dev/null 2>&1; then
  codex mcp remove "$SERVER_NAME"
fi

codex mcp add "$SERVER_NAME" -- bash "$START_SCRIPT"
codex mcp get "$SERVER_NAME"
