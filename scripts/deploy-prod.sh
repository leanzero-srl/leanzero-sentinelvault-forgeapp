#!/usr/bin/env bash
# audit A2: deploy to PRODUCTION with the dev-only harness webtrigger stripped, so the app
# is eligible for the "Runs on Atlassian" program and ships no state-mutation backdoor.
# The dev/development deploys keep manifest.yml as-is (harness needs the webtrigger).
set -euo pipefail
# The repo this script lives in (it moved from "~/Projects/Sentinel Vault"; a hardcoded path
# made the script abort on `cd`).
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

# Usage: ./scripts/deploy-prod.sh --sha <commit being released> [--licensing-live] [--approve-major] [--dry-run]
# The door's own flags are taken out here; anything left goes to `forge deploy`.
APPROVE_MAJOR=0; DRY_RUN=0; NAMED=""; HAVE_SHA=0; REST=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --approve-major) APPROVE_MAJOR=1 ;;
    --dry-run) DRY_RUN=1 ;;
    --sha) if [[ $# -lt 2 || -z "$2" || "$2" == --* ]]; then echo "ABORT: --sha needs the commit being released (a hex sha or a branch name)."; exit 1; fi
           NAMED="$2"; HAVE_SHA=1; shift ;;
    --sha=*) NAMED="${1#--sha=}"; HAVE_SHA=1
             if [[ -z "$NAMED" ]]; then echo "ABORT: --sha needs the commit being released (a hex sha or a branch name)."; exit 1; fi ;;
    *) REST+=("$1") ;;
  esac
  shift
done
set -- "${REST[@]+"${REST[@]}"}"

