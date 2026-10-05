#!/bin/zsh
# Every ~5 min: create + update a page in SVPLAIN, record how long the updated:page event takes to
# reach the trigger ([PAGE-EVENT] first-line log). Writes sv7-latency.tsv. Stops when STOP file exists.
S=/private/tmp/claude-501/-Users-mihaiperdum-Projects/65f66400-8299-45c3-a493-c5c5d89b85e6/scratchpad
WT="/Users/mihaiperdum/Projects/Sentinel Vault/.claude/worktrees/sv-7-personal-data"
set -a; source ~/Projects/forge-live-harness/.env; set +a; B=${JIRA_BASE_URL%/}; A="$JIRA_ADMIN_EMAIL:$JIRA_API_TOKEN"
cd "$WT"
echo -e "put_utc\tpage\tupdated_event_delay_s" > $S/sv7-latency.tsv
while [ ! -f $S/sv7-latency.STOP ]; do
  P=$(curl -s -u "$A" -H "Content-Type: application/json" -X POST "$B/wiki/api/v2/pages" -d '{"spaceId":"344162767","status":"current","title":"SV7 latency '$(date +%s)'","body":{"representation":"storage","value":"<p>v1</p>"}}' | python3 -c "import json,sys;print(json.load(sys.stdin)['id'])")
  sleep 5
  T=$(date -u +%Y-%m-%dT%H:%M:%SZ); TS=$(date +%s)
  curl -s -o /dev/null -u "$A" -H "Content-Type: application/json" -X PUT "$B/wiki/api/v2/pages/$P" -d '{"id":"'$P'","status":"current","title":"SV7 latency edited","body":{"representation":"storage","value":"<p>v2</p>"},"version":{"number":2}}'
  d=""
  for i in $(seq 1 40); do
    sleep 15
    L=$(forge logs -e development --since "$T" -n 3000 2>/dev/null | grep -E "PAGE-EVENT.*updated:page page=$P " | head -1)
    if [ -n "$L" ]; then ev=$(echo "$L" | awk '{print $2}'); d=$(python3 -c "from datetime import datetime;print(round(datetime.fromisoformat('$ev'.replace('Z','+00:00')).timestamp()-$TS))"); break; fi
  done
  echo -e "$T\t$P\t${d:->600}" >> $S/sv7-latency.tsv
  curl -s -o /dev/null -u "$A" -X DELETE "$B/wiki/api/v2/pages/$P"
  sleep 240
done
