#!/usr/bin/env bash
# Read-only production readiness audit for Casdoor + New API + OpenBuddy.
# It never sends credentials, creates tokens, changes remote configuration, or
# prints response bodies. A blocked external endpoint is reported as blocked.
# CASDOOR_CLIENT_ID defaults to OpenBuddy's current public development client;
# production callers should override it with their dedicated application ID.

set -uo pipefail

new_api_base_url=${NEW_API_BASE_URL:-}
casdoor_endpoint=${CASDOOR_ENDPOINT:-}
casdoor_client_id=${CASDOOR_CLIENT_ID:-005d6839fe25abd6696f}
gateway_url=${OPENBUDDY_GATEWAY_URL:-}
if [[ -z "${new_api_base_url}" || -z "${casdoor_endpoint}" || -z "${gateway_url}" ]]; then
  echo "需要 NEW_API_BASE_URL、CASDOOR_ENDPOINT 和 OPENBUDDY_GATEWAY_URL" >&2
  exit 2
fi

for command in curl jq; do
  command -v "${command}" >/dev/null 2>&1 || { echo "缺少依赖：${command}" >&2; exit 2; }
done

new_api_base_url=${new_api_base_url%/}
casdoor_endpoint=${casdoor_endpoint%/}
gateway_url=${gateway_url%/}
tmp_dir=$(mktemp -d)
trap 'rm -rf "${tmp_dir}"' EXIT
checks=()
all_passed=1

add_check() {
  local name=$1 status=$2 detail=$3
  checks+=("$(jq -cn --arg name "${name}" --arg status "${status}" --arg detail "${detail}" '{name:$name,status:$status,detail:$detail}')")
  [[ "${status}" == "passed" ]] || all_passed=0
}

probe() {
  local name=$1 url=$2 expected=$3 output
  output="${tmp_dir}/$(printf '%s' "${name}" | tr -cs '[:alnum:]' '_')"
  local http_code curl_status
  http_code=$(curl -sS --max-time 12 -o "${output}" -w '%{http_code}' "${url}" 2>/dev/null)
  curl_status=$?
  if [[ "${curl_status}" -ne 0 ]]; then
    add_check "${name}" blocked "endpoint unavailable"
    return
  fi
  if [[ "${http_code}" != "${expected}" ]]; then
    add_check "${name}" failed "unexpected HTTP ${http_code}"
    return
  fi
  add_check "${name}" passed "HTTP ${http_code}"
}

status_file="${tmp_dir}/new-api-status.json"
status_code=$(curl -sS --max-time 12 -o "${status_file}" -w '%{http_code}' "${new_api_base_url}/api/status")
if [[ $? -ne 0 ]]; then
  add_check "new-api.status" blocked "endpoint unavailable"
elif [[ "${status_code}" != "200" ]] || ! jq -e '.success == true and (.data.version | type == "string") and (.data.quota_per_unit > 0)' "${status_file}" >/dev/null 2>&1; then
  add_check "new-api.status" failed "unexpected status payload"
else
  version=$(jq -r '.data.version' "${status_file}")
  quota_per_unit=$(jq -r '.data.quota_per_unit' "${status_file}")
  add_check "new-api.status" passed "HTTP 200; version=${version}; quota_per_unit=${quota_per_unit}"
fi

models_file="${tmp_dir}/new-api-models.json"
models_code=$(curl -sS --max-time 12 -o "${models_file}" -w '%{http_code}' "${new_api_base_url}/v1/models")
if [[ $? -ne 0 ]]; then
  add_check "new-api.models-unauthorized" blocked "endpoint unavailable"
elif [[ "${models_code}" == "401" ]] && jq -e '.error.message | type == "string"' "${models_file}" >/dev/null 2>&1; then
  add_check "new-api.models-unauthorized" passed "HTTP 401; bearer token required"
else
  add_check "new-api.models-unauthorized" failed "expected HTTP 401, got ${models_code}"
fi

