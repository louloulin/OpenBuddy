#!/bin/bash
# Real-Electron UI driver under xvfb with a local fixture model (no real keys).
# Env: SHOTS_DIR (screenshot output), RUN_DIR (throwaway profile), FRESH=0 keeps the profile,
#      CONTROL_PORT / FIXTURE_PORT. Logs and pid go to $RUN_DIR (default: OS temp dir).
S=$(dirname "$(readlink -f "$0")")
RUN_DIR=${RUN_DIR:-${TMPDIR:-/tmp}/openbuddy-ui-explore}
mkdir -p "$RUN_DIR"
export RUN_DIR
cd "$S"
setsid xvfb-run -a -s "-screen 0 1920x1200x24" node driver.mjs > "$RUN_DIR/driver.log" 2>&1 < /dev/null &
echo $! > "$RUN_DIR/driver.pid"
echo "driver log: $RUN_DIR/driver.log"
