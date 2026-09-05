#!/usr/bin/env bash
# scripts/_section-credit-expiry.sh
#
# Section 9 of scripts/deploy-doctor.sh: HMAC-signed credit-expiry verification.
# Extracted as a function so it can be unit-tested in isolation:
#   1. source this file with ok/fail/warn/skip/head helpers + GATEWAY already set
#   2. call `run_credit_expiry_check` with env vars configured
#
# Required env:
#   GATEWAY                  - OpenBuddy Resource Gateway base URL
#   CREDIT_EXPIRY_SECRET     - HMAC shared secret (≥ 32 chars); when empty, only
#                              the route existence check is performed
# Optional env:
#   CREDIT_EXPIRY_TENANTS    - CSV of tenants to send in tenantIds (default: BUILT_IN_TENANT or "built-in")
#   CREDIT_EXPIRY_RUN_ID     - 8-160 char idempotency key (default: derived from timestamp + pid)
#
# Helpers expected in scope:
#   ok, fail, warn, skip, head, http_status
#   require_cmd (only needed for openssl)

run_credit_expiry_check() {
  local gateway="${GATEWAY:-}"
  if [ -z "${gateway}" ]; then
    fail "run_credit_expiry_check called without GATEWAY"
    return 1
  fi

  head "9. 内部 credit-expiry HMAC 校验"

  local tenants="${CREDIT_EXPIRY_TENANTS:-${BUILT_IN_TENANT:-built-in}}"
  local run_id="${CREDIT_EXPIRY_RUN_ID:-deploy-doctor-$(date +%s)-$$}"
  local body_file; body_file=$(mktemp)
  local payload_file; payload_file=$(mktemp)
  trap 'rm -f "${body_file}" "${payload_file}" "${credit_expiry_body:-}" "${credit_expiry_payload:-}"' RETURN

  # 9.1 路由必须存在（POST 应返回 401/405/503，绝不能是 404）
  local code
  code=$(http_status -X POST -H "content-type: application/json" --max-time 10 --data '{}' "${gateway}/internal/v1/credits/expire")
  case "${code}" in
    401|405) ok "内部路径已挂载（POST → ${code}）" ;;
    503)     warn "内部路径存在但 worker 密钥未配置（503 CREDIT_EXPIRY_WORKER_DISABLED）" ;;
    404)     fail "内部路径未部署（404）——确认本轮代码已发布" ;;
    *)       fail "内部路径异常返回 ${code}" ;;
  esac

  # 9.x 如果没有密钥，仅做路由存在性检查
  if [ -z "${CREDIT_EXPIRY_SECRET:-}" ]; then
    skip "未设置 CREDIT_EXPIRY_SECRET，跳过 HMAC 正路径（仅做路由存在性检查）"
    return 0
  fi
  if ! command -v openssl >/dev/null 2>&1; then
    fail "openssl 不可用，无法计算 HMAC"
    return 1
  fi

  # 解析 tenants 并校验 run_id
  local tenant_arr
  IFS=',' read -r -a tenant_arr <<< "${tenants}"
  local tenants_json
  tenants_json=$(printf '%s\n' "${tenant_arr[@]}" | jq -R . | jq -s 'sort | unique')

  local ready=0
  if [[ "${run_id}" =~ ^[a-zA-Z0-9_.:-]{8,160}$ ]]; then
    ready=1
  else
    fail "CREDIT_EXPIRY_RUN_ID 不满足 8-160 位字母/数字/. _ : - 约束：${run_id}"
    skip "run_id 非法，跳过 HMAC 正路径（仅做路由存在性检查）"
  fi

  local raw_body
  raw_body=$(jq -n --argjson tenants "${tenants_json}" '{tenantIds:$tenants}')

  if [ "${ready}" != "1" ]; then
    return 0
  fi

  local timestamp signature bad_signature expired replay request_id replay2
  timestamp=$(date +%s)
  signature=$(printf '%s.%s' "${timestamp}" "${raw_body}" | openssl dgst -sha256 -hmac "${CREDIT_EXPIRY_SECRET:-}" -hex | awk '{print $NF}')

  # 9.2 缺签名 → 401
  code=$(curl -s -o "${body_file}" -w "%{http_code}" --max-time 10 -X POST \
    -H "content-type: application/json" \
    -H "idempotency-key: ${run_id}" \
    -H "x-openbuddy-credit-expiry-timestamp: ${timestamp}" \
    --data "${raw_body}" \
    "${gateway}/internal/v1/credits/expire")
  if [ "${code}" = "401" ]; then
    ok "缺签名被拒绝（401）"
  else
    local snippet; snippet=$(head -c 200 "${body_file}" 2>/dev/null || true)
    fail "缺签名应返回 401，实际 ${code}: ${snippet}"
  fi

  # 9.3 错签名 → 401
  bad_signature=$(printf '%s' "${signature}" | tr '0-9a-f' '1')
  code=$(curl -s -o "${body_file}" -w "%{http_code}" --max-time 10 -X POST \
    -H "content-type: application/json" \
    -H "idempotency-key: ${run_id}-bad" \
    -H "x-openbuddy-credit-expiry-timestamp: ${timestamp}" \
    -H "x-openbuddy-credit-expiry-signature: ${bad_signature}" \
    --data "${raw_body}" \
    "${gateway}/internal/v1/credits/expire")
  if [ "${code}" = "401" ]; then
    ok "错签名被拒绝（401）"
  else
    snippet=$(head -c 200 "${body_file}" 2>/dev/null || true)
    fail "错签名应返回 401，实际 ${code}: ${snippet}"
  fi

  # 9.4 正确签名 → 200 + JSON 字段
  code=$(curl -s -o "${body_file}" -w "%{http_code}" --max-time 30 -X POST \
    -H "content-type: application/json" \
    -H "accept: application/json" \
    -H "idempotency-key: ${run_id}" \
    -H "x-openbuddy-credit-expiry-timestamp: ${timestamp}" \
    -H "x-openbuddy-credit-expiry-signature: ${signature}" \
    --data "${raw_body}" \
    "${gateway}/internal/v1/credits/expire")
  if [ "${code}" = "200" ]; then
    expired=$(jq -r '.data.expired // .expired // 0' "${body_file}")
    replay=$(jq -r '.data.replay // .replay // false' "${body_file}")
    request_id=$(jq -r '.data.requestId // .requestId // ""' "${body_file}")
    if [ -n "${request_id}" ]; then
      ok "正确签名通过（expired=${expired}, replay=${replay}, requestId=${request_id}）"
    else
      snippet=$(head -c 200 "${body_file}" 2>/dev/null || true)
      fail "正确签名通过但响应缺 requestId：${snippet}"
      return 0
    fi

    # 9.5 幂等：同 run_id 第二次提交 → replay=true
    code=$(curl -s -o "${body_file}" -w "%{http_code}" --max-time 30 -X POST \
      -H "content-type: application/json" \
      -H "accept: application/json" \
      -H "idempotency-key: ${run_id}" \
      -H "x-openbuddy-credit-expiry-timestamp: ${timestamp}" \
      -H "x-openbuddy-credit-expiry-signature: ${signature}" \
      --data "${raw_body}" \
      "${gateway}/internal/v1/credits/expire")
    if [ "${code}" = "200" ]; then
      replay2=$(jq -r '.data.replay // .replay // false' "${body_file}")
      if [ "${replay2}" = "true" ]; then
        ok "幂等键回放命中（replay=true）"
      else
        fail "幂等键回放未命中（replay=${replay2}）"
      fi
    else
      snippet=$(head -c 200 "${body_file}" 2>/dev/null || true)
      warn "幂等重放第二次请求返回 ${code}：${snippet}"
    fi
  else
    snippet=$(head -c 200 "${body_file}" 2>/dev/null || true)
    fail "正确签名请求失败（${code}）：${snippet}"
  fi
}
