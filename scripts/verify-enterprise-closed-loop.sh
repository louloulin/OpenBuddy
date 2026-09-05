#!/usr/bin/env bash
# Verify Casdoor JWT → OpenBuddy Resource Gateway → New API → points settlement.
# The script can create one short-lived New API token, then always deletes it.
# It never prints access tokens, passwords, cookies, or API keys.
#
#   OPENBUDDY_GATEWAY_URL=https://gateway.example.com \
#   CASDOOR_ACCESS_TOKEN=<short-lived token> \
#   OPENBUDDY_TENANT_ID=tenant-a \
#   NEW_API_BASE_URL=https://new-api.example.com \
#   NEW_API_EXISTING_TOKEN_KEY=<short-lived key> \
#   VERIFY_GATEWAY_STREAM=1 \
#   bash scripts/verify-enterprise-closed-loop.sh
#
# The script is read-only by default for the OpenBuddy ledger. To grant a
# temporary verification balance, explicitly add OPENBUDDY_BILLING_WRITE=1.
#
# For an opt-in New API token create/delete check, replace the existing key with:
#   NEW_API_ADMIN_USER=... NEW_API_ADMIN_PASSWORD=... VERIFY_NEW_API_WRITE=1
# If the New API login-session limit is reached, reuse a short-lived admin
# session instead of issuing another login session:
#   NEW_API_ADMIN_ACCESS_TOKEN=... NEW_API_ADMIN_SESSION_ID=... NEW_API_ADMIN_USER_ID=...

set -euo pipefail

gateway=${OPENBUDDY_GATEWAY_URL:-${GATEWAY:-}}
casdoor_access_token=${CASDOOR_ACCESS_TOKEN:-}
tenant_id=${OPENBUDDY_TENANT_ID:-}
new_api_base=${NEW_API_BASE_URL:-}
new_api_key=${NEW_API_EXISTING_TOKEN_KEY:-}
model_hint=${NEW_API_MODEL:-MiniMax-M3}
admin_user=${NEW_API_ADMIN_USER:-}
admin_password=${NEW_API_ADMIN_PASSWORD:-}
admin_access_token=${NEW_API_ADMIN_ACCESS_TOKEN:-}
admin_session_id=${NEW_API_ADMIN_SESSION_ID:-}
admin_user_id=${NEW_API_ADMIN_USER_ID:-}
write_enabled=${VERIFY_NEW_API_WRITE:-0}
billing_write=${OPENBUDDY_BILLING_WRITE:-0}
grant_points=${OPENBUDDY_TEST_GRANT_POINTS:-5000}
verify_external_reconciliation=${VERIFY_EXTERNAL_RECONCILIATION:-0}
verify_gateway_stream=${VERIFY_GATEWAY_STREAM:-0}

if [[ -z "${gateway}" || -z "${casdoor_access_token}" || -z "${tenant_id}" || -z "${new_api_base}" ]]; then
  echo "需要 OPENBUDDY_GATEWAY_URL、CASDOOR_ACCESS_TOKEN、OPENBUDDY_TENANT_ID、NEW_API_BASE_URL" >&2
  exit 2
fi
if [[ -z "${new_api_key}" && "${write_enabled}" != "1" ]]; then
  echo "使用管理员会话创建/删除临时 Token 前必须显式设置 VERIFY_NEW_API_WRITE=1" >&2
  exit 2
fi
if [[ -z "${new_api_key}" && -z "${admin_access_token}" && ( -z "${admin_user}" || -z "${admin_password}" ) ]]; then
  echo "需要 NEW_API_EXISTING_TOKEN_KEY、短期 NEW_API_ADMIN_ACCESS_TOKEN + NEW_API_ADMIN_SESSION_ID，或设置管理员账号密码与 VERIFY_NEW_API_WRITE=1" >&2
  exit 2
fi
if [[ -n "${admin_access_token}" && ( -z "${admin_session_id}" || -z "${admin_user_id}" ) ]]; then
  echo "复用管理员 Access Token 时必须同时提供 NEW_API_ADMIN_SESSION_ID 和 NEW_API_ADMIN_USER_ID" >&2
  exit 2
fi
if [[ "${billing_write}" != "0" && "${billing_write}" != "1" ]]; then
  echo "OPENBUDDY_BILLING_WRITE 必须是 0 或 1" >&2
  exit 2
