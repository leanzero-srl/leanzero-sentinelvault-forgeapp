#!/usr/bin/env bash
# audit A2: deploy to PRODUCTION with the dev-only harness webtrigger stripped, so the app
# is eligible for the "Runs on Atlassian" program and ships no state-mutation backdoor.
# The dev/development deploys keep manifest.yml as-is (harness needs the webtrigger).
set -euo pipefail
REPO="/Users/mihaiperdum/Projects/Sentinel Vault"
cd "$REPO"

echo "==> Generating a webtrigger-free production manifest"
cp manifest.yml manifest.yml.dev.bak
node scripts/strip-dev-modules.mjs manifest.yml manifest.prod.yml

echo "==> Swapping in the production manifest"
cp manifest.prod.yml manifest.yml

cleanup() { cp manifest.yml.dev.bak manifest.yml; rm -f manifest.yml.dev.bak manifest.prod.yml; echo "==> Restored the dev manifest"; }
trap cleanup EXIT

echo "==> forge lint (production manifest)"
forge lint

echo "==> Deploying to production"
forge deploy -e production "$@"

echo "==> Verifying Runs-on-Atlassian eligibility"
forge eligibility || true
