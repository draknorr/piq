#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CUBE_DIR="${ROOT_DIR}/packages/cube"
REAL_HOME="${HOME}"
APP_NAME="${FLY_APP:-publisheriq-cube}"
PINNED_FLYCTL_VERSION="${PINNED_FLYCTL_VERSION:-0.4.0}"
PINNED_FLYCTL_DIR="${PINNED_FLYCTL_DIR:-${REAL_HOME}/.cache/publisheriq/flyctl/${PINNED_FLYCTL_VERSION}}"
PINNED_FLYCTL_BIN="${PINNED_FLYCTL_BIN:-${PINNED_FLYCTL_DIR}/bin/flyctl}"
DEPLOY_MODE="${CUBE_DEPLOY_MODE:-remote}"

section() {
  printf '\n## %s\n' "$1"
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
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

ensure_pinned_flyctl() {
  if [[ -x "${PINNED_FLYCTL_BIN}" ]]; then
    return 0
  fi

  require_command curl
  mkdir -p "${PINNED_FLYCTL_DIR}"
  echo "Installing flyctl ${PINNED_FLYCTL_VERSION} to ${PINNED_FLYCTL_DIR}" >&2
  HOME=/tmp FLYCTL_INSTALL="${PINNED_FLYCTL_DIR}" sh -c \
    "$(curl -fsSL https://fly.io/install.sh)" -- "${PINNED_FLYCTL_VERSION}" >/dev/null

  if [[ ! -x "${PINNED_FLYCTL_BIN}" ]]; then
    echo "Failed to install flyctl ${PINNED_FLYCTL_VERSION}" >&2
    exit 1
  fi
}

ACCESS_TOKEN="$(resolve_access_token)"
TMP_FLY_CONFIG_DIR="$(mktemp -d /tmp/fly-cube-deploy.XXXXXX)"

cleanup() {
  rm -rf "${TMP_FLY_CONFIG_DIR}"
}

trap cleanup EXIT

ensure_pinned_flyctl

DEPLOY_ARGS=(
  deploy
  --app "${APP_NAME}"
  --config fly.toml
)

case "${DEPLOY_MODE}" in
  remote)
    DEPLOY_ARGS+=(--remote-only --depot=false)
    ;;
  local)
    DEPLOY_ARGS+=(--local-only)
    ;;
  *)
    echo "Unsupported CUBE_DEPLOY_MODE: ${DEPLOY_MODE}" >&2
    echo "Expected one of: remote, local" >&2
    exit 1
    ;;
esac

if [[ $# -gt 0 ]]; then
  DEPLOY_ARGS+=("$@")
fi

section "Deploy"
echo "App: ${APP_NAME}"
echo "Mode: ${DEPLOY_MODE}"
echo "flyctl: ${PINNED_FLYCTL_BIN}"
HOME=/tmp FLY_CONFIG_DIR="${TMP_FLY_CONFIG_DIR}" FLY_ACCESS_TOKEN="${ACCESS_TOKEN}" \
  "${PINNED_FLYCTL_BIN}" version

(
  cd "${CUBE_DIR}"
  HOME=/tmp FLY_CONFIG_DIR="${TMP_FLY_CONFIG_DIR}" FLY_ACCESS_TOKEN="${ACCESS_TOKEN}" \
    "${PINNED_FLYCTL_BIN}" "${DEPLOY_ARGS[@]}"
)
