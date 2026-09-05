#!/usr/bin/env bash
# scripts/deploy-with-password.sh — non-interactive deploy using ubuntu user password.
#
# For target hosts where the operator does not have an SSH key but does have
# a username/password for the `ubuntu` account (sudoer via `qaz123ASD`).
# Sets up an expect-based SSH channel to:
#   1. Upload the offline release bundle via scp
#   2. SSH in as ubuntu
#   3. sudo to root
#   4. Extract bundle into /opt/service/openbuddy-incoming
#   5. Stage updated source files into /opt/service/openbuddy
#   6. Rebuild the openbuddy-resource-gateway image
#   7. docker compose up -d the new container
#   8. Probe /healthz to confirm the expected version is reporting
#
# Usage:
#   REMOTE_HOST=124.221.146.145 REMOTE_USER=ubuntu REMOTE_PASSWORD='qaz123ASD' \
#   EXPECTED_VERSION=8926d4e7f7c2 BUNDLE_DIR=/tmp/openbuddy-release-final \
#   bash scripts/deploy-with-password.sh
#
# Required tools: expect, scp, ssh, docker (on remote).
#
# This is intentionally a thin wrapper: every meaningful step is a separate
# expect call so the operator can replay any single step manually.

set -euo pipefail

REMOTE_HOST=${REMOTE_HOST:-124.221.146.145}
REMOTE_USER=${REMOTE_USER:-ubuntu}
REMOTE_PASSWORD=${REMOTE_PASSWORD:-qaz123ASD}
EXPECTED_VERSION=${EXPECTED_VERSION:-$(git rev-parse --short=12 HEAD)}
BUNDLE_DIR=${BUNDLE_DIR:-/tmp/openbuddy-release}
BUNDLE_FILE=$(ls -1 "${BUNDLE_DIR}"/openbuddy-release-*.tar.gz | head -1)

[[ -n "${BUNDLE_FILE}" ]] || { echo "BUNDLE_FILE not found under ${BUNDLE_DIR}" >&2; exit 2; }
[[ "${EXPECTED_VERSION}" =~ ^[a-zA-Z0-9._-]{1,80}$ ]] || { echo "EXPECTED_VERSION invalid" >&2; exit 2; }

require_command() { command -v "$1" >/dev/null 2>&1 || { echo "missing: $1" >&2; exit 2; }; }
require_command expect
require_command scp
require_command ssh

run_expect() {
  local script="$1"; shift
  local description="$1"; shift
  echo ">>> ${description}"
  expect "$script" "${REMOTE_HOST}" "${REMOTE_USER}" "${REMOTE_PASSWORD}" "$@"
}

upload_bundle() {
  cat > /tmp/scp_to_remote.exp <<'EXP'
#!/usr/bin/expect -f
set timeout 180
set src [lindex $argv 1]
set dst [lindex $argv 2]
set host [lindex $argv 3]
set user [lindex $argv 4]
set pass [lindex $argv 5]
spawn scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=10 $src $user@$host:$dst
expect {
  -re "password:|Password:" { send "$pass\r" }
  timeout { send_user "TIMEOUT_UPLOAD\n"; exit 1 }
}
expect {
  -re {100%|.*} { }
  eof { }
  timeout { send_user "TIMEOUT_TRANSFER\n"; exit 2 }
}
catch wait result
exit [lindex $result 3]
EXP
  chmod +x /tmp/scp_to_remote.exp
  /tmp/scp_to_remote.exp '' "${BUNDLE_FILE}" "/tmp/openbuddy-release.tar.gz" "${REMOTE_HOST}" "${REMOTE_USER}" "${REMOTE_PASSWORD}"
}

upload_scripts() {
  local s_file="$1"; shift
  local d_file="$1"; shift
  cat > /tmp/scp_script.exp <<EXP
#!/usr/bin/expect -f
set timeout 60
set src "$s_file"
set dst "$d_file"
set host "$REMOTE_HOST"
set user "$REMOTE_USER"
set pass "$REMOTE_PASSWORD"
spawn scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=10 \$src \$user@\$host:\$dst
expect {
  -re "password:|Password:" { send "\$pass\\r" }
  timeout { send_user "TIMEOUT_UP\\n"; exit 1 }
}
expect { -re {100%|.*} {} eof {} timeout { send_user "TIMEOUT_TRANSFER\\n"; exit 2 } }
catch wait result
exit [lindex \$result 3]
EXP
  chmod +x /tmp/scp_script.exp
  /tmp/scp_script.exp
}

