#!/usr/bin/env bash
# audit A2: deploy to PRODUCTION with the dev-only harness webtrigger stripped, so the app
# is eligible for the "Runs on Atlassian" program and ships no state-mutation backdoor.
# The dev/development deploys keep manifest.yml as-is (harness needs the webtrigger).
set -euo pipefail
# The repo this script lives in (it moved from "~/Projects/Sentinel Vault"; a hardcoded path
# made the script abort on `cd`).
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

# Licensing guard: manifest.yml carries `licensing.enabled: true`. Deploying that to PROD
# before a PAID pricing plan is live in the Partner portal makes every existing install read
# unlicensed -> the nag banner appears for all current customers. Acknowledge explicitly.
if grep -qE '^\s*enabled:\s*true' <(sed -n '/^  licensing:/,/^  [a-z]/p' manifest.yml) ; then
  if [[ "${1:-}" == "--licensing-live" ]]; then
    shift
    echo "==> Licensing guard acknowledged (--licensing-live): the paid plan is live in the Partner portal."
  else
    echo "ABORT: manifest has app.licensing.enabled: true."
    echo "Publish the paid pricing plan in the Partner portal FIRST, then re-run with:"
    echo "  ./scripts/deploy-prod.sh --licensing-live"
    exit 1
  fi
fi

# Build guard (2026-10-04): static/* is gitignored build output, so a checkout ships whatever was
# last built in it. 6.7.0 went out with 6.6.0's UI bundles because this script never built. Refuse
# a dirty tree, build here, and refuse a bundle whose stamp is not HEAD.
if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  echo "ABORT: uncommitted changes to tracked files; production ships committed code only."
  exit 1
fi
HEAD_SHA="$(git rev-parse --short HEAD)"
BUILD_MARK="$(mktemp)"
echo "==> Building every bundle from HEAD ${HEAD_SHA}"
npm run build
if ! grep -q "\"${HEAD_SHA}\"" src/build-info.js; then
  echo "ABORT: src/build-info.js is not stamped with HEAD ${HEAD_SHA}."
  exit 1
fi
STALE=""
while read -r p; do
  [[ "$p" == static/submission-material* ]] && continue
  newest="$(find "$p" -type f -newer "$BUILD_MARK" 2>/dev/null | head -1)"
  [[ -z "$newest" ]] && STALE="${STALE} ${p}"
done < <(sed -n 's/^ *path: *\(static\/[^ ]*\).*/\1/p' manifest.yml | sort -u)
if [[ -n "$STALE" ]]; then
  echo "ABORT: these resource folders were not rebuilt:${STALE}"
  exit 1
fi
rm -f "$BUILD_MARK"

echo "==> Generating a webtrigger-free production manifest"
cp manifest.yml manifest.yml.dev.bak
node scripts/strip-dev-modules.mjs manifest.yml manifest.prod.yml

echo "==> Swapping in the production manifest"
cp manifest.prod.yml manifest.yml

cleanup() { cp manifest.yml.dev.bak manifest.yml; rm -f manifest.yml.dev.bak manifest.prod.yml; git checkout -- src/build-info.js 2>/dev/null || true; echo "==> Restored the dev manifest and the build-info placeholder"; }
trap cleanup EXIT

echo "==> forge lint (production manifest)"
forge lint -e production   # -e: a non-TTY shell cannot answer the environment prompt

echo "==> Deploying to production"
forge deploy -e production "$@"

echo "==> Verifying Runs-on-Atlassian eligibility"
forge eligibility -e production || true   # -e: non-TTY
