#!/usr/bin/env bash
# Create a reproducible, non-secret release evidence manifest.
set -euo pipefail

OUT="${1:-release-manifest.txt}"
SHA="$(git rev-parse HEAD)"
TAG="$(git describe --tags --exact-match HEAD 2>/dev/null || echo untagged)"
{
  echo "commit=${SHA}"
  echo "tag=${TAG}"
  echo "created_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  for file in docker-compose.yml docker/nginx.conf docs/openapi.json docs/postman_collection.json; do
    sha256sum "${file}"
  done
} > "${OUT}"
echo "Release manifest written to ${OUT}."