discovery_file="${tmp_dir}/casdoor-discovery.json"
discovery_code=$(curl -sS --max-time 12 -o "${discovery_file}" -w '%{http_code}' "${casdoor_endpoint}/.well-known/openid-configuration")
if [[ $? -ne 0 ]]; then
  add_check "casdoor.oidc-discovery" blocked "endpoint unavailable"
elif [[ "${discovery_code}" == "200" ]] && jq -e '.issuer and .jwks_uri and .authorization_endpoint' "${discovery_file}" >/dev/null 2>&1; then
  add_check "casdoor.oidc-discovery" passed "HTTP 200; issuer and endpoints present"
else
  add_check "casdoor.oidc-discovery" failed "unexpected OIDC discovery payload"
fi

jwks_file="${tmp_dir}/casdoor-jwks.json"
jwks_code=$(curl -sS --max-time 12 -o "${jwks_file}" -w '%{http_code}' "${casdoor_endpoint}/.well-known/jwks")
if [[ $? -ne 0 ]]; then
  add_check "casdoor.jwks" blocked "endpoint unavailable"
elif [[ "${jwks_code}" == "200" ]] && jq -e '.keys | length > 0' "${jwks_file}" >/dev/null 2>&1; then
  add_check "casdoor.jwks" passed "HTTP 200; signing keys present"
else
  add_check "casdoor.jwks" failed "unexpected JWKS payload"
fi

app_file="${tmp_dir}/casdoor-app.json"
app_code=$(curl -sS --max-time 12 -o "${app_file}" -w '%{http_code}' --get "${casdoor_endpoint}/api/get-app-login" \
  --data-urlencode "clientId=${casdoor_client_id}" \
  --data-urlencode 'responseType=code' \
  --data-urlencode 'redirectUri=casdoor://localhost/callback' \
  --data-urlencode 'type=code' \
  --data-urlencode 'scope=openid profile email phone offline_access')
if [[ $? -ne 0 ]]; then
  add_check "casdoor.openbuddy-application" blocked "endpoint unavailable"
elif [[ "${app_code}" != "200" ]] || ! jq -e '.status == "ok"' "${app_file}" >/dev/null 2>&1; then
  add_check "casdoor.openbuddy-application" failed "application diagnostic unavailable"
else
  app_data=$(jq '.data // {}' "${app_file}")
  redirect_ok=$(jq -r '[.redirectUris[]? | select(. == "casdoor://localhost/callback")] | length > 0' <<<"${app_data}")
  scopes_ok=$(jq -r '(["openid","profile","email","phone","offline_access"] - (.scopes // [])) | length == 0' <<<"${app_data}")
  code_signin=$(jq -r 'if .enableCodeSignin == true then "enabled" else "disabled" end' <<<"${app_data}")
  sms_count=$(jq '[.providers[]? | select(.canSignIn == true and .provider.category == "SMS")] | length' <<<"${app_data}")
  wechat_count=$(jq '[.providers[]? | select(.canSignIn == true and .provider.category == "OAuth" and .provider.type == "WeChat")] | length' <<<"${app_data}")
  if [[ "${redirect_ok}" == true && "${scopes_ok}" == true && "${code_signin}" == enabled && "${sms_count}" -gt 0 && "${wechat_count}" -gt 0 ]]; then
    add_check "casdoor.openbuddy-application" passed "OIDC callback, scopes, SMS and WeChat prerequisites present"
  else
  add_check "casdoor.openbuddy-application" blocked "callback=${redirect_ok}; scopes=${scopes_ok}; verification_code=${code_signin}; sms=${sms_count}; wechat=${wechat_count}"
  fi
fi

probe "openbuddy-gateway.healthz" "${gateway_url}/healthz" 200
probe "openbuddy-gateway.readyz" "${gateway_url}/readyz" 200

printf '{"checkedAt":"%s","checks":[' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
joined_checks=$(IFS=,; printf '%s' "${checks[*]}")
printf '%s' "${joined_checks}"
printf '],"allPassed":%s}\n' "$( [[ "${all_passed}" -eq 1 ]] && echo true || echo false )"
[[ "${all_passed}" -eq 1 ]]
