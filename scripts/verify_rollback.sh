#!/usr/bin/env bash
# Verify that an operator-executed rollback reached the requested release.
# This script never claims a rollback occurred; it checks the resulting target.
set -euo pipefail

BASE_URL="${BASE_URL:?BASE_URL is required after rollback}"
EXPECTED_VERSION="${EXPECTED_VERSION:?EXPECTED_VERSION is required after rollback}"
COOKIE_ARGS=()
if [[ -n "${COOKIE_FILE:-}" ]]; then
  [[ -r "${COOKIE_FILE}" ]] || { echo "COOKIE_FILE is not readable" >&2; exit 1; }
  COOKIE_ARGS=(--cookie "${COOKIE_FILE}")
fi

health="$(curl --fail --silent --show-error --location "${BASE_URL%/}/health" "${COOKIE_ARGS[@]}")"
grep -Fq "${EXPECTED_VERSION}" <<<"${health}" || {
  echo "rollback target version was not observed" >&2
  exit 1
}
grep -q '"status"[[:space:]]*:[[:space:]]*"healthy"' <<<"${health}"
echo "Rollback target is healthy and reports ${EXPECTED_VERSION}."
