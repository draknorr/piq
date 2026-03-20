#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${QDRANT_ENV_FILE:-${ROOT_DIR}/apps/admin/.env.local}"

section() {
  printf '\n## %s\n' "$1"
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Missing env file: ${ENV_FILE}" >&2
  exit 1
fi

require_command pnpm
require_command node

QDRANT_DIST_ENTRY="${ROOT_DIR}/packages/qdrant/dist/index.js"

section "Ensuring Qdrant Indexes"
(
  set -a
  # shellcheck disable=SC1090
  . "${ENV_FILE}" >/dev/null 2>&1
  pnpm --filter @publisheriq/qdrant build >/dev/null
  QDRANT_DIST_ENTRY="${QDRANT_DIST_ENTRY}" node --input-type=module <<'NODE'
    import { pathToFileURL } from 'node:url';

    const entry = process.env.QDRANT_DIST_ENTRY;
    if (!entry) {
      throw new Error('QDRANT_DIST_ENTRY is not set');
    }

    const { getCollectionStats, getQdrantClient, initializeCollections } = await import(
      pathToFileURL(entry).href
    );

    const client = getQdrantClient();
    await initializeCollections(client);
    const stats = await getCollectionStats(client);
    console.log(JSON.stringify(stats, null, 2));
NODE
)
