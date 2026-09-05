#!/usr/bin/env bash
# Validate the production Gateway compose file without starting containers.
# Usage: scripts/validate-production-compose.sh [path/to/.env.production]

set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
service_dir="${repo_root}/services/casdoor-resource-gateway"
compose_file="${service_dir}/docker-compose.production.yml"
env_file=${1:-"${service_dir}/.env.production"}
if [[ "${env_file}" != /* ]]; then
  env_file="$(cd "$(dirname "${env_file}")" && pwd)/$(basename "${env_file}")"
fi

if [[ ! -f "${env_file}" ]]; then
  printf 'production env file not found: %s\n' "${env_file}" >&2
  exit 2
fi
if ! command -v docker >/dev/null 2>&1; then
  printf 'docker is required for compose validation\n' >&2
  exit 2
fi
if ! docker compose version >/dev/null 2>&1; then
  printf 'docker compose plugin is required for compose validation\n' >&2
  exit 2
fi

dotenv_value() {
  local key=$1
  local value
  value=$(awk -F= -v key="${key}" '$1 == key { sub(/^[^=]*=/, ""); print; exit }' "${env_file}")
  value=${value#\'}
  value=${value%\'}
  value=${value#\"}
  value=${value%\"}
  printf '%s' "${value}"
}

required_vars=(
  CASDOOR_ISSUER
  CASDOOR_AUDIENCE
  RESOURCE_GATEWAY_WEBHOOK_SECRET
  RESOURCE_GATEWAY_BILLING_CALLBACK_SECRET
  RESOURCE_GATEWAY_BACKCHANNEL_LOGOUT_SECRET
  NEW_API_BASE_URL
  NEW_API_GROUP_TOKENS_JSON
  NEW_API_CAPABILITIES_JSON
  POSTGRES_PASSWORD
  ACME_EMAIL
  GATEWAY_DOMAIN
  RESOURCE_GATEWAY_NEW_API_COST_IMPORT_SECRET
)

secret_vars=(
  RESOURCE_GATEWAY_WEBHOOK_SECRET
  RESOURCE_GATEWAY_BILLING_CALLBACK_SECRET
  RESOURCE_GATEWAY_BACKCHANNEL_LOGOUT_SECRET
  RESOURCE_GATEWAY_NEW_API_COST_IMPORT_SECRET
  POSTGRES_PASSWORD
)

for key in "${required_vars[@]}"; do
  value=$(dotenv_value "${key}")
  if [[ -z "${value}" || "${value}" == replace-with-* ]]; then
    printf 'required production variable is missing or still a placeholder: %s\n' "${key}" >&2
    exit 1
  fi
done

for key in "${secret_vars[@]}"; do
  value=$(dotenv_value "${key}")
  lowered=$(printf '%s' "${value}" | tr '[:upper:]' '[:lower:]')
  if [[ ${#value} -lt 32 || "${lowered}" == *replace-with* || "${lowered}" == *placeholder* || "${lowered}" == *example* ]]; then
    printf 'production secret is too short or still a placeholder: %s\n' "${key}" >&2
    exit 1
  fi
done

casdoor_audience=$(dotenv_value CASDOOR_AUDIENCE)
casdoor_audience_lower=$(printf '%s' "${casdoor_audience}" | tr '[:upper:]' '[:lower:]')
if [[ ! "${casdoor_audience}" =~ ^[a-zA-Z0-9._:-]{3,160}$ || "${casdoor_audience}" == "openbuddy" || "${casdoor_audience_lower}" == *replace-with* || "${casdoor_audience_lower}" == *placeholder* || "${casdoor_audience_lower}" == *example* || "${casdoor_audience_lower}" == *changeme* || "${casdoor_audience_lower}" == *change-me* || "${casdoor_audience_lower}" == *your-* ]]; then
  printf 'CASDOOR_AUDIENCE must be an explicit non-placeholder Casdoor application client ID\n' >&2
  exit 1
fi

group_tokens=$(dotenv_value NEW_API_GROUP_TOKENS_JSON)
default_group=$(dotenv_value NEW_API_GROUP)
default_group=${default_group:-default}
if ! printf '%s' "${group_tokens}" | jq -e --arg default_group "${default_group}" '
  type == "object" and
  (to_entries | length > 0) and
  has($default_group) and
  all(to_entries[];
    (.key | test("^[a-zA-Z0-9_.:-]{1,80}$")) and
    (.value | type == "string" and length > 0 and (ascii_downcase | contains("replace-with") | not) and (ascii_downcase | contains("placeholder") | not) and (ascii_downcase | contains("example") | not))
  )
' >/dev/null 2>&1; then
  printf 'NEW_API_GROUP_TOKENS_JSON must be a non-empty Group-to-token JSON object\n' >&2
  exit 1
fi

capabilities=$(dotenv_value NEW_API_CAPABILITIES_JSON)
capability_max_age=$(dotenv_value NEW_API_CAPABILITY_MAX_AGE_HOURS)
capability_max_age=${capability_max_age:-24}
if ! jq -n -e --arg value "${capability_max_age}" '$value | tonumber | (isfinite and . > 0 and . <= 8760)' >/dev/null 2>&1; then
  printf 'NEW_API_CAPABILITY_MAX_AGE_HOURS must be a positive number no greater than 8760\n' >&2
  exit 1
fi
if ! (
  printf '%s' "${capabilities}" | jq -e --arg default_group "${default_group}" '
    type == "object" and
    (to_entries | length > 0) and
    has($default_group) and
    all(to_entries[]; (.key | test("^[a-zA-Z0-9_.:-]{1,80}$")) and (.value | type == "object" and length > 0))
  ' >/dev/null 2>&1 &&
  printf '%s' "${capabilities}" | jq -e 'tostring | contains("YYYY-MM-DD") | not' >/dev/null 2>&1
); then
  printf 'NEW_API_CAPABILITIES_JSON must be a non-empty JSON object\n' >&2
  exit 1
fi
if ! printf '%s' "${capabilities}" | jq -e '
  [to_entries[]?.value | to_entries[]?.value | to_entries[]?.value | select(.supported == true)] as $supported
  | ($supported | length > 0)
    and ($supported | all(.usage == "required" and (.verifiedAt | type == "string") and (.verifiedAt | test("^[0-9]{4}-[0-9]{2}-[0-9]{2}$"))))
' >/dev/null 2>&1; then
  printf 'NEW_API_CAPABILITIES_JSON must mark every supported protocol with usage=required and a real verifiedAt date\n' >&2
  exit 1
fi
if ! printf '%s' "${capabilities}" | jq -e --arg max_age "${capability_max_age}" --argjson now "$(date -u +%s)" '
  ($max_age | tonumber) as $hours
  | [to_entries[]?.value | to_entries[]?.value | to_entries[]?.value | select(.supported == true)] as $supported
  | ($supported | length > 0)
    and ($supported | all(.verifiedAt | type == "string" and test("^[0-9]{4}-[0-9]{2}-[0-9]{2}$") and ((. + "T00:00:00Z" | fromdateiso8601) <= $now) and (($now - (. + "T00:00:00Z" | fromdateiso8601)) <= ($hours * 3600))))
' >/dev/null 2>&1; then
  printf 'NEW_API_CAPABILITIES_JSON contains stale, future-dated, or invalid verifiedAt values\n' >&2
  exit 1
fi
if ! jq -n -e --argjson groups "${group_tokens}" --argjson capabilities "${capabilities}" '
  ($groups | keys_unsorted) as $group_names |
  ($capabilities | keys_unsorted) as $capability_groups |
  (($group_names - $capability_groups) | length == 0) and
  (($capability_groups - $group_names) | length == 0)
' >/dev/null 2>&1; then
  printf 'NEW_API_GROUP_TOKENS_JSON and NEW_API_CAPABILITIES_JSON must cover the same Groups\n' >&2
  exit 1
fi

if ! (
  cd "${service_dir}"
  docker compose --env-file "${env_file}" -f "${compose_file}" config --quiet >/dev/null
); then
  printf 'docker compose configuration is invalid\n' >&2
  exit 1
fi

printf 'production compose validation passed (secrets not printed)\n'
