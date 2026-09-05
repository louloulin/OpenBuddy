#!/usr/bin/env bash
# Verify the New API token/model/chat/usage/delete lifecycle.
#
# This script is intentionally opt-in because it creates and deletes one
# short-lived test token in the configured New API instance. It never prints
# passwords, cookies, access tokens, API keys, or chat response bodies.
#
# Required for a fresh admin session:
#   NEW_API_BASE_URL=http://127.0.0.1:3000 \
#   NEW_API_ADMIN_USER=... NEW_API_ADMIN_PASSWORD=... \
#   VERIFY_NEW_API_WRITE=1 bash scripts/verify-new-api-closed-loop.sh
#
# An existing short-lived admin session may be reused when the instance has
# reached its login-session limit. Never put these values in the repository:
#   NEW_API_ADMIN_ACCESS_TOKEN=... NEW_API_ADMIN_SESSION_ID=... \
#   NEW_API_ADMIN_USER_ID=... \
#   VERIFY_NEW_API_WRITE=1 bash scripts/verify-new-api-closed-loop.sh
#
# Optional:
#   NEW_API_MODEL=deepseek-v4-flash
#   NEW_API_TEST_QUOTA=100000
#   NEW_API_TEST_GROUP=default
#   NEW_API_TEST_TTL_SECONDS=900
#   NEW_API_VERIFY_JSON_APIS=1  # also verify non-streaming Completions/Responses/Embeddings/Rerank
#   NEW_API_VERIFY_STREAM=1  # also verify SSE Chat usage with include_usage
#   NEW_API_EXPECT_UNSUPPORTED_APIS=responses,completions,embeddings,rerank  # expected channel limitations
#   NEW_API_EXISTING_TOKEN_KEY=...  # read-only probe; skips admin login and token mutation

set -euo pipefail

base_url=${NEW_API_BASE_URL:-}
admin_user=${NEW_API_ADMIN_USER:-}
admin_password=${NEW_API_ADMIN_PASSWORD:-}
admin_access_token=${NEW_API_ADMIN_ACCESS_TOKEN:-}
session_id=${NEW_API_ADMIN_SESSION_ID:-}
admin_user_id=${NEW_API_ADMIN_USER_ID:-}
existing_token_key=${NEW_API_EXISTING_TOKEN_KEY:-}
test_group=${NEW_API_TEST_GROUP:-default}
test_quota=${NEW_API_TEST_QUOTA:-100000}
test_ttl_seconds=${NEW_API_TEST_TTL_SECONDS:-900}
model_hint=${NEW_API_MODEL:-}
write_enabled=${VERIFY_NEW_API_WRITE:-0}
verify_json_apis=${NEW_API_VERIFY_JSON_APIS:-0}
verify_stream=${NEW_API_VERIFY_STREAM:-0}
expected_unsupported_apis=${NEW_API_EXPECT_UNSUPPORTED_APIS:-}

if [[ -z "${base_url}" ]]; then
  echo "需要 NEW_API_BASE_URL" >&2
  exit 2
fi
if [[ -z "${existing_token_key}" && -z "${admin_access_token}" && ( -z "${admin_user}" || -z "${admin_password}" ) ]]; then
  echo "需要 NEW_API_ADMIN_USER、NEW_API_ADMIN_PASSWORD，或已有的 NEW_API_ADMIN_ACCESS_TOKEN、NEW_API_ADMIN_SESSION_ID" >&2
  exit 2
fi
if [[ -z "${existing_token_key}" && -n "${admin_access_token}" && ( -z "${session_id}" || -z "${admin_user_id}" ) ]]; then
  echo "复用管理员 Access Token 时必须同时提供 NEW_API_ADMIN_SESSION_ID 和 NEW_API_ADMIN_USER_ID" >&2
  exit 2
fi
if [[ -z "${existing_token_key}" && "${write_enabled}" != "1" ]]; then
  echo "默认只读。创建/删除临时 Token 前请显式设置 VERIFY_NEW_API_WRITE=1。" >&2
  exit 2