fi
if [[ "${verify_external_reconciliation}" != "0" && "${verify_external_reconciliation}" != "1" ]]; then
  echo "VERIFY_EXTERNAL_RECONCILIATION 必须是 0 或 1" >&2
  exit 2
fi
if [[ "${verify_gateway_stream}" != "0" && "${verify_gateway_stream}" != "1" ]]; then
  echo "VERIFY_GATEWAY_STREAM 必须是 0 或 1" >&2
  exit 2
fi
if ! [[ "${grant_points}" =~ ^[1-9][0-9]*$ ]]; then
  echo "OPENBUDDY_TEST_GRANT_POINTS 必须是正整数" >&2
  exit 2
fi
for command in curl jq; do
  command -v "${command}" >/dev/null 2>&1 || { echo "缺少依赖：${command}" >&2; exit 2; }
done

gateway=${gateway%/}
new_api_base=${new_api_base%/}
cookie_file=$(mktemp)
login_file=$(mktemp)
response_file=$(mktemp)
stream_response_file=$(mktemp)
token_id=""
token_name=""
new_api_admin_token=""
new_api_session=""
admin_auth=()

cleanup() {
  set +e
  if [[ -z "${token_id}" && -n "${token_name}" && -n "${new_api_admin_token}" ]]; then
    token_id=$(curl -sS --max-time 20 -b "${cookie_file}" "${admin_auth[@]}" "${new_api_base}/api/token/?p=1&size=100" 2>/dev/null | jq -r --arg name "${token_name}" '.data.items[]? | select(.name == $name) | .id' 2>/dev/null | head -n 1)
  fi
  if [[ -n "${token_id}" && -n "${new_api_admin_token}" ]]; then
    curl -sS --max-time 20 -b "${cookie_file}" "${admin_auth[@]}" -X DELETE "${new_api_base}/api/token/${token_id}" >"${response_file}"
    deleted=$(jq -r '.success // false' "${response_file}" 2>/dev/null)
    listed=$(curl -sS --max-time 20 -b "${cookie_file}" "${admin_auth[@]}" "${new_api_base}/api/token/?p=1&size=100" 2>/dev/null | jq -r --arg name "${token_name}" '.data.items[]? | select(.name == $name) | .id' 2>/dev/null)
    if [[ "${deleted}" == "true" && -z "${listed}" ]]; then
      echo "New API temporary token: deleted and absence confirmed (id=${token_id})"
    else
      echo "New API temporary token cleanup failed; inspect the instance (id=${token_id})" >&2
    fi
  elif [[ -n "${new_api_key}" ]]; then
    echo "New API token: externally supplied; cleanup skipped"
  fi
  rm -f "${cookie_file}" "${login_file}" "${response_file}" "${stream_response_file}"
}
trap cleanup EXIT

