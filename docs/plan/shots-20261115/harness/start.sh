#!/bin/bash
# Starts the driver under xvfb; records pid in run.pid. Usage: start.sh  (env FRESH=0 keeps profile)
S=$(dirname "$(readlink -f "$0")")
cd "$S"
setsid xvfb-run -a -s "-screen 0 1920x1200x24" node driver.mjs > "$S/driver.log" 2>&1 < /dev/null &
echo $! > "$S/run.pid"
