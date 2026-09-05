#!/usr/bin/env bash
set -euo pipefail

env_file=${1:-services/casdoor-resource-gateway/.env.production}
if [[ "${env_file}" != /* ]]; then
  env_file="$(pwd)/${env_file}"
fi
if [[ ! -f "${env_file}" ]]; then
  printf '{"status":"blocked","error":"production env file not found"}\n'
  exit 2
fi
for command in jq awk; do
  command -v "${command}" >/dev/null 2>&1 || { printf '{"status":"blocked","error":"missing dependency: %s"}\n' "${command}"; exit 2; }
done

dotenv_value() {
  local key=$1 value
  value=$(awk -F= -v key="${key}" '$1 == key { sub(/^[^=]*=/, ""); print; exit }' "${env_file}")
  value=${value#\'}
  value=${value%\'}
  value=${value#\"}
  value=${value%\"}
  printf '%s' "${value}"
}

checks=()
failed=0
add_check() {
  local name=$1 status=$2 detail=$3
  checks+=("$(jq -cn --arg name "${name}" --arg status "${status}" --arg detail "${detail}" '{name:$name,status:$status,detail:$detail}')")
  [[ "${status}" == "passed" ]] || failed=1
}

required_vars=(
  CASDOOR_ISSUER CASDOOR_AUDIENCE RESOURCE_GATEWAY_WEBHOOK_SECRET
  RESOURCE_GATEWAY_BILLING_CALLBACK_SECRET RESOURCE_GATEWAY_BACKCHANNEL_LOGOUT_SECRET
  RESOURCE_GATEWAY_NEW_API_COST_IMPORT_SECRET NEW_API_BASE_URL NEW_API_GROUP_TOKENS_JSON
  NEW_API_CAPABILITIES_JSON POSTGRES_PASSWORD ACME_EMAIL GATEWAY_DOMAIN
)
secret_vars=(
  RESOURCE_GATEWAY_WEBHOOK_SECRET RESOURCE_GATEWAY_BILLING_CALLBACK_SECRET
  RESOURCE_GATEWAY_BACKCHANNEL_LOGOUT_SECRET RESOURCE_GATEWAY_NEW_API_COST_IMPORT_SECRET POSTGRES_PASSWORD
)

for key in "${required_vars[@]}"; do
  value=$(dotenv_value "${key}")
  if [[ -z "${value}" || "${value}" == replace-with-* ]]; then
    add_check "env.${key}" failed "missing or placeholder"
  else
    add_check "env.${key}" passed "configured"
  fi
done

for key in "${secret_vars[@]}"; do
  value=$(dotenv_value "${key}")
  lowered=$(printf '%s' "${value}" | tr '[:upper:]' '[:lower:]')
  if [[ ${#value} -lt 32 || "${lowered}" == *replace-with* || "${lowered}" == *placeholder* || "${lowered}" == *example* || "${lowered}" == *changeme* ]]; then
    add_check "secret.${key}" failed "too short or placeholder"
  else
    add_check "secret.${key}" passed "configured"
  fi
done

issuer=$(dotenv_value CASDOOR_ISSUER)
audience=$(dotenv_value CASDOOR_AUDIENCE)
new_api_url=$(dotenv_value NEW_API_BASE_URL)
if [[ "${issuer}" =~ ^https://[^/?#:@]+([^?#]*)?$ ]]; then add_check "casdoor.issuer" passed "HTTPS URL"; else add_check "casdoor.issuer" failed "HTTPS URL required"; fi
if [[ "${audience}" =~ ^[a-zA-Z0-9._:-]{3,160}$ && "${audience}" != "openbuddy" && "${audience,,}" != *replace-with* && "${audience,,}" != *placeholder* && "${audience,,}" != *example* && "${audience,,}" != *changeme* && "${audience,,}" != *change-me* && "${audience,,}" != *your-* ]]; then
  add_check "casdoor.audience" passed "explicit client ID"
else
  add_check "casdoor.audience" failed "explicit non-placeholder client ID required"
fi
if [[ "${new_api_url}" =~ ^https://[^/?#:@]+([^?#]*)?$ ]]; then add_check "new-api.url" passed "HTTPS URL"; else add_check "new-api.url" failed "HTTPS URL required"; fi

group_tokens=$(dotenv_value NEW_API_GROUP_TOKENS_JSON)
capabilities=$(dotenv_value NEW_API_CAPABILITIES_JSON)
default_group=$(dotenv_value NEW_API_GROUP)
default_group=${default_group:-default}
capability_max_age=$(dotenv_value NEW_API_CAPABILITY_MAX_AGE_HOURS)
capability_max_age=${capability_max_age:-24}
if jq -n -e --arg value "${capability_max_age}" '$value | tonumber | (isfinite and . > 0 and . <= 8760)' >/dev/null 2>&1; then
  add_check "new-api.capability-max-age" passed "${capability_max_age} hours"
else
  add_check "new-api.capability-max-age" failed "must be a positive number no greater than 8760"
fi
if printf '%s' "${group_tokens}" | jq -e --arg group "${default_group}" 'type == "object" and length > 0 and has($group) and all(to_entries[]; (.key | test("^[a-zA-Z0-9_.:-]{1,80}$")) and (.value | type == "string" and length >= 32))' >/dev/null 2>&1; then
  add_check "new-api.groups" passed "Group-to-token mapping is valid"
else
  add_check "new-api.groups" failed "non-empty strong Group-to-token mapping required"
fi
if printf '%s' "${capabilities}" | jq -e --argjson groups "${group_tokens}" 'type == "object" and ($groups | keys_unsorted) == (keys_unsorted) and ([to_entries[]?.value | to_entries[]?.value | to_entries[]?.value | select(.supported == true)] | length > 0) and ([to_entries[]?.value | to_entries[]?.value | to_entries[]?.value | select(.supported == true)] | all(.usage == "required" and (.verifiedAt | type == "string") and (.verifiedAt | test("^[0-9]{4}-[0-9]{2}-[0-9]{2}$"))))' >/dev/null 2>&1; then
  add_check "new-api.capabilities" passed "verified capability directory"
else
  add_check "new-api.capabilities" failed "Group sets and verified usage metadata must match"
fi
if printf '%s' "${capabilities}" | jq -e --arg maxAge "${capability_max_age}" --argjson now "$(date -u +%s)" '
  ($maxAge | tonumber) as $hours
  | [to_entries[]?.value | to_entries[]?.value | to_entries[]?.value | select(.supported == true)] as $supported
  | ($supported | length > 0)
    and ($supported | all(.verifiedAt | type == "string" and test("^[0-9]{4}-[0-9]{2}-[0-9]{2}$") and ((. + "T00:00:00Z" | fromdateiso8601) <= $now) and (($now - (. + "T00:00:00Z" | fromdateiso8601)) <= ($hours * 3600))))
' >/dev/null 2>&1; then
  add_check "new-api.capability-freshness" passed "verified dates are within ${capability_max_age} hours"
else
  add_check "new-api.capability-freshness" failed "verifiedAt is stale, future-dated, or invalid"
fi

status=$([[ "${failed}" -eq 0 ]] && printf passed || printf failed)
checks_json=$(printf '%s\n' "${checks[@]}" | jq -s '.')
jq -cn --arg status "${status}" --arg file "${env_file}" --argjson checks "${checks_json}" '{status:$status,envFile:$file,checks:$checks}'
[[ "${failed}" -eq 0 ]]
