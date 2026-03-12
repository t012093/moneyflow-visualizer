#!/usr/bin/env bash
set -euo pipefail

# Only needed when EMBEDDING_PROVIDER=tei_local.

MODEL_ID="${EMBEDDING_MODEL:-Qwen/Qwen3-Embedding-0.6B}"
HOSTNAME="${EMBEDDING_HOSTNAME:-127.0.0.1}"
PORT="${EMBEDDING_PORT:-8080}"
MAX_CLIENT_BATCH_SIZE="${MAX_CLIENT_BATCH_SIZE:-32}"
MAX_BATCH_TOKENS="${MAX_BATCH_TOKENS:-16384}"

cmd=(
  text-embeddings-router
  --model-id "${MODEL_ID}"
  --hostname "${HOSTNAME}"
  --port "${PORT}"
  --max-client-batch-size "${MAX_CLIENT_BATCH_SIZE}"
  --max-batch-tokens "${MAX_BATCH_TOKENS}"
)

if [[ -n "${HUGGINGFACE_HUB_CACHE:-}" ]]; then
  cmd+=(--huggingface-hub-cache "${HUGGINGFACE_HUB_CACHE}")
fi

if [[ -n "${HF_TOKEN:-}" ]]; then
  cmd+=(--hf-token "${HF_TOKEN}")
fi

exec "${cmd[@]}"