fi
if [[ "${verify_json_apis}" != "0" && "${verify_json_apis}" != "1" ]]; then
  echo "NEW_API_VERIFY_JSON_APIS 必须是 0 或 1" >&2
  exit 2
fi
if [[ "${verify_stream}" != "0" && "${verify_stream}" != "1" ]]; then
  echo "NEW_API_VERIFY_STREAM 必须是 0 或 1" >&2
  exit 2
fi
if [[ -n "${expected_unsupported_apis}" ]]; then
  IFS=',' read -r -a expected_api_names <<<"${expected_unsupported_apis}"
  for api_name in "${expected_api_names[@]}"; do
    case "${api_name}" in
      completions|responses|embeddings|rerank) ;;
      *) echo "NEW_API_EXPECT_UNSUPPORTED_APIS 包含未知协议：${api_name}" >&2; exit 2 ;;
    esac
  done
fi
if ! [[ "${test_quota}" =~ ^[0-9]+$ && "${test_quota}" -gt 0 ]]; then
  echo "NEW_API_TEST_QUOTA 必须是正整数" >&2
  exit 2
fi
if ! [[ "${test_ttl_seconds}" =~ ^[0-9]+$ && "${test_ttl_seconds}" -ge 60 ]]; then
  echo "NEW_API_TEST_TTL_SECONDS 必须是不少于 60 秒的整数" >&2
  exit 2
fi

for command in curl jq; do
  command -v "${command}" >/dev/null 2>&1 || { echo "缺少依赖：${command}" >&2; exit 2; }
done

base_url=${base_url%/}
cookie_file=$(mktemp)
login_file=$(mktemp)
response_file=$(mktemp)
stream_file=$(mktemp)
token_id=""
token_key=""
token_name=""
logout_session=0
admin_auth_args=()

set_admin_auth_args() {
  admin_auth_args=(
    -H "Authorization: Bearer ${admin_access_token}"
    -H "New-Api-User: ${admin_user_id}"
  )
  if [[ -n "${session_id:-}" ]]; then
    admin_auth_args+=(-H "X-Auth-Session: ${session_id}")
  fi
}

