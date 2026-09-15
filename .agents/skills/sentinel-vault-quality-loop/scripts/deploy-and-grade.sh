#!/usr/bin/env bash
# AQL deploy+grade: rebuild frontend, deploy to development, (optionally) upgrade
# the install when manifest scopes/modules changed, then run the full grade.
# Usage: deploy-and-grade.sh [--install]
set -uo pipefail
REPO="/Users/mihaiperdum/Projects/Sentinel Vault"
SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cd "$REPO" || exit 2

echo "=== frontend build (mandatory after UI/CSS changes) ==="
npm run build || exit 1

# Re-stamp src/build-info.js right before deploy so the BACKEND bundle carries the current
# git SHA even if the build step above ever changes (npm prebuild also runs it — belt+braces).
echo "=== gen build-info (deploy staleness stamp) ==="
node scripts/gen-build-info.mjs || exit 1

echo "=== forge deploy -e development ==="
forge deploy -e development || exit 1

if [ "${1:-}" = "--install" ]; then
  echo "=== forge install --upgrade (manifest changed) ==="
  forge install --upgrade --non-interactive -e development || exit 1
fi

exec bash "$SCRIPTS_DIR/grade.sh"
