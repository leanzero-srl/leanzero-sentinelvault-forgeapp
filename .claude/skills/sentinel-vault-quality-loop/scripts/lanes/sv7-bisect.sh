#!/bin/zsh
# usage: sv7-bisect.sh "<space-separated scopes to REMOVE from the full manifest>" <label>
S=/private/tmp/claude-501/-Users-mihaiperdum-Projects/65f66400-8299-45c3-a493-c5c5d89b85e6/scratchpad
WT="/Users/mihaiperdum/Projects/Sentinel Vault/.claude/worktrees/sv-7-personal-data"
REMOVE="$1"; LABEL="$2"
cd "$WT" || exit 2
python3 - "$REMOVE" <<'PY'
import sys
s=open("/private/tmp/claude-501/-Users-mihaiperdum-Projects/65f66400-8299-45c3-a493-c5c5d89b85e6/scratchpad/sv7-scopes/manifest.full.yml").read()
for r in sys.argv[1].split():
    line=f"    - {r}\n"; assert s.count(line)==1, r; s=s.replace(line,"")
open("manifest.yml","w").write(s)
PY
echo "[$LABEL] removed: ${REMOVE:-none}"
forge deploy -e development --non-interactive --approve MAJOR_VERSION_RULE 2>&1 | grep -E "Deployed|rror" 
forge install --upgrade --non-interactive -e development --site wolfaenpak.atlassian.net --product Confluence 2>&1 | grep -E "complete|rror|already"
forge install list -e development 2>&1 | grep -E "development.*Confluence" | grep -oE "│ [0-9]+ +│ [A-Za-z -]+│" 
sleep 30
set -a; source ~/Projects/forge-live-harness/.env; set +a; B=${JIRA_BASE_URL%/}; A="$JIRA_ADMIN_EMAIL:$JIRA_API_TOKEN"
T0=$(date -u +%Y-%m-%dT%H:%M:%SZ)
P=$(curl -s -u "$A" -H "Content-Type: application/json" -X POST "$B/wiki/api/v2/pages" -d '{"spaceId":"344162767","status":"current","title":"SV7 bisect '$LABEL' '$(date +%s)'","body":{"representation":"storage","value":"<p>v1</p>"}}' | python3 -c "import json,sys;print(json.load(sys.stdin)['id'])")
sleep 8
curl -s -o /dev/null -w "[$LABEL] page $P PUT %{http_code}\n" -u "$A" -H "Content-Type: application/json" -X PUT "$B/wiki/api/v2/pages/$P" -d '{"id":"'$P'","status":"current","title":"SV7 bisect '$LABEL' edited","body":{"representation":"storage","value":"<p>v2</p>"},"version":{"number":2}}'
got=""
for i in 1 2 3 4 5 6 7 8; do
  sleep 20
  L=$(forge logs -e development --since "$T0" -n 3000 2>/dev/null | grep -E "PAGE-EVENT.*page=$P")
  echo "$L" | grep -q "updated:page" && { got=yes; break; }
done
echo "$L" | cut -c1-160
echo "[$LABEL] RESULT updated-event=${got:-NO} created-event=$(echo "$L" | grep -q created:page && echo yes || echo NO)"
curl -s -o /dev/null -u "$A" -X DELETE "$B/wiki/api/v2/pages/$P"