decode_jwt_payload() {
  local encoded=$1
  local padded
  padded=$(printf '%s' "${encoded}" | tr '_-' '/+')
  case $(( ${#padded} % 4 )) in
    2) padded+="==" ;;
    3) padded+="=" ;;
  esac
  if printf '%s' "${padded}" | base64 --decode 2>/dev/null; then
    return 0
  fi
  printf '%s' "${padded}" | base64 -D
}

if [[ -z "${new_api_key}" ]]; then
  if [[ -n "${admin_access_token}" ]]; then
    new_api_admin_token=${admin_access_token}
    new_api_session=${admin_session_id}
    admin_auth=(-H "Authorization: Bearer ${new_api_admin_token}" -H "New-Api-User: ${admin_user_id}" -H "X-Auth-Session: ${new_api_session}")
    echo "New API admin session: reused (credentials redacted)"
  else
    login_status=$(curl -sS --max-time 20 -c "${cookie_file}" -o "${login_file}" -w '%{http_code}' \
      -X POST "${new_api_base}/api/user/login" -H 'Content-Type: application/json' -H "Origin: ${new_api_base}" \
      --data "$(jq -nc --arg username "${admin_user}" --arg password "${admin_password}" '{username:$username,password:$password,user_agent:"openbuddy-enterprise-closed-loop",turnstile_token:""}')")
    if [[ "${login_status}" == "429" ]]; then
      retry_after=$(curl -sS -I --max-time 10 "${new_api_base}/api/status" 2>/dev/null | awk 'tolower($1)=="retry-after:" {gsub("\r", "", $2); print $2; exit}')
      echo "New API 管理登录被限流（HTTP 429${retry_after:+, Retry-After=${retry_after}}），不会重复登录；请注入短期 NEW_API_ADMIN_ACCESS_TOKEN + NEW_API_ADMIN_SESSION_ID。" >&2
      exit 1
    fi
    new_api_admin_token=$(jq -r '.data.access_token // empty' "${login_file}")
    new_api_session=$(jq -r '.data.session.sid // empty' "${login_file}")
    admin_user_id=$(jq -r '.data.user.id // .data.user_id // .data.id // .user.id // .user_id // empty' "${login_file}")
    if [[ "${login_status}" != 2?? || -z "${new_api_admin_token}" || -z "${new_api_session}" || -z "${admin_user_id}" ]]; then
      echo "New API 管理登录失败（HTTP ${login_status}）" >&2
      exit 1
    fi
    admin_auth=(-H "Authorization: Bearer ${new_api_admin_token}" -H "New-Api-User: ${admin_user_id}" -H "X-Auth-Session: ${new_api_session}")
  fi
  token_name="openbuddy-enterprise-closed-loop-$(date +%s)-${RANDOM}"
  token_payload=$(jq -nc --arg name "${token_name}" --arg group "${NEW_API_TEST_GROUP:-default}" --argjson quota "${NEW_API_TEST_QUOTA:-100000}" --argjson expired "$(( $(date +%s) + ${NEW_API_TEST_TTL_SECONDS:-900} ))" '{name:$name,group:$group,remain_quota:$quota,unlimited_quota:false,status:1,expired_time:$expired}')
  token_create_status=$(curl -sS --max-time 20 -o "${response_file}" -w '%{http_code}' -b "${cookie_file}" "${admin_auth[@]}" -H 'Content-Type: application/json' -X POST "${new_api_base}/api/token/" --data "${token_payload}")
  if [[ "${token_create_status}" != 2?? ]]; then
    token_create_body=$(tr '\r\n' '  ' <"${response_file}" | cut -c1-240)
    if [[ "${token_create_status}" == "400" && "${token_create_body}" == "400 Bad Request"* ]]; then
      echo "New API 管理 API 返回纯文本 HTTP 400；登录成功但会话/管理路由未被实例接受，请检查 New API 版本、反向代理和会话存储，不会重试写操作。" >&2
    else
      echo "New API 临时 Token 创建失败（HTTP ${token_create_status}）：${token_create_body}" >&2
    fi
    exit 1
  fi
  [[ "$(jq -r '.success // false' "${response_file}" 2>/dev/null)" == "true" ]] || { echo "New API 临时 Token 创建失败（HTTP ${token_create_status}）" >&2; exit 1; }
  for attempt in {1..10}; do
    token_list=$(curl -sS --max-time 20 -b "${cookie_file}" "${admin_auth[@]}" "${new_api_base}/api/token/?p=1&size=100")
    token_id=$(printf '%s' "${token_list}" | jq -r --arg name "${token_name}" '.data.items[]? | select(.name == $name) | .id' | head -n 1)
    [[ -n "${token_id}" ]] && break
    sleep 1
  done
  [[ -n "${token_id}" ]] || { echo "New API 临时 Token 创建后未能在列表确认" >&2; exit 1; }
  key_status=$(curl -sS --max-time 20 -b "${cookie_file}" "${admin_auth[@]}" -o "${response_file}" -w '%{http_code}' -X POST "${new_api_base}/api/token/${token_id}/key")
  new_api_key=$(jq -r '.data.key // .key // empty' "${response_file}")
  [[ "${key_status}" == 2?? && -n "${new_api_key}" && "${new_api_key}" != *'****'* ]] || { echo "New API 临时 Token key 获取失败（HTTP ${key_status}）" >&2; exit 1; }
  echo "New API temporary token: created/listed/key retrieved (id=${token_id}, key redacted)"
fi

direct_model=$(curl -sS --fail-with-body --max-time 30 "${new_api_base}/v1/models" -H "Authorization: Bearer ${new_api_key}" | jq -r --arg hint "${model_hint}" 'first(.data[]? | select(.id == $hint) | .id) // .data[0].id // empty')
[[ -n "${direct_model}" ]] || { echo "New API 临时 Token 模型探测失败" >&2; exit 1; }
echo "New API temporary token: models reachable (selected=${direct_model})"

health_status=$(curl -sS --max-time 15 -o "${response_file}" -w '%{http_code}' "${gateway}/healthz")
[[ "${health_status}" == "200" ]] || { echo "Resource Gateway /healthz 失败（HTTP ${health_status}）" >&2; exit 1; }
echo "Resource Gateway: reachable"

token_payload=$(printf '%s' "${casdoor_access_token}" | awk -F. '{print $2}')
subject=$(decode_jwt_payload "${token_payload}" | jq -r '.sub // empty')
[[ -n "${subject}" ]] || { echo "CASDOOR_ACCESS_TOKEN 缺少 sub" >&2; exit 1; }
auth=(-H "Authorization: Bearer ${casdoor_access_token}")
before=$(curl -sS --max-time 20 "${auth[@]}" "${gateway}/v1/tenants/${tenant_id}/credits")
before_consumed=$(printf '%s' "${before}" | jq -r '.data.lifetimeConsumed // 0')
before_available=$(printf '%s' "${before}" | jq -r '.data.available // 0')
if [[ "${billing_write}" == "1" ]]; then
  grant_key="enterprise-grant-$(date +%s)-${RANDOM}"
  grant=$(curl -sS --fail-with-body --max-time 20 "${auth[@]}" -H 'Content-Type: application/json' -X POST "${gateway}/v1/tenants/${tenant_id}/credits/grant" --data "$(jq -nc --arg subject "${subject}" --arg key "${grant_key}" --argjson amount "${grant_points}" '{subject:$subject,amount:$amount,idempotencyKey:$key}')")
  [[ "$(printf '%s' "${grant}" | jq -r '.data.account.balance // empty')" =~ ^[0-9]+$ ]] || { echo "积分发放失败" >&2; exit 1; }
  echo "OpenBuddy ledger: verification grant applied (${grant_points} points)"
elif ! [[ "${before_available}" =~ ^[1-9][0-9]*$ ]]; then
  echo "OpenBuddy ledger: available points are insufficient for read-only verification; use a pre-funded test tenant or explicitly set OPENBUDDY_BILLING_WRITE=1" >&2
  exit 1
else
  echo "OpenBuddy ledger: read-only mode (available=${before_available})"
fi
model=$(curl -sS --fail-with-body --max-time 30 "${auth[@]}" "${gateway}/v1/tenants/${tenant_id}/ai/models" | jq -r --arg hint "${model_hint}" 'first(.data[]? | select(.id == $hint) | .id) // .data[0].id // empty')
[[ -n "${model}" ]] || { echo "Gateway 模型发现失败" >&2; exit 1; }
capabilities=$(curl -sS --fail-with-body --max-time 30 "${auth[@]}" "${gateway}/v1/tenants/${tenant_id}/ai/capabilities")
capability_model=$(printf '%s' "${capabilities}" | jq -r --arg model "${model}" '.data.models[]? | select(.id == $model) | .id' | head -n 1)
[[ "${capability_model}" == "${model}" ]] || { echo "Gateway 能力目录未返回已发现模型" >&2; exit 1; }
echo "Gateway capability directory: model visible (model=${model})"
chat_key="enterprise-chat-$(date +%s)-${RANDOM}"
chat=$(curl -sS --fail-with-body --max-time 60 "${auth[@]}" -H 'Content-Type: application/json' -H "Idempotency-Key: ${chat_key}" -X POST "${gateway}/v1/tenants/${tenant_id}/ai/chat/completions" --data "$(jq -nc --arg model "${model}" '{model:$model,messages:[{role:"user",content:"Reply with exactly: ok"}],max_tokens:8,stream:false}')")
usage=$(printf '%s' "${chat}" | jq -c 'if .usage then {prompt:(.usage.prompt_tokens // .usage.promptTokens),completion:(.usage.completion_tokens // .usage.completionTokens),total:(.usage.total_tokens // .usage.totalTokens)} else empty end')
[[ -n "${usage}" ]] || { echo "Gateway Chat 未返回真实 usage" >&2; exit 1; }
after=$(curl -sS --fail-with-body --max-time 20 "${auth[@]}" "${gateway}/v1/tenants/${tenant_id}/credits")
after_consumed=$(printf '%s' "${after}" | jq -r '.data.lifetimeConsumed // 0')
reserved=$(printf '%s' "${after}" | jq -r '.data.reserved // -1')
[[ "${reserved}" == "0" && "${after_consumed}" -gt "${before_consumed}" ]] || { echo "积分结算失败（before=${before_consumed}, after=${after_consumed}, reserved=${reserved}）" >&2; exit 1; }
ledger=$(curl -sS --fail-with-body --max-time 20 "${auth[@]}" "${gateway}/v1/tenants/${tenant_id}/credits/ledger?limit=20")
consume_entry=$(printf '%s' "${ledger}" | jq -c --arg model "${model}" 'first(.data[]? | select(.type == "consume" and .model == $model)) // empty')
[[ -n "${consume_entry}" ]] || { echo "积分账本未找到本次 consume 记录" >&2; exit 1; }
request_id=$(printf '%s' "${consume_entry}" | jq -r '.newApiRequestId // empty')
[[ -n "${request_id}" ]] || { echo "consume 记录缺少 New API request id" >&2; exit 1; }
reconciliation=$(curl -sS --fail-with-body --max-time 20 "${auth[@]}" "${gateway}/v1/tenants/${tenant_id}/credits/reconciliation")
reconciliation_requests=$(printf '%s' "${reconciliation}" | jq -r '.data.total.requests // 0')
[[ "${reconciliation_requests}" =~ ^[1-9][0-9]*$ ]] || { echo "成本对账未包含本次请求" >&2; exit 1; }
if [[ "${verify_external_reconciliation}" == "1" ]]; then
  external_fetched=$(printf '%s' "${reconciliation}" | jq -r '.data.externalNewApiCostFetched // false')
  [[ "${external_fetched}" == "true" ]] || { echo "要求外部成本已导入，但报告仍未包含 provider-reported 成本" >&2; exit 1; }
  request_matched=$(printf '%s' "${reconciliation}" | jq -r --arg request_id "${request_id}" 'if ((.data.external.providerReportedRecords // 0) + (.data.external.providerReportedQuotaRecords // 0)) < 1 then false else ((.data.external.matchedRequestIds // []) | index($request_id) != null) end')
  [[ "${request_matched}" == "true" ]] || { echo "要求外部成本已导入，但报告未匹配本次 New API request id" >&2; exit 1; }
fi
if [[ "${verify_gateway_stream}" == "1" ]]; then
  stream_key="enterprise-stream-$(date +%s)-${RANDOM}"
  stream_payload=$(jq -nc --arg model "${model}" '{model:$model,messages:[{role:"user",content:"Reply with exactly: ok"}],max_tokens:8,stream:true,stream_options:{include_usage:true}}')
  stream_status=$(curl -sS --max-time 60 -o "${stream_response_file}" -w '%{http_code}' \
    "${auth[@]}" -H 'Content-Type: application/json' -H "Idempotency-Key: ${stream_key}" \
    -X POST "${gateway}/v1/tenants/${tenant_id}/ai/chat/completions" --data "${stream_payload}")
  stream_usage=$(awk 'index($0, "data:") == 1 { sub(/^data:[[:space:]]*/, ""); if ($0 != "[DONE]") print }' "${stream_response_file}" | jq -s -e '
    map(select(type == "object" and .usage? != null) | .usage) | last // empty
    | select((.prompt_tokens // .promptTokens) | type == "number")
    | select((.completion_tokens // .completionTokens) | type == "number")
    | select((.total_tokens // .totalTokens) | type == "number")
  ' >/dev/null 2>&1 && echo verified || true)
  [[ "${stream_status}" == "200" && "${stream_usage}" == "verified" ]] || { echo "Gateway SSE 未返回完整真实 usage（HTTP ${stream_status}）" >&2; exit 1; }
  stream_after=$(curl -sS --fail-with-body --max-time 20 "${auth[@]}" "${gateway}/v1/tenants/${tenant_id}/credits")
  stream_consumed=$(printf '%s' "${stream_after}" | jq -r '.data.lifetimeConsumed // 0')
  stream_reserved=$(printf '%s' "${stream_after}" | jq -r '.data.reserved // -1')
  [[ "${stream_reserved}" == "0" && "${stream_consumed}" -gt "${after_consumed}" ]] || { echo "Gateway SSE 积分结算失败（before=${after_consumed}, after=${stream_consumed}, reserved=${stream_reserved}）" >&2; exit 1; }
  echo "Gateway SSE: HTTP 200, usage=verified, lifetimeConsumed=${stream_consumed}"
fi
echo "Enterprise closed loop: PASS (tenant=${tenant_id}, subject=${subject}, model=${model}, usage=${usage}, lifetimeConsumed=${after_consumed}, newApiRequestId=${request_id}, reconciliationRequests=${reconciliation_requests})"
