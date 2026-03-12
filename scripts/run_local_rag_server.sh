#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env}"
DEFAULT_PYTHON_BIN="python3"
if [[ -x "$ROOT_DIR/.venv/bin/python" ]]; then
  DEFAULT_PYTHON_BIN="$ROOT_DIR/.venv/bin/python"
fi
PYTHON_BIN="${PYTHON_BIN:-$DEFAULT_PYTHON_BIN}"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

export EMBEDDING_PROVIDER="${EMBEDDING_PROVIDER:-transformers_local}"
export EMBEDDING_MODEL="${EMBEDDING_MODEL:-Qwen/Qwen3-Embedding-0.6B}"
export EMBEDDING_DEVICE="${EMBEDDING_DEVICE:-auto}"
export EMBEDDING_BATCH_SIZE="${EMBEDDING_BATCH_SIZE:-4}"
export ANSWER_LLM_PROVIDER="${ANSWER_LLM_PROVIDER:-ollama}"
export ANSWER_LLM_MODEL="${ANSWER_LLM_MODEL:-qwen2.5:3b}"
export ANSWER_LLM_API_BASE="${ANSWER_LLM_API_BASE:-http://127.0.0.1:11434}"

if [[ -n "${EMBEDDING_MODEL_PATH:-}" && ! -e "${EMBEDDING_MODEL_PATH}" ]]; then
  echo "EMBEDDING_MODEL_PATH not found: ${EMBEDDING_MODEL_PATH}" >&2
  exit 1
fi

if [[ "${ANSWER_LLM_PROVIDER}" == "ollama" ]]; then
  if ! command -v ollama >/dev/null 2>&1; then
    echo "ollama command not found" >&2
    exit 1
  fi
  if ! curl -fsS "${ANSWER_LLM_API_BASE}/api/tags" >/dev/null 2>&1; then
    echo "Ollama API is not reachable at ${ANSWER_LLM_API_BASE}" >&2
    echo "Start Ollama first, or set ANSWER_LLM_PROVIDER=openai_compatible." >&2
    exit 1
  fi
fi

cd "$ROOT_DIR"
exec "$PYTHON_BIN" scripts/mcp_server.py
