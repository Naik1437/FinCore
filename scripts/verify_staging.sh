#!/usr/bin/env bash
# Validate a real deployed FinCore environment. Missing inputs fail closed.
set -euo pipefail

BASE_URL="${BASE_URL:?BASE_URL is required, for example https://staging.example}"
EXPECTED_VERSION="${EXPECTED_VERSION:-}"
COOKIE_ARGS=()
if [[ -n "${COOKIE_FILE:-}" ]]; then
  [[ -r "${COOKIE_FILE}" ]] || { echo "COOKIE_FILE is not readable" >&2; exit 1; }
  COOKIE_ARGS=(--cookie "${COOKIE_FILE}")
fi

live="$(curl --fail --silent --show-error --location "${BASE_URL%/}/health/live")"
grep -q '"status"[[:space:]]*:[[:space:]]*"alive"' <<<"${live}"
ready="$(curl --fail --silent --show-error --location "${BASE_URL%/}/health/ready" "${COOKIE_ARGS[@]}")"
grep -q '"status"[[:space:]]*:[[:space:]]*"ready"' <<<"${ready}"

if [[ -n "${EXPECTED_VERSION}" ]]; then
  health="$(curl --fail --silent --show-error --location "${BASE_URL%/}/health" "${COOKIE_ARGS[@]}")"
  grep -Fq "${EXPECTED_VERSION}" <<<"${health}" || {
    echo "deployed version does not match EXPECTED_VERSION" >&2
    exit 1
  }
fi
echo "Real staging health and readiness validation passed."
