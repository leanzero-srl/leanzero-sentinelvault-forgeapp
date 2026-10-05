#!/bin/zsh
cd "/Users/mihaiperdum/Projects/Sentinel Vault/.claude/worktrees/sv-7-personal-data"
set -a; source ~/Projects/forge-live-harness/.env; set +a; B=${JIRA_BASE_URL%/}; A="$JIRA_ADMIN_EMAIL:$JIRA_API_TOKEN"
T0=$(date -u +%Y-%m-%dT%H:%M:%SZ)
P=$(curl -s -u "$A" -H "Content-Type: application/json" -X POST "$B/wiki/api/v2/pages" -d '{"spaceId":"344162767","status":"current","title":"SV7 bisect 'evprobe' '$(date +%s)'","body":{"representation":"storage","value":"<p>v1</p>"}}' | python3 -c "import json,sys;print(json.load(sys.stdin)['id'])")
sleep 8
curl -s -o /dev/null -w "[evprobe] page $P PUT %{http_code}\n" -u "$A" -H "Content-Type: application/json" -X PUT "$B/wiki/api/v2/pages/$P" -d '{"id":"'$P'","status":"current","title":"SV7 bisect 'evprobe' edited","body":{"representation":"storage","value":"<p>v2</p>"},"version":{"number":2}}'
got=""
for i in 1 2 3 4 5 6 7 8; do
  sleep 20
  L=$(forge logs -e development --since "$T0" -n 3000 2>/dev/null | grep -E "PAGE-EVENT.*page=$P")
  echo "$L" | grep -q "updated:page" && { got=yes; break; }
done
echo "$L" | cut -c1-160
echo "[evprobe] RESULT updated-event=${got:-NO} created-event=$(echo "$L" | grep -q created:page && echo yes || echo NO)"
curl -s -o /dev/null -u "$A" -X DELETE "$B/wiki/api/v2/pages/$P"
