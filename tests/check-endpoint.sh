#!/bin/sh
U=$(sed -n "s/.*\(https:[^']*exec\).*/\1/p" config.js)
curl -sL -m 30 -H "Content-Type: text/plain;charset=utf-8" -d "{not json" "$U" | grep -q bad_request || { echo "endpoint check failed for $U"; exit 1; }
echo "endpoint OK"
