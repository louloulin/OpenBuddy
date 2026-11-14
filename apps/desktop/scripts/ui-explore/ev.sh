#!/bin/bash
# usage: ev.sh 'js code'   (or ev.sh - < file)  -> runs as async fn(ctx,page,app) inside the driver
PORT=${CONTROL_PORT:-47123}
if [ "$1" = "-" ]; then curl -s --max-time ${T:-120} -X POST --data-binary @- http://127.0.0.1:$PORT/; else curl -s --max-time ${T:-120} -X POST --data-binary "$1" http://127.0.0.1:$PORT/; fi
echo