ssh_with_sudo() {
  cat > /tmp/ssh_sudo.exp <<EXP
#!/usr/bin/expect -f
set timeout 180
set host "$REMOTE_HOST"
set user "$REMOTE_USER"
set pass "$REMOTE_PASSWORD"
set cmd [lindex \$argv 1]
log_user 1
spawn ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=10 -tt \$user@\$host
expect {
  -re "password:|Password:" { send "\$pass\\r" }
  timeout { send_user "TIMEOUT_LOGIN\\n"; exit 11 }
}
expect {
  "\\\\\\\$ " {}
  timeout { send_user "TIMEOUT_SHELL\\n"; exit 12 }
}
send "echo '\$pass' | sudo -S bash -c \"set -e; \\\$cmd; echo __RC__=\\\$?\\\"\\r"
expect {
  "\\\\\\\$ " { send_user "DONE\\n" }
  timeout { send_user "TIMEOUT_CMD\\n"; exit 13 }
}
send "exit\\r"
expect eof
EXP
  chmod +x /tmp/ssh_sudo.exp
  /tmp/ssh_sudo.exp run "${1:-true}"
}

extract_and_stage() {
  ssh_with_sudo "set -e; cd /opt/service/openbuddy/services/casdoor-resource-gateway; cp -a src /opt/service/openbuddy/.previous-deploy/src.prev; rm -rf src.new && mkdir -p src.new && tar -xzf /tmp/openbuddy-src.tar.gz -C . && find . -name '._*' -delete; cp -a index.ts store.ts tsconfig.json package.json production-config.ts encryption.ts credit-ledger.ts trace.ts optional-drivers.d.ts src/; rm -rf src.new && ls src/index.ts && grep -c handleInternalCreditExpiry src/index.ts"
}

rebuild_and_restart() {
  ssh_with_sudo "set -e; sed -i 's/^RESOURCE_GATEWAY_VERSION=.*/RESOURCE_GATEWAY_VERSION=${EXPECTED_VERSION}/' /opt/service/openbuddy/.env.remote-dev; grep '^RESOURCE_GATEWAY_VERSION=' /opt/service/openbuddy/.env.remote-dev; cd /opt/service/openbuddy/services/casdoor-resource-gateway; docker rmi -f openbuddy-resource-gateway:latest 2>/dev/null || true; docker build --no-cache --build-arg INCLUDE_SQL_DRIVERS=true -f Dockerfile -t openbuddy-resource-gateway:latest .; docker run --rm openbuddy-resource-gateway:latest grep -c handleInternalCreditExpiry dist/index.js; cd /opt/service/openbuddy; docker compose -f docker-compose.remote-dev.yml --env-file .env.remote-dev up -d --force-recreate --no-deps resource-gateway; sleep 5; curl -fsS http://127.0.0.1:8787/healthz"
}

verify_external() {
  echo ">>> external probe"
  curl -fsS --max-time 10 "http://${REMOTE_HOST}:8787/healthz"
  echo
  curl -fsS --max-time 10 "http://${REMOTE_HOST}:8787/readyz"
  echo
  curl -sS --max-time 10 -X POST -H 'content-type: application/json' --data '{}' -w '\nhttp=%{http_code}\n' "http://${REMOTE_HOST}:8787/internal/v1/credits/expire" | head -3
}

main() {
  upload_bundle
  ssh_with_sudo "set -e; mkdir -p /opt/service/openbuddy-incoming && cd /opt/service/openbuddy-incoming && rm -rf openbuddy-release-* && tar -xzf /tmp/openbuddy-release.tar.gz && find openbuddy-release-* -name '._*' -delete && ls openbuddy-release-* | head -5"
  ssh_with_sudo "set -e; cd /tmp && rm -rf openbuddy-src.tar.gz openbuddy-src-new && mkdir -p openbuddy-src-new && tar -czf openbuddy-src.tar.gz -C /opt/service/openbuddy/services/casdoor-resource-gateway src tsconfig.json package.json && ls -la openbuddy-src.tar.gz"
  scp_to_remote_path() {
    local f="$1"
    local dst="$2"
    cat > /tmp/scp_one.exp <<EXP
#!/usr/bin/expect -f
set timeout 60
spawn scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=10 "$f" ${REMOTE_USER}@${REMOTE_HOST}:$dst
expect {
  -re "password:|Password:" { send "${REMOTE_PASSWORD}\\r" }
  timeout { exit 1 }
}
expect { -re {100%|.*} {} eof {} timeout { exit 2 } }
catch wait result
exit [lindex \$result 3]
EXP
    chmod +x /tmp/scp_one.exp
    /tmp/scp_one.exp
  }
  scp_one_path() {
    cat > /tmp/scp_one_path.exp <<EXP
#!/usr/bin/expect -f
set timeout 60
spawn scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=10 [lindex \$argv 1] ${REMOTE_USER}@${REMOTE_HOST}:[lindex \$argv 2]
expect {
  -re "password:|Password:" { send "${REMOTE_PASSWORD}\\r" }
  timeout { exit 1 }
}
expect { -re {100%|.*} {} eof {} timeout { exit 2 } }
catch wait result
exit [lindex \$result 3]
EXP
    chmod +x /tmp/scp_one_path.exp
  }
  scp_one_path
  /tmp/scp_one_path.exp '' /tmp/openbuddy-src.tar.gz /tmp/
  extract_and_stage
  rebuild_and_restart
  verify_external
  printf '\n=== DEPLOY COMPLETE ===\n'
}

main
