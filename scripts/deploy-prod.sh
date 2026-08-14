#!/usr/bin/env bash
# audit A2: deploy to PRODUCTION with the dev-only harness webtrigger stripped, so the app
# is eligible for the "Runs on Atlassian" program and ships no state-mutation backdoor.
# The dev/development deploys keep manifest.yml as-is (harness needs the webtrigger).
set -euo pipefail
REPO="/Users/mihaiperdum/Projects/Sentinel Vault"
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
