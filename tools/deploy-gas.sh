#!/bin/bash
# Deploys gas/Code.gs to the LUMA leads Apps Script and points the existing web-app deployment at it
# (same URL, config.js unchanged). Run: bash tools/deploy-gas.sh   (from anywhere)
set -euo pipefail
cd "$(dirname "$0")/.."
SID=1AvIjpXE9CdzwgY8MhaiHamiv1ufLrYkjAzFleD_s_R4fUiz_5FL9wsfn
DEP=AKfycbwEHvcs4hvE2qfsQtm83u28nHxZN04uB-J5DCIApLQWT0GM4hq2EPeqfyYy1g6d9ybl
TMP=$(mktemp -d)
gws script projects getContent --params "{\"scriptId\":\"$SID\"}" > "$TMP/remote.json" 2>/dev/null
python3 - "$TMP/remote.json" > "$TMP/new.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
files = []
for f in d['files']:
    src = open('gas/Code.gs').read() if f['name'] == 'Code' else f['source']
    files.append({'name': f['name'], 'type': f['type'], 'source': src})
print(json.dumps({'files': files}))
PY
gws script projects updateContent --params "{\"scriptId\":\"$SID\"}" --json "$(cat "$TMP/new.json")" >/dev/null 2>&1
VER=$(gws script projects versions create --params "{\"scriptId\":\"$SID\"}" \
  --json '{"description":"Privacy: consent column, 24-month retention, validation, rate limit"}' 2>/dev/null \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["versionNumber"])')
gws script projects deployments update --params "{\"scriptId\":\"$SID\",\"deploymentId\":\"$DEP\"}" \
  --json "{\"deploymentConfig\":{\"versionNumber\":$VER,\"manifestFileName\":\"appsscript\",\"description\":\"v$VER privacy update\"}}" >/dev/null 2>&1
echo "Deployed version $VER to the existing web app (same URL)."
rm -rf "$TMP"
