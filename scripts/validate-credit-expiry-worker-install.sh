#!/usr/bin/env bash
# Validate the credit-expiry worker install state without enabling timers.
# Usage:
#   EXPIRY_ENV_FILE=/etc/openbuddy/credit-expiry-worker.env \
#   EXPIRY_UNIT_FILE=/etc/systemd/system/openbuddy-credit-expiry-worker.service \
#   EXPIRY_RUNTIME_DIR=/opt/service/openbuddy \
#   bash scripts/validate-credit-expiry-worker-install.sh

set -euo pipefail

env_file=${EXPIRY_ENV_FILE:-/etc/openbuddy/credit-expiry-worker.env}
unit_file=${EXPIRY_UNIT_FILE:-deploy/openbuddy-credit-expiry-worker.service}
runtime_dir=${EXPIRY_RUNTIME_DIR:-/opt/service/openbuddy}

die() { printf 'validate-credit-expiry-worker-install: %s\n' "$1" >&2; exit 1; }
require_file() { [[ -f "$1" ]] || die "file does not exist: $1"; }
require_command() { command -v "$1" >/dev/null 2>&1 || die "missing command: $1"; }

require_command awk
require_file "${env_file}"
require_file "${unit_file}"
require_file "${runtime_dir}/scripts/credit-expiry-worker.mjs"
require_file "${runtime_dir}/deploy/openbuddy-credit-expiry-worker.timer"

file_mode=$(stat -f '%Lp' "${env_file}" 2>/dev/null || stat -c '%a' "${env_file}")
[[ "${file_mode}" == "600" ]] || die "environment file must have mode 0600"

dotenv_value() {
  awk -v key="$1" 'index($0, key "=") == 1 { print substr($0, length(key) + 2); exit }' "${env_file}"
}

required_value() {
  local key=$1 value lowered
  value=$(dotenv_value "${key}")
  [[ -n "${value}" ]] || die "${key} is missing"
  lowered=$(printf '%s' "${value}" | tr '[:upper:]' '[:lower:]')
  [[ "${lowered}" != *replace-with* && "${lowered}" != *placeholder* && "${lowered}" != *example* && "${lowered}" != *changeme* ]] || die "${key} contains a placeholder"
  printf '%s' "${value}"
}

gateway_url=$(required_value OPENBUDDY_GATEWAY_URL)
expiry_secret=$(required_value RESOURCE_GATEWAY_CREDIT_EXPIRY_SECRET)
tenant_ids=$(dotenv_value CREDIT_EXPIRY_TENANT_IDS)
status_file=$(dotenv_value CREDIT_EXPIRY_STATUS_FILE)
status_file=${status_file:-/var/lib/openbuddy/credit-expiry-status.json}

[[ "${gateway_url}" =~ ^https://[^/?#:@]+([^?#]*)?$ ]] || die "OPENBUDDY_GATEWAY_URL must use HTTPS"
(( ${#expiry_secret} >= 32 )) || die "credit expiry HMAC secret is too short"
[[ -n "${tenant_ids}" ]] || die "CREDIT_EXPIRY_TENANT_IDS is required; an empty allowlist refuses to run"
[[ "${status_file}" == /var/lib/openbuddy/* ]] || die "status file must stay under /var/lib/openbuddy"

if command -v systemd-analyze >/dev/null 2>&1; then
  systemd-analyze verify "${unit_file}" >/dev/null 2>&1 || die "systemd unit verification failed for ${unit_file}"
  systemd-analyze verify "${runtime_dir}/deploy/openbuddy-credit-expiry-worker.timer" >/dev/null 2>&1 || die "systemd timer verification failed"
fi

printf 'credit-expiry worker install is valid\n'
