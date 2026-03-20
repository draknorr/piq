#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REAL_HOME="${HOME}"
APP_NAME="${FLY_APP:-publisheriq-cube}"
BUILDER_APP_NAME="${FLY_BUILDER_APP:-fly-builder-shy-breeze-2800}"
FLYCTL_BIN="${FLYCTL_BIN:-flyctl}"
ALT_FLYCTL_BIN="${ALT_FLYCTL_BIN:-}"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

section() {
  printf '\n## %s\n' "$1"
}

resolve_access_token() {
  if [[ -n "${FLY_ACCESS_TOKEN:-}" ]]; then
    printf '%s\n' "${FLY_ACCESS_TOKEN}"
    return 0
  fi

  local config_file="${REAL_HOME}/.fly/config.yml"
  if [[ -f "${config_file}" ]]; then
    local token
    token="$(sed -n 's/^access_token: //p' "${config_file}" | head -n 1)"
    if [[ -n "${token}" ]]; then
      printf '%s\n' "${token}"
      return 0
    fi
  fi

  echo "FLY_ACCESS_TOKEN is not set and ~/.fly/config.yml has no access_token" >&2
  exit 1
}

ACCESS_TOKEN="$(resolve_access_token)"
TMP_FLY_CONFIG_DIR="$(mktemp -d /tmp/fly-cube-check.XXXXXX)"
ALT_TMP_FLY_CONFIG_DIR="$(mktemp -d /tmp/fly-cube-check-alt.XXXXXX)"

cleanup() {
  rm -rf "${TMP_FLY_CONFIG_DIR}" "${ALT_TMP_FLY_CONFIG_DIR}"
}

trap cleanup EXIT

run_fly() {
  HOME=/tmp FLY_CONFIG_DIR="${TMP_FLY_CONFIG_DIR}" FLY_ACCESS_TOKEN="${ACCESS_TOKEN}" "${FLYCTL_BIN}" "$@"
}

run_alt_fly() {
  HOME=/tmp FLY_CONFIG_DIR="${ALT_TMP_FLY_CONFIG_DIR}" FLY_ACCESS_TOKEN="${ACCESS_TOKEN}" "${ALT_FLYCTL_BIN}" "$@"
}

require_command "${FLYCTL_BIN}"
require_command pnpm

section "CLI"
run_fly version
if [[ -n "${ALT_FLYCTL_BIN}" ]]; then
  run_alt_fly version
fi

section "App Status"
run_fly status --app "${APP_NAME}"

section "Machine List"
run_fly machine list --app "${APP_NAME}"

section "Health Checks"
run_fly checks list --app "${APP_NAME}"

section "Builder Logs Tail"
run_fly logs --app "${BUILDER_APP_NAME}" --no-tail | tail -n 80

section "Cube Meta Field Presence"
(
  set -a
  # shellcheck disable=SC1091
  . "${ROOT_DIR}/apps/admin/.env.local" >/dev/null 2>&1
  pnpm --filter @publisheriq/admin exec node - <<'NODE'
const jwt = require('jsonwebtoken');

async function main() {
  const base = (process.env.CUBE_API_URL || '').replace(/\/$/, '');
  if (!base) {
    throw new Error('CUBE_API_URL is missing from apps/admin/.env.local');
  }

  const secret = process.env.CUBE_API_SECRET;
  if (!secret) {
    throw new Error('CUBE_API_SECRET is missing from apps/admin/.env.local');
  }

  const url = base.includes('/cubejs-api/v1') ? `${base}/meta` : `${base}/cubejs-api/v1/meta`;
  const token = jwt.sign({}, secret, { expiresIn: '5m' });
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    throw new Error(`meta ${response.status}: ${await response.text()}`);
  }

  const meta = await response.json();
  const requiredFields = [
    'DeveloperGameMetrics.reviewPercentage',
    'DeveloperGameMetrics.positiveReviews',
    'PublisherGameMetrics.reviewPercentage',
    'PublisherGameMetrics.positiveReviews',
  ];

  for (const fieldName of requiredFields) {
    const [cubeName] = fieldName.split('.');
    const cube = meta.cubes.find((entry) => entry.name === cubeName);
    const dimensions = (cube?.dimensions || []).map((entry) => entry.name);
    console.log(
      JSON.stringify({
        field: fieldName,
        present: dimensions.includes(fieldName),
      })
    );
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
NODE
)
