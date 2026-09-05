#!/usr/bin/env bash
set -euo pipefail

env_file=${CAPABILITY_SNAPSHOT_ENV_FILE:-/etc/openbuddy/new-api-reconciliation-worker.env}
unit_file=${CAPABILITY_SNAPSHOT_UNIT_FILE:-deploy/openbuddy-new-api-capability-snapshot.service}
runtime_dir=${CAPABILITY_SNAPSHOT_RUNTIME_DIR:-/opt/service/openbuddy}

die() { printf 'validate-capability-snapshot-install: %s\n' "$1" >&2; exit 1; }
require_file() { [[ -f "$1" ]] || die "file does not exist: $1"; }
require_command() { command -v "$1" >/dev/null 2>&1 || die "missing command: $1"; }
require_command awk
require_file "${env_file}"
require_file "${unit_file}"
require_file "${runtime_dir}/scripts/new-api-capability-snapshot.mjs"

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

new_api_url=$(required_value NEW_API_BASE_URL)
admin_token=$(required_value NEW_API_ADMIN_ACCESS_TOKEN)
admin_user_id=$(required_value NEW_API_ADMIN_USER_ID)
output_file=$(required_value NEW_API_CAPABILITY_SNAPSHOT_OUTPUT)
[[ "${new_api_url}" =~ ^https://[^/?#:@]+([^?#]*)?$ ]] || die "NEW_API_BASE_URL must use HTTPS"
(( ${#admin_token} >= 32 )) || die "New API admin token is too short"
(( ${#admin_user_id} >= 1 && ${#admin_user_id} <= 120 )) || die "New API admin user id is invalid"
[[ "${output_file}" == /var/lib/openbuddy/* ]] || die "snapshot output must stay under /var/lib/openbuddy"

grep -Fq 'NoNewPrivileges=true' "${unit_file}" || die "unit must set NoNewPrivileges=true"
grep -Fq 'ProtectSystem=strict' "${unit_file}" || die "unit must set ProtectSystem=strict"
grep -Fq 'ProtectHome=true' "${unit_file}" || die "unit must set ProtectHome=true"
grep -Fq 'ReadWritePaths=/var/lib/openbuddy' "${unit_file}" || die "unit must restrict writes to /var/lib/openbuddy"
grep -Fq 'new-api-capability-snapshot.mjs' "${unit_file}" || die "unit must execute the capability snapshot script"

if command -v systemd-analyze >/dev/null 2>&1; then
  systemd-analyze verify "${unit_file}" >/dev/null 2>&1 || die "systemd unit verification failed"
fi

printf '{"status":"passed","envFile":"%s","unitFile":"%s","outputFile":"%s"}\n' "${env_file}" "${unit_file}" "${output_file}"
