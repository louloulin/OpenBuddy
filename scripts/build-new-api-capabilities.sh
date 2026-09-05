#!/usr/bin/env bash
# Build a conservative New API capability directory from a real short-lived token.
# The token is read only from the process environment and is never printed.
# This script verifies non-streaming Chat usage and optionally SSE usage.
#
#   NEW_API_BASE_URL=https://new-api.example.com \
#   NEW_API_TOKEN=... \
#   NEW_API_GROUP=default \
#   NEW_API_MODEL=MiniMax-M3 \
#   NEW_API_VERIFY_STREAM=1 \
#   bash scripts/build-new-api-capabilities.sh

set -euo pipefail

base_url=${NEW_API_BASE_URL:-}
token=${NEW_API_TOKEN:-}
group=${NEW_API_GROUP:-default}
model_hint=${NEW_API_MODEL:-MiniMax-M3}
verified_at=${NEW_API_VERIFIED_AT:-$(date -u +%F)}
verify_stream=${NEW_API_VERIFY_STREAM:-0}

if [[ -z "${base_url}" || -z "${token}" ]]; then
  echo "需要 NEW_API_BASE_URL 和 NEW_API_TOKEN（Token 不会输出）" >&2
  exit 2
fi
if [[ ! "${group}" =~ ^[a-zA-Z0-9_.:-]{1,80}$ ]]; then
  echo "NEW_API_GROUP 格式无效" >&2
  exit 2
fi
if [[ ! "${verified_at}" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
  echo "NEW_API_VERIFIED_AT 必须是 YYYY-MM-DD" >&2
  exit 2
fi
if [[ "${verify_stream}" != "0" && "${verify_stream}" != "1" ]]; then
  echo "NEW_API_VERIFY_STREAM 必须是 0 或 1" >&2
  exit 2
fi
for command in curl jq; do
  command -v "${command}" >/dev/null 2>&1 || { echo "缺少依赖：${command}" >&2; exit 2; }
done

base_url=${base_url%/}
auth=(-H "Authorization: Bearer ${token}")
models=$(curl -sS --fail-with-body --max-time 30 "${auth[@]}" "${base_url}/v1/models")
model=$(printf '%s' "${models}" | jq -r --arg hint "${model_hint}" 'first(.data[]? | select(.id == $hint) | .id) // empty')
if [[ -z "${model}" ]]; then
  echo "New API 未发现目标模型：${model_hint}" >&2
  exit 1
fi

request=$(jq -nc --arg model "${model}" '{model:$model,messages:[{role:"user",content:"Reply with exactly: ok"}],max_tokens:8,stream:false}')
response=$(curl -sS --fail-with-body --max-time 60 "${auth[@]}" \
  -H 'Content-Type: application/json' -X POST "${base_url}/v1/chat/completions" --data "${request}")
usage=$(printf '%s' "${response}" | jq -e '
  select(.usage != null)
  | select((.usage.prompt_tokens // .usage.promptTokens) | type == "number")
  | select((.usage.completion_tokens // .usage.completionTokens) | type == "number")
  | select((.usage.total_tokens // .usage.totalTokens) | type == "number")
  | .usage
' >/dev/null && echo verified || true)
if [[ "${usage}" != verified ]]; then
  echo "New API Chat 未返回完整真实 usage，拒绝生成可计费能力目录" >&2
  exit 1
fi

streaming=false
if [[ "${verify_stream}" == "1" ]]; then
  stream_file=$(mktemp)
  trap 'rm -f "${stream_file}"' EXIT
  stream_request=$(jq -nc --arg model "${model}" '{model:$model,messages:[{role:"user",content:"Reply with exactly: ok"}],max_tokens:8,stream:true,stream_options:{include_usage:true}}')
  stream_status=$(curl -sS --max-time 60 -o "${stream_file}" -w '%{http_code}' "${auth[@]}" \
    -H 'Content-Type: application/json' -X POST "${base_url}/v1/chat/completions" --data "${stream_request}")
  stream_usage=$(awk 'index($0, "data:") == 1 { sub(/^data:[[:space:]]*/, ""); if ($0 != "[DONE]") print }' "${stream_file}" | jq -s -e '
    map(select(type == "object" and .usage? != null) | .usage) | last // empty
    | select((.prompt_tokens // .promptTokens) | type == "number")
    | select((.completion_tokens // .completionTokens) | type == "number")
    | select((.total_tokens // .totalTokens) | type == "number")
  ' >/dev/null 2>&1 && echo verified || true)
  rm -f "${stream_file}"
  if [[ "${stream_status}" != "200" || "${stream_usage}" != verified ]]; then
    echo "New API SSE Chat 未返回完整真实 usage，拒绝标记 streaming=true" >&2
    exit 1
  fi
  streaming=true
fi

jq -n --arg group "${group}" --arg model "${model}" --arg verifiedAt "${verified_at}" --argjson streaming "${streaming}" \
  '{($group): {($model): {"chat.completions": {supported:true, streaming:$streaming, usage:"required", verifiedAt:$verifiedAt}}}}'
if [[ "${streaming}" == "true" ]]; then
  echo "已验证 ${group}/${model} 的非流式和 SSE Chat usage；streaming 标记为 true" >&2
else
  echo "已验证 ${group}/${model} 的非流式 Chat usage；streaming 保守标记为 false" >&2
fi
