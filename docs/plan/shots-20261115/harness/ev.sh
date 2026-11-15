#!/bin/bash
# usage: ev.sh 'js code'   (or ev.sh - < file)  -> runs as async fn(ctx,page,app) inside driver
if [ "$1" = "-" ]; then curl -s --max-time ${T:-120} -X POST --data-binary @- http://127.0.0.1:47123/; else curl -s --max-time ${T:-120} -X POST --data-binary "$1" http://127.0.0.1:47123/; fi
echo