response_error_summary() {
  jq -r '
    (.error.code // .code // empty) as $code
    | (.error.message // .message // empty) as $message
    | if ($code != "" and $message != "") then ($code + ": " + $message)
      elif $code != "" then $code
      elif $message != "" then $message
      elif (.error? != null) then (.error | tostring)
      else "unknown error"
      end
    | gsub("[\\r\\n]+"; " ")
    | .[0:240]
  ' "${response_file}" 2>/dev/null || echo "invalid response"
}

api_is_expected_unsupported() {
  local api=$1
  local candidate
  IFS=',' read -r -a expected_api_names <<<"${expected_unsupported_apis}"
  for candidate in "${expected_api_names[@]}"; do
    [[ "${candidate}" == "${api}" ]] && return 0
  done
  return 1
}

api_response_is_unsupported() {
  local status=$1
  local error=$2
  local normalized_error
  normalized_error=$(printf '%s' "${error}" | tr '[:upper:]' '[:lower:]')
  [[ "${status}" == "501" || "${normalized_error}" == *"unsupported relay mode"* || "${normalized_error}" == *"not implemented"* ]]
}

api_result_suffix() {
  local api=$1
  local status=$2
  local error=$3
  if api_is_expected_unsupported "${api}"; then
    if api_response_is_unsupported "${status}" "${error}"; then
      printf ', expected=unsupported'
    else
      printf ', expected=unsupported-but-not-confirmed'
    fi
  fi
}

extract_stream_usage() {
  local stream_line stream_payload stream_usage
  while IFS= read -r stream_line; do
    stream_line=${stream_line%$'\r'}
    case "${stream_line}" in
      data:*)
        stream_payload=${stream_line#data:}
        stream_payload=${stream_payload# }
        [[ -z "${stream_payload}" || "${stream_payload}" == "[DONE]" ]] && continue
        stream_usage=$(jq -c 'select(type == "object" and .usage? != null) | .usage' \
          <<<"${stream_payload}" 2>/dev/null || true)
        [[ -n "${stream_usage}" ]] && printf '%s\n' "${stream_usage}"
        ;;
    esac
  done
}


cleanup() {
  set +e
  cleanup_token_id=${token_id:-}
  if [[ -z "${cleanup_token_id}" && -n "${token_name:-}" && -n "${admin_access_token:-}" ]]; then
    cleanup_list_response=$(curl -sS --max-time 15 "${base_url}/api/token/?p=1&size=100" \
      -b "${cookie_file}" \
      "${admin_auth_args[@]}")
    cleanup_token_id=$(jq -r --arg name "${token_name}" \
      '.data.items[]? | select(.name == $name) | .id' <<<"${cleanup_list_response}" 2>/dev/null | head -n 1)
  fi
  if [[ -n "${cleanup_token_id}" ]]; then
    delete_response=$(curl -sS --max-time 15 -X DELETE "${base_url}/api/token/${cleanup_token_id}" \
      -b "${cookie_file}" \
      "${admin_auth_args[@]}")
    if [[ "$(jq -r '.success // false' <<<"${delete_response}" 2>/dev/null)" == "true" ]]; then
      token_id=""
      list_response=$(curl -sS --max-time 15 "${base_url}/api/token/?p=1&size=100" \
        -b "${cookie_file}" \
        "${admin_auth_args[@]}")
      if jq -e --arg name "${token_name:-}" '.data.items[]? | select(.name == $name)' <<<"${list_response}" >/dev/null 2>&1; then
        echo "Cleanup: DELETE returned success but temporary token is still listed (id=${cleanup_token_id})" >&2
      else
        echo "Cleanup: deleted and verified absent (id=${cleanup_token_id})" >&2
      fi
    else
      echo "Cleanup: failed to delete temporary token (id=${cleanup_token_id}); manual cleanup required" >&2
    fi
  fi
  if [[ "${logout_session}" == "1" && -n "${admin_access_token:-}" && -n "${session_id}" ]]; then
    curl -sS --max-time 15 -X POST "${base_url}/api/user/auth/logout" \
      -b "${cookie_file}" \
      -H "Authorization: Bearer ${admin_access_token}" \
      -H "X-Auth-Session: ${session_id}" \
      -H "Origin: ${base_url}" >/dev/null 2>&1
  fi
  rm -f "${cookie_file}" "${login_file}" "${response_file}" "${stream_file}"
}
trap cleanup EXIT

if [[ -n "${existing_token_key}" ]]; then
  token_key="${existing_token_key}"
  echo "Using externally supplied short-lived token key; admin mutation checks skipped"
elif [[ -z "${admin_access_token}" ]]; then
  payload=$(jq -nc --arg username "${admin_user}" --arg password "${admin_password}" \
    '{username:$username,password:$password,user_agent:"openbuddy-closed-loop",turnstile_token:""}')
  login_status=$(curl -sS --max-time 20 -c "${cookie_file}" -o "${login_file}" -w '%{http_code}' \
    -X POST "${base_url}/api/user/login" \
    -H 'Content-Type: application/json' -H "Origin: ${base_url}" \
    --data "${payload}")
  if [[ "${login_status}" != 2?? || "$(jq -r '.success // false' "${login_file}" 2>/dev/null)" != "true" ]]; then
    login_code=$(jq -r '.code // "UNKNOWN"' "${login_file}" 2>/dev/null || echo UNKNOWN)
    login_message=$(jq -r '.message // "登录失败"' "${login_file}" 2>/dev/null || echo "登录失败")
    echo "New API 管理登录失败（HTTP ${login_status}, code=${login_code}）：${login_message}" >&2
    if [[ "${login_status}" == "429" ]]; then
      retry_after=$(curl -sS -I --max-time 15 "${base_url}/api/status" 2>/dev/null | awk 'tolower($1)=="retry-after:" {gsub("\r", "", $2); print $2; exit}')
      if [[ -n "${retry_after}" ]]; then
        echo "服务端登录限流，Retry-After=${retry_after} 秒；脚本不会重复登录，请等待后重试或提供短期管理员会话。" >&2
      else
        echo "服务端登录限流；脚本不会重复登录，请等待后重试或提供短期管理员会话。" >&2
      fi
    fi
    if [[ "${login_code}" == "AUTH_SESSION_LIMIT" ]]; then
      echo "请在 New API 管理端的“登录会话”中退出其他会话后重试，或改用短期 NEW_API_ADMIN_ACCESS_TOKEN + NEW_API_ADMIN_SESSION_ID。" >&2
    fi
    exit 1
  fi
  admin_access_token=$(jq -r '.data.access_token // empty' "${login_file}")
  session_id=$(jq -r '.data.session.sid // empty' "${login_file}")
  admin_user_id=$(jq -r '.data.user.id // .data.user_id // .data.id // .user.id // .user_id // empty' "${login_file}")
  logout_session=1
  if [[ -z "${admin_access_token}" || -z "${session_id}" || -z "${admin_user_id}" ]]; then
    echo "New API 登录响应缺少 access token、session id 或 user id" >&2
    exit 1
  fi
fi

if [[ -z "${existing_token_key}" ]]; then
  set_admin_auth_args

  stamp=$(date +%s)
  token_name="openbuddy-closed-loop-${stamp}-${RANDOM}"
  expired_time=$(( $(date +%s) + test_ttl_seconds ))
  token_payload=$(jq -nc --arg name "${token_name}" --arg group "${test_group}" \
    --argjson quota "${test_quota}" --argjson expired "${expired_time}" \
    '{name:$name,group:$group,remain_quota:$quota,unlimited_quota:false,status:1,expired_time:$expired}')

  token_create_status=$(curl -sS --max-time 20 -o "${response_file}" -w '%{http_code}' -X POST "${base_url}/api/token/" \
    -b "${cookie_file}" "${admin_auth_args[@]}" -H 'Content-Type: application/json' \
    --data "${token_payload}")
  if [[ "${token_create_status}" != 2?? ]]; then
    token_create_body=$(tr '\r\n' '  ' <"${response_file}" | cut -c1-240)
    if [[ "${token_create_status}" == "400" && "${token_create_body}" == "400 Bad Request"* ]]; then
      echo "New API 管理 API 返回纯文本 HTTP 400；登录成功但会话/管理路由未被实例接受，请检查 New API 版本、反向代理和会话存储，不会重试写操作。" >&2
    else
      echo "临时 Token 创建失败（HTTP ${token_create_status}）：${token_create_body}" >&2
    fi
    exit 1
  fi
  if [[ "$(jq -r '.success // false' "${response_file}" 2>/dev/null)" != "true" ]]; then
    echo "临时 Token 创建失败（HTTP ${token_create_status}）" >&2
    exit 1
  fi
  # Record the id before polling the list. If the response omits it, the unique
  # name lookup below and the EXIT trap provide a cleanup fallback.
  token_id=$(jq -r '.data.id // .id // empty' "${response_file}")

  if [[ -z "${token_id}" ]]; then
    token_id=$(jq -r --arg name "${token_name}" \
      '.data.items[]? | select(.name == $name) | .id' "${response_file}" 2>/dev/null | head -n 1)
  fi

  for attempt in {1..10}; do
    curl -sS --fail-with-body --max-time 20 "${base_url}/api/token/?p=1&size=100" \
      -b "${cookie_file}" "${admin_auth_args[@]}" >"${response_file}"
    listed_token_id=$(jq -r --arg name "${token_name}" \
      '.data.items[]? | select(.name == $name) | .id' "${response_file}" | head -n 1)
    if [[ -n "${listed_token_id}" ]]; then
      token_id="${listed_token_id}"
      break
    fi
    sleep 1
  done
  if [[ -z "${token_id}" ]]; then
    echo "临时 Token 已提交但未能在列表中确认，停止验证并由 trap 清理" >&2
    exit 1
  fi

  key_status=$(curl -sS --max-time 20 -o "${response_file}" -w '%{http_code}' -X POST "${base_url}/api/token/${token_id}/key" \
    -b "${cookie_file}" "${admin_auth_args[@]}")
  token_key=$(jq -r '.data.key // .key // empty' "${response_file}")
  if [[ -z "${token_key}" || "${token_key}" == *'****'* ]]; then
    key_error_code=$(jq -r '.code // .error.code // empty' "${response_file}" 2>/dev/null || true)
    echo "临时 Token key 无法取回（HTTP ${key_status}, code=${key_error_code:-UNKNOWN}）；请检查管理员会话或 New API 限流状态，也可使用 NEW_API_EXISTING_TOKEN_KEY 只读复验" >&2
    exit 1
  fi
fi

curl -sS --fail-with-body --max-time 20 "${base_url}/v1/models" \
  -H "Authorization: Bearer ${token_key}" >"${response_file}"
model=$(jq -r --arg hint "${model_hint}" \
  'if $hint != "" then first(.data[]? | select(.id == $hint) | .id) else .data[0].id // empty end' "${response_file}")
if [[ -z "${model}" ]]; then
  echo "模型发现失败或未找到目标模型" >&2
  exit 1
fi

chat_payload=$(jq -nc --arg model "${model}" \
  '{model:$model,messages:[{role:"user",content:"Reply with exactly: ok"}],max_tokens:8,stream:false}')
chat_status=$(curl -sS --max-time 30 -o "${response_file}" -w '%{http_code}' \
  -X POST "${base_url}/v1/chat/completions" \
  -H "Authorization: Bearer ${token_key}" -H 'Content-Type: application/json' \
  --data "${chat_payload}")
chat_usage=$(jq -r 'if .usage then "present" else "missing" end' "${response_file}" 2>/dev/null || echo invalid)
chat_usage_summary=$(jq -c 'if .usage then {prompt_tokens:(.usage.prompt_tokens // .usage.promptTokens // .usage.input_tokens // .usage.inputTokens // null),completion_tokens:(.usage.completion_tokens // .usage.completionTokens // .usage.output_tokens // .usage.outputTokens // null),total_tokens:(.usage.total_tokens // .usage.totalTokens // null)} else {} end' "${response_file}" 2>/dev/null || echo '{}')
chat_error_code=$(jq -r '.error.code // .code // empty' "${response_file}" 2>/dev/null || true)

stream_status="not-run"
stream_usage_summary="{}"
if [[ "${verify_stream}" == "1" && "${chat_status}" == "200" ]]; then
  stream_payload=$(jq -nc --arg model "${model}" \
    '{model:$model,messages:[{role:"user",content:"Reply with exactly: ok"}],max_tokens:8,stream:true,stream_options:{include_usage:true}}')
  stream_status=$(curl -sS --max-time 30 -o "${stream_file}" -w '%{http_code}' \
    -X POST "${base_url}/v1/chat/completions" \
    -H "Authorization: Bearer ${token_key}" -H 'Content-Type: application/json' \
    --data "${stream_payload}")
  stream_usage_summary=$(
    extract_stream_usage <"${stream_file}" | jq -s -c '
      if length == 0 then {}
      else (.[-1] // {}) | {
        prompt_tokens:(.prompt_tokens // .promptTokens // .input_tokens // .inputTokens // null),
        completion_tokens:(.completion_tokens // .completionTokens // .output_tokens // .outputTokens // null),
        total_tokens:(.total_tokens // .totalTokens // null)
      }
      end
    ' 2>/dev/null || echo '{}'
  )
fi

json_api_results=()
if [[ "${verify_json_apis}" == "1" && "${chat_status}" == "200" ]]; then
  completions_payload=$(jq -nc --arg model "${model}" \
    '{model:$model,prompt:"Reply with exactly: ok",max_tokens:8,stream:false}')
  completions_status=$(curl -sS --max-time 30 -o "${response_file}" -w '%{http_code}' \
    -X POST "${base_url}/v1/completions" \
    -H "Authorization: Bearer ${token_key}" -H 'Content-Type: application/json' \
    --data "${completions_payload}")
  completions_usage=$(jq -r 'if (.usage? and ((.usage.prompt_tokens? != null or .usage.promptTokens? != null) and (.usage.completion_tokens? != null or .usage.completionTokens? != null))) then "present" else "missing" end' "${response_file}" 2>/dev/null || echo invalid)
  completions_error=$(response_error_summary)
  json_api_results+=("Completions: HTTP ${completions_status}, usage=${completions_usage}$(api_result_suffix completions "${completions_status}" "${completions_error}"), error=${completions_error}")

  responses_payload=$(jq -nc --arg model "${model}" \
    '{model:$model,input:"Reply with exactly: ok",stream:false}')
  responses_status=$(curl -sS --max-time 30 -o "${response_file}" -w '%{http_code}' \
    -X POST "${base_url}/v1/responses" \
    -H "Authorization: Bearer ${token_key}" -H 'Content-Type: application/json' \
    --data "${responses_payload}")
  responses_usage=$(jq -r 'if (.usage? and ((.usage.prompt_tokens? != null or .usage.promptTokens? != null) and (.usage.completion_tokens? != null or .usage.completionTokens? != null))) then "present" else "missing" end' "${response_file}" 2>/dev/null || echo invalid)
  responses_error=$(response_error_summary)
  json_api_results+=("Responses: HTTP ${responses_status}, usage=${responses_usage}$(api_result_suffix responses "${responses_status}" "${responses_error}"), error=${responses_error}")

  embeddings_payload=$(jq -nc --arg model "${model}" \
    '{model:$model,input:"usage probe"}')
  embeddings_status=$(curl -sS --max-time 30 -o "${response_file}" -w '%{http_code}' \
    -X POST "${base_url}/v1/embeddings" \
    -H "Authorization: Bearer ${token_key}" -H 'Content-Type: application/json' \
    --data "${embeddings_payload}")
  embeddings_usage=$(jq -r 'if (.usage? and ((.usage.prompt_tokens? != null or .usage.promptTokens? != null) and (.usage.total_tokens? != null or .usage.totalTokens? != null))) then "present" else "missing" end' "${response_file}" 2>/dev/null || echo invalid)
  embeddings_error=$(response_error_summary)
  json_api_results+=("Embeddings: HTTP ${embeddings_status}, usage=${embeddings_usage}$(api_result_suffix embeddings "${embeddings_status}" "${embeddings_error}"), error=${embeddings_error}")

  rerank_payload=$(jq -nc --arg model "${model}" \
    '{model:$model,query:"usage probe",documents:["usage probe"]}')
  rerank_status=$(curl -sS --max-time 30 -o "${response_file}" -w '%{http_code}' \
    -X POST "${base_url}/v1/rerank" \
    -H "Authorization: Bearer ${token_key}" -H 'Content-Type: application/json' \
    --data "${rerank_payload}")
  rerank_usage=$(jq -r 'if (.usage? and ((.usage.prompt_tokens? != null or .usage.promptTokens? != null) and (.usage.total_tokens? != null or .usage.totalTokens? != null))) then "present" else "missing" end' "${response_file}" 2>/dev/null || echo invalid)
  rerank_error=$(response_error_summary)
  json_api_results+=("Rerank: HTTP ${rerank_status}, usage=${rerank_usage}$(api_result_suffix rerank "${rerank_status}" "${rerank_error}"), error=${rerank_error}")
fi

if ! usage_status=$(curl -sS --max-time 20 -o "${response_file}" -w '%{http_code}' \
  "${base_url}/api/usage/token/" -H "Authorization: Bearer ${token_key}"); then
  usage_status="000"
fi
if [[ "${usage_status}" == "200" ]]; then
  usage_summary=$(jq -c '(.data // {}) | {total_granted,total_used,total_available,unlimited_quota}' "${response_file}" 2>/dev/null || echo '{}')
else
  usage_summary="unavailable (HTTP ${usage_status})"
fi

echo "New API version: $(curl -sS --max-time 15 -D - -o /dev/null "${base_url}/v1/models" -H "Authorization: Bearer ${token_key}" | awk -F': ' 'tolower($1)=="x-new-api-version" {gsub("\\r","",$2); print $2; exit}')"
if [[ -n "${token_id}" ]]; then
  echo "Temporary token: created (id=${token_id}), cleanup scheduled"
else
  echo "Temporary token: externally supplied short-lived key (read-only mode)"
fi
echo "Models: discovered (selected=${model})"
echo "Chat: HTTP ${chat_status}, usage=${chat_usage}, tokens=${chat_usage_summary}"
if [[ "${verify_stream}" == "1" ]]; then echo "Chat SSE: HTTP ${stream_status}, usage=${stream_usage_summary}"; fi
if ((${#json_api_results[@]})); then
  for result in "${json_api_results[@]}"; do echo "${result}"; done
fi
echo "Token usage: ${usage_summary}"

if [[ "${chat_status}" != "200" ]]; then
  channel_response=$(mktemp)
  if curl -sS --max-time 20 "${base_url}/api/channel/?p=1&page_size=100" \
    -b "${cookie_file}" "${admin_auth_args[@]}" >"${channel_response}"; then
    channel_summary=$(jq -c '
      (.data.items // .data // [])
      | map({name:(.name // ""), group:(.group // ""), status:(.status // .enabled // null), has_key:(if (.key? == null or .key? == "") then false else true end)})
    ' "${channel_response}" 2>/dev/null || echo '[]')
    echo "New API channels (redacted): ${channel_summary}" >&2
  else
    echo "New API channel diagnostic unavailable" >&2
  fi
  rm -f "${channel_response}"
  if [[ -n "${chat_error_code}" ]]; then
    echo "结论：Token/模型链路可用，但 Chat 未成功（HTTP ${chat_status}, code=${chat_error_code}）；请检查 New API 渠道凭据。" >&2
  else
    echo "结论：Token/模型链路可用，但 Chat 未成功（HTTP ${chat_status}）；请检查 New API 渠道凭据。" >&2
  fi
  exit 1
fi
if [[ "${chat_usage}" != "present" ]]; then
  echo "结论：Chat 成功但未返回 usage，不能作为计费闭环通过。" >&2
  exit 1
fi
if [[ "${verify_stream}" == "1" ]]; then
  if [[ "${stream_status}" != "200" ]] || ! jq -e '(.prompt_tokens | type == "number") and (.completion_tokens | type == "number") and (.total_tokens | type == "number")' <<<"${stream_usage_summary}" >/dev/null 2>&1; then
    echo "结论：SSE Chat 未返回完整真实 usage，不能作为流式计费闭环通过。" >&2
    exit 1
  fi
fi
if [[ "${verify_json_apis}" == "1" ]]; then
  json_api_failed=0
  for api_name in completions responses embeddings rerank; do
    status_var="${api_name}_status"
    usage_var="${api_name}_usage"
    error_var="${api_name}_error"
    api_status=${!status_var}
    api_usage=${!usage_var}
    api_error=${!error_var}
    if api_is_expected_unsupported "${api_name}"; then
      if ! api_response_is_unsupported "${api_status}" "${api_error}"; then
        json_api_failed=1
      fi
    elif [[ "${api_status}" != "200" || "${api_usage}" != "present" ]]; then
      json_api_failed=1
    fi
  done
  if [[ "${json_api_failed}" == "1" ]]; then
    echo "结论：至少一个 JSON 协议请求失败或缺少真实 usage，不能作为多协议计费闭环通过。" >&2
    exit 1
  fi
fi

if [[ -n "${token_id}" ]]; then
  token_id_before_cleanup=${token_id}
  curl -sS --fail-with-body --max-time 20 -X DELETE "${base_url}/api/token/${token_id_before_cleanup}" \
    -b "${cookie_file}" "${admin_auth_args[@]}" >/dev/null
  token_id=""
  if curl -sS --fail-with-body --max-time 20 "${base_url}/api/token/?p=1&size=100" \
      -b "${cookie_file}" "${admin_auth_args[@]}" | jq -e --arg name "${token_name}" '.data.items[]? | select(.name == $name)' >/dev/null; then
    echo "结论：临时 Token 删除后仍被列表返回" >&2
    exit 1
  fi
  echo "Cleanup: deleted and verified absent (id=${token_id_before_cleanup})"
fi
