#!/bin/bash
RUN_DIR=${RUN_DIR:-${TMPDIR:-/tmp}/openbuddy-ui-explore}
PORT=${CONTROL_PORT:-47123}
curl -s --max-time 20 -X POST --data-binary 'await app?.close().catch(()=>{}); setTimeout(()=>process.exit(0),200); return "bye"' http://127.0.0.1:$PORT/ ; echo
sleep 2
pid=$(cat "$RUN_DIR/driver.pid" 2>/dev/null); [ -n "$pid" ] && kill -- -"$pid" 2>/dev/null
true