# THE COMMIT BEING RELEASED (2026-10-22). This door packages the WORKING TREE of the checkout it runs in. Run in a
# checkout whose HEAD is not the commit that was tested (local main could not fast-forward to the tested branch, so it
# still held older code), it deployed the older code with no warning (CogniRunner's door, two dev redeploys). So a real
# run names the commit it releases, and before anything is written, committed, built or deployed: the name resolves to
# one commit, this checkout's HEAD IS that commit (full sha), and the packaged paths are clean, tracked and untracked.
# Right before `forge deploy` the only differences from it may be the files this door commits itself (DOOR_FILES).
# HEAD, @ and anything relative to them are refused: they mean "whatever is checked out", the very thing being checked.
PACKAGED_PATHS=(src manifest.yml package.json package-lock.json webpack.config.js)   # what Forge builds and uploads (static/* is built from src/ui here)
DOOR_FILES=(src/server/shared/release-notes.js docs/RELEASE-NOTES.md scripts/public-tracker/entries.mjs)   # what release-gate.mjs prepare commits
NAMED_SHA=""
resolve_named() {
  local n="$1" ref=""
  if [[ "$n" == *HEAD* || "$n" == @* || "$n" == *@\{* ]]; then
    echo "ABORT: --sha ${n} names whatever is checked out (HEAD, @ or relative to them). Name the commit being released: its sha or its branch."; exit 1
  fi
  if [[ "$n" =~ ^[0-9a-fA-F]{7,40}$ ]]; then ref="$n"
  elif git show-ref --verify -q "refs/heads/$n"; then ref="refs/heads/$n"
  elif git show-ref --verify -q "refs/remotes/$n"; then ref="refs/remotes/$n"
  elif git show-ref --verify -q "refs/tags/$n"; then ref="refs/tags/$n"
  else echo "ABORT: --sha ${n} is neither a hex commit sha nor a branch (or tag) name here."; exit 1
  fi
  NAMED_SHA="$(git rev-parse -q --verify "${ref}^{commit}" 2>/dev/null || true)"
  if [[ -z "$NAMED_SHA" ]]; then echo "ABORT: --sha ${n} does not resolve to a commit in this repository (unknown or ambiguous)."; exit 1; fi
}
pin_check() {
  resolve_named "$NAMED"
  local head; head="$(git rev-parse HEAD)"
  if [[ "$head" != "$NAMED_SHA" ]]; then
    echo "ABORT: this checkout is not the commit being released; the door packages this checkout's files."
    echo "  named (--sha ${NAMED}): ${NAMED_SHA}"
    echo "  this checkout's HEAD:   ${head}"
    if git merge-base --is-ancestor "$head" "$NAMED_SHA"; then
      echo "  This checkout is BEHIND the named commit. Fast-forward it (git merge --ff-only ${NAMED_SHA}) and run again."
    elif git merge-base --is-ancestor "$NAMED_SHA" "$head"; then
      echo "  This checkout is AHEAD of the named commit (it has commits the named one lacks). Run the door in a checkout of the named commit, or name this HEAD if it is what was tested."
    else
      echo "  This checkout and the named commit have DIVERGED. Merge this branch into the named one, test that, then fast-forward this checkout to it and name it."
    fi
    exit 1
  fi
  local dirty; dirty="$(git status --porcelain --untracked-files=all -- "${PACKAGED_PATHS[@]}")"
  if [[ -n "$dirty" ]]; then
    echo "ABORT: the packaged paths (${PACKAGED_PATHS[*]}) are not clean; production ships the named commit only:"
    echo "$dirty" | sed 's/^/  /'
    exit 1
  fi
  echo "==> Releasing ${NAMED_SHA} (--sha ${NAMED}): this checkout's HEAD matches and the packaged paths are clean"
}
# Right before each `forge deploy`: HEAD descends from the named commit and differs from it only in DOOR_FILES; the
# working tree differs from HEAD only by the production manifest swap and the build stamp; nothing untracked is packaged.
pin_recheck() {
  local head bad="" f d line path_
  head="$(git rev-parse HEAD)"
  if ! git merge-base --is-ancestor "$NAMED_SHA" "$head"; then
    echo "ABORT: HEAD moved off the commit being released during this run (named ${NAMED_SHA}, HEAD ${head}); not deployed."; exit 1
  fi
  while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    local ok=0; for d in "${DOOR_FILES[@]}"; do [[ "$f" == "$d" ]] && ok=1; done
    [[ $ok == 1 ]] || bad="${bad}  ${f} (committed after ${NAMED_SHA:0:12}, not by this door)"$'\n'
  done < <(git diff --name-only "$NAMED_SHA" "$head")
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    path_="${line:3}"
    if [[ "${line:0:2}" == " M" && ( "$path_" == "src/build-info.js" || "$path_" == "manifest.yml" ) ]]; then continue; fi
    bad="${bad}  ${path_} (${line:0:2} in the working tree)"$'\n'
  done < <(git status --porcelain --untracked-files=all -- "${PACKAGED_PATHS[@]}")
  if ! cmp -s manifest.yml manifest.prod.yml || ! git show "HEAD:manifest.yml" | cmp -s - manifest.yml.dev.bak; then
    bad="${bad}  manifest.yml (not the production strip of the committed manifest)"$'\n'
  fi
  if [[ -n "$bad" ]]; then
    echo "ABORT: right before forge deploy, what would be packaged differs from the commit being released (${NAMED_SHA}) beyond the door's own files:"
    printf '%s' "$bad"
    echo "Not deployed."
    exit 1
  fi
  echo "==> What Forge packages is ${NAMED_SHA:0:12} plus only this door's own commits (${head:0:12})"
}
if [[ "$HAVE_SHA" == "1" ]]; then pin_check
elif [[ "$DRY_RUN" == "1" ]]; then
  echo "==> Dry run: a real run needs --sha <the commit being released>; this checkout's HEAD is $(git rev-parse HEAD) ($(git rev-parse --abbrev-ref HEAD))"
else
  echo "ABORT: name the commit being released: ./scripts/deploy-prod.sh --sha <sha or branch> [...]"
  echo "  This checkout's HEAD is $(git rev-parse HEAD) ($(git rev-parse --abbrev-ref HEAD)); the door packages this checkout, so it must be the commit that was tested."
  exit 1
fi

# Licensing guard: manifest.yml carries `licensing.enabled: true`. Deploying that to PROD
# before a PAID pricing plan is live in the Partner portal makes every existing install read
# unlicensed -> the nag banner appears for all current customers. Acknowledge explicitly.
# The guard exists for the FIRST deploy that turns licensing on. Once an EARLIER release tag (vX.Y.Z, cut after
# every production deploy) already shipped `licensing.enabled: true`, the paid plan is live and the flag adds
# nothing, so the door accepts the deploy without it. Turning licensing on (the last tag had it off) still needs it.
# --no-contains HEAD: a tag on the commit being deployed (or a later one) proves nothing about what production ran.
licensing_live_in_prod_tag() {
  local tag
  tag="$(git tag --list 'v[0-9]*.[0-9]*.[0-9]*' --no-contains HEAD --sort=-v:refname | head -1)"
  [[ -n "$tag" ]] || return 1
  git show "$tag:manifest.yml" 2>/dev/null | sed -n '/^  licensing:/,/^  [a-z]/p' | grep -qE '^\s*enabled:\s*true' || return 1
  LICENSING_LIVE_TAG="$tag"
}
if grep -qE '^\s*enabled:\s*true' <(sed -n '/^  licensing:/,/^  [a-z]/p' manifest.yml) ; then
  if [[ "${1:-}" == "--licensing-live" ]]; then
    shift
    echo "==> Licensing guard acknowledged (--licensing-live): the paid plan is live in the Partner portal."
  elif licensing_live_in_prod_tag; then
    echo "==> Licensing guard: production already runs with licensing (release ${LICENSING_LIVE_TAG}); no flag needed."
  else
    echo "ABORT: manifest has app.licensing.enabled: true."
    echo "Publish the paid pricing plan in the Partner portal FIRST, then re-run with:"
    echo "  ./scripts/deploy-prod.sh --sha <commit being released> --licensing-live"
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
if [[ "$DRY_RUN" == "1" ]]; then
  echo "==> Dry run: nothing was written, committed, built or deployed"
  exit 0
fi

# Release notes and public tracker, AUTOMATIC (2026-10-20, owner: "the release notes in app need to be done
# automatically"): when the release being cut has no in-app note, the door writes it from the commits since the release
# production carries, and every release-note line with no public tracker row gets one (model-written, model-reviewed,
# withheld by a deterministic net when it touches security, permissions, isolation or keys). Each is committed here, so
# the build below is of a named commit. It never refuses and never asks: a missed line is fine. Details in
# scripts/public-tracker/release-gate.mjs and scripts/release-autopilot.mjs.
echo "==> Release notes and public tracker rows"
PREP_ARGS=(); [[ "$APPROVE_MAJOR" == "1" ]] && PREP_ARGS+=(--approve-major)
node scripts/public-tracker/release-gate.mjs prepare "${PREP_ARGS[@]+"${PREP_ARGS[@]}"}" || echo "==> The release autopilot did not finish; deploying as committed"
if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  git checkout -- "${DOOR_FILES[@]}" 2>/dev/null || true
  echo "==> The release autopilot left uncommitted edits; they were put back"
  if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then echo "ABORT: uncommitted changes to tracked files; production ships committed code only."; exit 1; fi
fi
HEAD_SHA="$(git rev-parse --short HEAD)"
# Every static/ resource the manifest serves is moved aside, so a folder the build does not
# produce is MISSING afterwards instead of silently old (webpack 5 does not rewrite a file whose
# content is unchanged, so timestamps cannot tell fresh from stale).
RESOURCES="$(sed -n 's/^ *path: *\(static\/[^ ]*\).*/\1/p' manifest.yml | grep -v '^static/submission-material' | sort -u)"
ASIDE="$(mktemp -d)"
restore_aside() { for p in $RESOURCES; do [[ ! -e "$p" && -e "$ASIDE/$p" ]] && mkdir -p "$(dirname "$p")" && mv "$ASIDE/$p" "$p"; done; rm -rf "$ASIDE"; }
for p in $RESOURCES; do mkdir -p "$ASIDE/$(dirname "$p")"; mv "$p" "$ASIDE/$p" 2>/dev/null || true; done
echo "==> Building every bundle from HEAD ${HEAD_SHA}"
if ! npm run build; then restore_aside; git checkout -- src/build-info.js 2>/dev/null || true; echo "ABORT: build failed"; exit 1; fi
MISSING=""
for p in $RESOURCES; do [[ -f "$p/index.html" ]] || MISSING="${MISSING} ${p}"; done
if [[ -n "$MISSING" ]] || ! grep -q "\"${HEAD_SHA}\"" src/build-info.js; then
  restore_aside; git checkout -- src/build-info.js 2>/dev/null || true
  echo "ABORT: not built from HEAD ${HEAD_SHA}, or these resource folders were not produced:${MISSING}"
  exit 1
fi
rm -rf "$ASIDE"

echo "==> Generating a webtrigger-free production manifest"
cp manifest.yml manifest.yml.dev.bak
node scripts/strip-dev-modules.mjs manifest.yml manifest.prod.yml

echo "==> Swapping in the production manifest"
cp manifest.prod.yml manifest.yml

cleanup() { cp manifest.yml.dev.bak manifest.yml; rm -f manifest.yml.dev.bak manifest.prod.yml; git checkout -- src/build-info.js 2>/dev/null || true; echo "==> Restored the dev manifest and the build-info placeholder"; }
trap cleanup EXIT

echo "==> forge lint (production manifest)"
# A scope change makes the deploy a MAJOR: lint reports it as an "approval" (0 errors, 0 warnings)
# and exits non-zero. --approve-major (owner-approved release only) accepts exactly that and nothing
# else: any error, warning or a non-MAJOR_VERSION_RULE approval still stops the deploy.
set +e
LINT_OUT="$(forge lint -e production 2>&1)"; LINT_RC=$?   # -e: a non-TTY shell cannot answer the environment prompt
set -e
echo "$LINT_OUT"
if [[ $LINT_RC -ne 0 ]]; then
  if [[ "$APPROVE_MAJOR" == "1" ]] && grep -q "(0 errors, 0 warnings, [0-9]* approval" <<<"$LINT_OUT" \
     && [[ "$(grep -c "approval" <<<"$LINT_OUT")" -ge 1 ]] \
     && ! grep -E "^\s*[0-9]+:[0-9]+\s+approval" <<<"$LINT_OUT" | grep -vq "MAJOR_VERSION_RULE\|major version upgrade"; then
    echo "==> Lint: only the MAJOR_VERSION_RULE approval; accepted by --approve-major"
  else
    echo "ABORT: forge lint failed (rc=$LINT_RC)."; exit 1
  fi
fi

pin_recheck
echo "==> Deploying to production"
if [[ "$APPROVE_MAJOR" == "1" ]]; then forge deploy -e production --approve MAJOR_VERSION_RULE "$@"; else forge deploy -e production "$@"; fi

# Rule zero: a production deploy that loses the Runs on Atlassian badge is a FAILED deploy. The check used to end in
# `|| true`, so an ineligible production version still exited 0 and every caller reported success.
echo "==> Verifying Runs-on-Atlassian eligibility"
set +e
ELIG_OUT="$(forge eligibility -e production 2>&1)"; ELIG_RC=$?   # -e: non-TTY
set -e
echo "$ELIG_OUT"
if [[ $ELIG_RC -ne 0 ]] || ! grep -q "is eligible for the Runs on Atlassian" <<<"$ELIG_OUT" || grep -qi "not eligible" <<<"$ELIG_OUT"; then
  echo "FAILED: production was deployed but is NOT eligible for Runs on Atlassian (forge eligibility rc=${ELIG_RC})."
  echo "The reason is in the output above. Redeploy the last good release tag through this script, then fix the cause."
  exit 1
fi
echo "==> Eligible for Runs on Atlassian"

# The public tracker, automatic: record the release production now carries (the tracker's LAST_VERSION), then apply,
# verify and re-prove the tracker, commit the receipt and push main. A failure there is logged and never fails the
# deploy (the daily digest's tracker check catches the drift the next morning).
node scripts/public-tracker/release-gate.mjs post || echo "==> The public tracker step did not finish; production is deployed and eligible"

# The Marketplace "Try it first" message (owner 2026-10-20): More details is per Marketplace version. Since release-autopilot
# 1.4.0 the workhorse watcher puts it on each newly listed version; this step only kicks it and logs its heartbeat (no wait).
# Logged, never fails the deploy.
DEPLOYED_FORGE="$(grep -oE 'version of your app \[[0-9]+\.[0-9]+\.[0-9]+\]' <<<"$ELIG_OUT" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || true)"
node scripts/public-tracker/release-gate.mjs try-first "${DEPLOYED_FORGE:-}" || echo "==> The Try it first step did not finish; production is deployed and eligible"
