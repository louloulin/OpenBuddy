#!/usr/bin/env bash
set -euo pipefail

env_file=${WORKER_ENV_FILE:-/etc/openbuddy/new-api-reconciliation-worker.env}
mapping_file=${WORKER_MAPPING_FILE:-/etc/openbuddy/new-api-tenant-subject-map.json}
unit_file=${WORKER_UNIT_FILE:-deploy/openbuddy-new-api-reconciliation-worker.service}
runtime_dir=${WORKER_RUNTIME_DIR:-/opt/service/openbuddy}

die() { printf 'validate-reconciliation-worker-install: %s\n' "$1" >&2; exit 1; }
require_file() { [[ -f "$1" ]] || die "file does not exist: $1"; }
require_command() { command -v "$1" >/dev/null 2>&1 || die "missing command: $1"; }

require_command awk
require_command jq
require_file "${env_file}"
require_file "${mapping_file}"
require_file "${unit_file}"
require_file "${runtime_dir}/scripts/new-api-reconciliation-worker.mjs"
require_file "${runtime_dir}/scripts/check-reconciliation-heartbeat.mjs"
watchdog_unit_file=${WORKER_WATCHDOG_UNIT_FILE:-deploy/openbuddy-new-api-reconciliation-watchdog.service}
require_file "${watchdog_unit_file}"

file_mode=$(stat -f '%Lp' "${env_file}" 2>/dev/null || stat -c '%a' "${env_file}")
[[ "${file_mode}" == "600" ]] || die "environment file must have mode 0600"

mapping_mode=$(stat -f '%Lp' "${mapping_file}" 2>/dev/null || stat -c '%a' "${mapping_file}")
[[ "${mapping_mode}" =~ ^[0-7]+$ ]] || die "cannot inspect mapping file mode"
(( 10#${mapping_mode} % 10 < 2 )) || die "mapping file must not be writable by group or other"

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
gateway_url=$(required_value OPENBUDDY_GATEWAY_URL)
admin_token=$(required_value NEW_API_ADMIN_ACCESS_TOKEN)
gateway_token=$(required_value OPENBUDDY_GATEWAY_ACCESS_TOKEN)
import_secret=$(required_value RESOURCE_GATEWAY_NEW_API_COST_IMPORT_SECRET)
mapping_ref=$(required_value NEW_API_TENANT_SUBJECT_MAP_JSON)
write_mode=$(dotenv_value NEW_API_RECONCILIATION_WRITE)
write_mode=${write_mode:-0}
checkpoint=$(dotenv_value NEW_API_RECONCILIATION_CHECKPOINT_FILE)
checkpoint=${checkpoint:-/var/lib/openbuddy/new-api-reconciliation-checkpoint.json}
status_file=$(dotenv_value NEW_API_RECONCILIATION_STATUS_FILE)
status_file=${status_file:-/var/lib/openbuddy/new-api-reconciliation-status.json}
snapshot_file=$(dotenv_value NEW_API_CAPABILITY_SNAPSHOT_FILE)
capabilities_ref=$(dotenv_value NEW_API_CAPABILITIES_JSON)

[[ "${new_api_url}" =~ ^https://[^/?#:@]+([^?#]*)?$ ]] || die "NEW_API_BASE_URL must use HTTPS"
[[ "${gateway_url}" =~ ^https://[^/?#:@]+([^?#]*)?$ ]] || die "OPENBUDDY_GATEWAY_URL must use HTTPS"
(( ${#admin_token} >= 32 )) || die "New API admin token is too short"
(( ${#gateway_token} >= 32 )) || die "Gateway access token is too short"
(( ${#import_secret} >= 32 )) || die "cost import HMAC secret is too short"
[[ "${write_mode}" == "0" || "${write_mode}" == "1" ]] || die "NEW_API_RECONCILIATION_WRITE must be 0 or 1"
[[ "${mapping_ref}" == @* ]] || die "NEW_API_TENANT_SUBJECT_MAP_JSON must reference a file"
[[ "${mapping_ref#@}" == "${mapping_file}" ]] || die "mapping file does not match NEW_API_TENANT_SUBJECT_MAP_JSON"
[[ "${checkpoint}" == /var/lib/openbuddy/* ]] || die "checkpoint must stay under /var/lib/openbuddy"
[[ "${status_file}" == /var/lib/openbuddy/* ]] || die "status file must stay under /var/lib/openbuddy"

if [[ "${write_mode}" == "1" ]]; then
  [[ -n "${snapshot_file}" && -f "${snapshot_file}" ]] || die "write mode requires NEW_API_CAPABILITY_SNAPSHOT_FILE"
  [[ -n "${capabilities_ref}" && "${capabilities_ref}" == @* ]] || die "write mode requires NEW_API_CAPABILITIES_JSON file reference"
  capability_file=${capabilities_ref#@}
  [[ -f "${capability_file}" ]] || die "capability directory file does not exist"
  snapshot_mode=$(stat -f '%Lp' "${snapshot_file}" 2>/dev/null || stat -c '%a' "${snapshot_file}")
  [[ "${snapshot_mode}" =~ ^[0-7]+$ ]] || die "cannot inspect capability snapshot mode"
  (( 10#${snapshot_mode} % 10 < 2 )) || die "capability snapshot must not be writable by group or other"
  capability_mode=$(stat -f '%Lp' "${capability_file}" 2>/dev/null || stat -c '%a' "${capability_file}")
  [[ "${capability_mode}" =~ ^[0-7]+$ ]] || die "cannot inspect capability directory mode"
  (( 10#${capability_mode} % 10 < 2 )) || die "capability directory must not be writable by group or other"
fi

jq -e 'type == "object" and ((.groups // {}) | type == "object") and (((.subjects // {}) | type == "object") or ((.users // {}) | type == "object"))' "${mapping_file}" >/dev/null \
  || die "tenant subject mapping is not a valid object"

grep -Fq 'NoNewPrivileges=true' "${unit_file}" || die "unit must set NoNewPrivileges=true"
grep -Fq 'ProtectSystem=strict' "${unit_file}" || die "unit must set ProtectSystem=strict"
grep -Fq 'ProtectHome=true' "${unit_file}" || die "unit must set ProtectHome=true"
grep -Fq 'ReadWritePaths=/var/lib/openbuddy' "${unit_file}" || die "unit must restrict writes to /var/lib/openbuddy"
grep -Fq 'ReadOnlyPaths=/var/lib/openbuddy' "${watchdog_unit_file}" || die "watchdog must use a read-only state directory"
grep -Fq 'NoNewPrivileges=true' "${watchdog_unit_file}" || die "watchdog must set NoNewPrivileges=true"

if command -v systemd-analyze >/dev/null 2>&1; then
  systemd-analyze verify "${unit_file}" >/dev/null 2>&1 || die "systemd unit verification failed"
fi

printf '{"status":"passed","envFile":"%s","mappingFile":"%s","writeEnabled":%s,"checkpoint":"%s","statusFile":"%s"}\n' \
  "${env_file}" "${mapping_file}" "$([[ "${write_mode}" == "1" ]] && printf true || printf false)" "${checkpoint}" "${status_file}"
