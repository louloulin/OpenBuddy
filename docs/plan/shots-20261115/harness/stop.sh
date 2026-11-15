#!/bin/bash
S=$(dirname "$(readlink -f "$0")")
curl -s --max-time 20 -X POST --data-binary 'await app?.close().catch(()=>{}); setTimeout(()=>process.exit(0),200); return "bye"' http://127.0.0.1:47123/ ; echo
sleep 2
pid=$(cat "$S/run.pid" 2>/dev/null); [ -n "$pid" ] && kill -- -"$pid" 2>/dev/null
true
