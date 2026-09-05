#!/usr/bin/env bash
# Verify that a remote Gateway + Worker install matches the expected bundle.
# Runs against the same host the operator uploaded the bundle to.
#
# Usage:
#   REMOTE_HOST=124.221.146.145 \
#   REMOTE_USER=ubuntu \
#   REMOTE_DIR=/opt/service/openbuddy \
#   EXPECTED_VERSION=709b258 \
#   bash scripts/verify-remote-install.sh

set -euo pipefail

remote_host=${REMOTE_HOST:-}
remote_user=${REMOTE_USER:-ubuntu}
remote_port=${REMOTE_PORT:-22}
remote_dir=${REMOTE_DIR:-/opt/service/openbuddy}
expected_version=${EXPECTED_VERSION:-$(git rev-parse --short=12 HEAD)}

die() { printf 'verify-remote-install: %s\n' "$1" >&2; exit 2; }
require_command() { command -v "$1" >/dev/null 2>&1 || die "missing command: $1"; }

require_command ssh
require_command awk
require_command grep
require_command head
require_command tr

[[ -n "${remote_host}" ]] || die "REMOTE_HOST is required"
[[ "${remote_port}" =~ ^[0-9]+$ && "${remote_port}" -ge 1 && "${remote_port}" -le 65535 ]] || die "REMOTE_PORT is invalid"
[[ "${remote_dir}" =~ ^/[a-zA-Z0-9._/-]+$ ]] || die "REMOTE_DIR must be an absolute safe path"
[[ "${expected_version}" =~ ^[a-zA-Z0-9._-]{1,80}$ ]] || die "EXPECTED_VERSION is invalid"

ssh_args=(-o BatchMode=yes -o ConnectTimeout=10 -p "${remote_port}" "${remote_user}@${remote_host}")

printf 'Comparing remote Gateway /healthz version to expected\n'
remote_version=$(ssh "${ssh_args[@]}" "curl -fsS http://127.0.0.1:8787/healthz | awk -F '\"version\":\"' '/version/{print \$2; exit}' | awk -F '\"' '{print \$1}'")
[[ -n "${remote_version}" ]] || die "remote Gateway /healthz returned no version (is the container running and healthy?)"
printf '  remote:    %s\n' "${remote_version}"
printf '  expected:  %s\n' "${expected_version}"
[[ "${remote_version}" == "${expected_version}" ]] || die "Gateway version drift detected"

printf 'Verifying systemd timers are installed for credit-expiry and reconciliation workers\n'
ssh "${ssh_args[@]}" "for unit in openbuddy-new-api-capability-snapshot.timer openbuddy-new-api-reconciliation-worker.timer openbuddy-new-api-reconciliation-watchdog.timer openbuddy-credit-expiry-worker.timer; do if ! systemctl list-unit-files \"\${unit}\" >/dev/null; then exit 2; fi; done"

printf 'Verifying Worker scripts exist on disk\n'
ssh "${ssh_args[@]}" "test -f '${remote_dir}/scripts/new-api-reconciliation-worker.mjs' && test -f '${remote_dir}/scripts/credit-expiry-worker.mjs' && test -f '${remote_dir}/scripts/new-api-capability-snapshot.mjs'"

printf 'Verifying internal endpoint /internal/v1/credits/expire is configured\n'
ssh "${ssh_args[@]}" "test -d '${remote_dir}/services/casdoor-resource-gateway/src' && grep -Fq '/internal/v1/credits/expire' '${remote_dir}/services/casdoor-resource-gateway/src/index.ts'"

printf 'Remote install matches expected bundle; no drift detected\n'
