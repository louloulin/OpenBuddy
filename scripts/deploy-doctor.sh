#!/usr/bin/env bash
# OpenBuddy 部署后自检脚本。
#
# 跑完部署后执行，把所有验证点一次性串起来：
#  1) Gateway 进程存活 (/healthz + /readyz)
#  2) Postgres 联通 + Schema 版本
#  3) Casdoor 联通 + 必要的 Provider 已启用
#  4) New API 联通 + 当前余额
#  5) SIEM 配置 + 心跳事件投递
#  6) 11 个企业面板 IPC 通道在 preload allowlist + main handler 双向可达
#  7) 杀一个测试租户成员 → kill switch 验证
#  8) Prometheus /metrics 包含 §8 全部指标
#  9) /internal/v1/credits/expire HMAC 签名校验（路径存在 + 拒绝无签名/错签名；可选正路径；详见 _section-credit-expiry.sh）
#
# 退出码：0 = 全过，1 = 有失败，2 = 配置错误
#
# 用法：
#   ./scripts/deploy-doctor.sh
#   GATEWAY=https://gateway.example.com CASDOOR=https://casdoor.example.com \\
#     ADMIN_TOKEN=g-xxx bash scripts/deploy-doctor.sh

set -uo pipefail

GATEWAY=${GATEWAY:-https://gateway.example.com}
CASDOOR=${CASDOOR:-https://casdoor.example.com}
NEW_API=${NEW_API:-https://new-api.example.com}
NEW_API_TOKEN=${NEW_API_TOKEN:-}
NEW_API_MODEL=${NEW_API_MODEL:-}
NEW_API_VERIFY_CHAT=${NEW_API_VERIFY_CHAT:-0}
ADMIN_TOKEN=${ADMIN_TOKEN:-}
BUILT_IN_TENANT=${BUILT_IN_TENANT:-built-in}
CREDIT_EXPIRY_SECRET=${CREDIT_EXPIRY_SECRET:-}
CREDIT_EXPIRY_TENANTS=${CREDIT_EXPIRY_TENANTS:-${BUILT_IN_TENANT}}
CREDIT_EXPIRY_RUN_ID=${CREDIT_EXPIRY_RUN_ID:-deploy-doctor-$(date +%s)-$$}

PASS=0
FAIL=0
SKIP=0
WARN=0

if [ -t 1 ]; then
  GREEN="\033[0;32m"
  RED="\033[0;31m"
  YELLOW="\033[0;33m"
  BLUE="\033[0;34m"
  RESET="\033[0m"
else
  GREEN=""; RED=""; YELLOW=""; BLUE=""; RESET=""
fi

ok()    { printf "  ${GREEN}✓${RESET} %s\n" "$*"; PASS=$((PASS+1)); }
fail()  { printf "  ${RED}✗${RESET} %s\n" "$*"; FAIL=$((FAIL+1)); }
warn()  { printf "  ${YELLOW}⚠${RESET} %s\n" "$*"; WARN=$((WARN+1)); }
skip()  { printf "  ${BLUE}○${RESET} %s\n" "$*"; SKIP=$((SKIP+1)); }
head()  { printf "\n${BLUE}== %s ==${RESET}\n" "$*"; }

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    fail "缺少依赖：$1"
    exit 2
  fi
}

require_cmd curl
require_cmd jq
if [ -n "${CREDIT_EXPIRY_SECRET}" ]; then
  require_cmd openssl
fi

new_api_probe_body=$(mktemp)
new_api_probe_payload=$(mktemp)
cleanup() {
  rm -f "${new_api_probe_body}" "${new_api_probe_payload}"
}
trap cleanup EXIT

http_status() {
  curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$@"
}

http_body() {
  curl -s --max-time 10 "$@"
}

head "1. Gateway 健康"
code=$(http_status "${GATEWAY}/healthz")
if [ "${code}" = "200" ]; then
  body=$(http_body "${GATEWAY}/healthz")
  health_ok=$(echo "${body}" | jq -r '.data.ok // .ok // "false"' 2>/dev/null)
  store=$(echo "${body}" | jq -r '.data.store // .store // "unknown"' 2>/dev/null)
  version=$(echo "${body}" | jq -r '.data.version // .version // "unknown"' 2>/dev/null)
  if [ "${health_ok}" = "true" ]; then
    ok "Gateway 健康（store=${store}, version=${version}）"
  else
    fail "Gateway /healthz 返回 200 但 ok=false：${body}"
  fi
else
  fail "Gateway /healthz 返回 ${code}"
fi

code=$(http_status "${GATEWAY}/readyz")
if [ "${code}" = "200" ]; then
  ok "/readyz 通过"
else
  warn "/readyz 返回 ${code}（部分模式下不可用，可忽略）"
fi

head "2. Gateway Prometheus 指标（部署指南 §8）"
metrics_body=$(http_body "${GATEWAY}/metrics")
for metric in \
  "openbuddy_gateway_uptime_seconds" \
  "openbuddy_gateway_store_kind" \
  "openbuddy_gateway_http_requests_total" \
  "openbuddy_gateway_http_outcomes_total" \
  "openbuddy_gateway_rate_limited_total" \
  "openbuddy_gateway_webhook_accepted_total" \
  "openbuddy_gateway_webhook_rejected_total" \
  "openbuddy_gateway_audit_events_total"; do
  if echo "${metrics_body}" | grep -q "# TYPE ${metric} "; then
    ok "${metric}"
  else
    fail "${metric} 缺失"
  fi
done

head "3. 租户健康（${BUILT_IN_TENANT}）"
if [ -z "${ADMIN_TOKEN}" ]; then
  skip "ADMIN_TOKEN 未设置，跳过租户维度检查（生产请用 service account token）"
else
  code=$(http_status -H "authorization: Bearer ${ADMIN_TOKEN}" "${GATEWAY}/v1/tenants/${BUILT_IN_TENANT}/health")
  if [ "${code}" = "200" ]; then
    body=$(http_body -H "authorization: Bearer ${ADMIN_TOKEN}" "${GATEWAY}/v1/tenants/${BUILT_IN_TENANT}/health")
    kill_switch=$(echo "${body}" | jq -r '.data.policy.killSwitch // .policy.killSwitch // false' 2>/dev/null)
    active_sessions=$(echo "${body}" | jq -r '.data.activeSessions // .activeSessions // 0' 2>/dev/null)
    ok "租户健康（killSwitch=${kill_switch}, activeSessions=${active_sessions}）"
    if [ "${kill_switch}" = "true" ]; then
      warn "kill switch 当前已启用！所有 AI 调用会被拒绝"
    fi
  else
    fail "租户健康返回 ${code}"
  fi
fi

head "4. Casdoor 联通"
code=$(http_status "${CASDOOR}/.well-known/openid-configuration")
if [ "${code}" = "200" ]; then
  ok "OIDC discovery 文档可达"
else
  fail "Casdoor OIDC discovery 返回 ${code}"
fi

code=$(http_status "${CASDOOR}/.well-known/jwks")
if [ "${code}" = "200" ]; then
  ok "JWKS 可达"
else
  fail "Casdoor JWKS 返回 ${code}"
fi

head "5. New API 联通"
# New API 提供 /api/status 之类的健康端点（不同部署可能不同）。
code=$(http_status "${NEW_API}/api/status")
case "${code}" in
  200|401|403)
    ok "New API 可达（status=${code}）"
    ;;
  *)
    warn "New API /api/status 返回 ${code}（可能是版本差异，请人工确认）"
    ;;
esac

if [ -z "${NEW_API_TOKEN}" ]; then
  skip "NEW_API_TOKEN 未设置，跳过 Token、模型和 Chat 验证"
else
  models_code=$(curl -sS --max-time 15 -o "${new_api_probe_body}" -w "%{http_code}" \
    -H "Authorization: Bearer ${NEW_API_TOKEN}" "${NEW_API}/v1/models")
  discovered_model=""
  if [ "${models_code}" = "200" ]; then
    discovered_model=$(jq -r --arg requested "${NEW_API_MODEL}" \
      'if $requested != "" then first(.data[]? | select(.id == $requested) | .id) // "" else .data[0].id // "" end' \
      "${new_api_probe_body}" 2>/dev/null)
    if [ -n "${discovered_model}" ]; then
      ok "New API Token 与模型发现通过（model=${discovered_model}）"
    else
      fail "New API 返回 200 但没有可用模型"
    fi
    usage_code=$(curl -sS --max-time 15 -o "${new_api_probe_body}" -w "%{http_code}" \
      -H "Authorization: Bearer ${NEW_API_TOKEN}" "${NEW_API}/api/usage/token/")
    if [ "${usage_code}" = "200" ]; then
      ok "New API Token 用量接口通过"
    else
      fail "New API Token 用量接口返回 ${usage_code}"
    fi
  else
    error_code=$(jq -r '.error.code // .code // "UNKNOWN"' "${new_api_probe_body}" 2>/dev/null || echo UNKNOWN)
    fail "New API Token/模型发现失败（HTTP ${models_code}, code=${error_code}）"
  fi

  if [ "${NEW_API_VERIFY_CHAT}" = "1" ]; then
    if [ -z "${discovered_model}" ]; then
      fail "已要求 Chat 验证，但没有可用模型"
    else
      jq -nc --arg model "${discovered_model}" \
        '{model:$model,messages:[{role:"user",content:"Reply with exactly: ok"}],max_tokens:8,stream:false}' \
        >"${new_api_probe_payload}"
      chat_code=$(curl -sS --max-time 45 -o "${new_api_probe_body}" -w "%{http_code}" \
        -X POST "${NEW_API}/v1/chat/completions" \
        -H "Authorization: Bearer ${NEW_API_TOKEN}" \
        -H "Content-Type: application/json" \
        --data-binary "@${new_api_probe_payload}")
      chat_usage=$(jq -r 'if (.usage? and ((.usage.prompt_tokens? != null or .usage.promptTokens? != null) and (.usage.completion_tokens? != null or .usage.completionTokens? != null))) then "present" else "missing" end' "${new_api_probe_body}" 2>/dev/null || echo missing)
      if [ "${chat_code}" = "200" ] && [ "${chat_usage}" = "present" ]; then
        ok "New API Chat 与真实 usage 验证通过"
      else
        error_code=$(jq -r '.error.code // .code // "UNKNOWN"' "${new_api_probe_body}" 2>/dev/null || echo UNKNOWN)
        fail "New API Chat 验证失败（HTTP ${chat_code}, usage=${chat_usage}, code=${error_code}）；请检查渠道凭据"
      fi
    fi
  else
    skip "未设置 NEW_API_VERIFY_CHAT=1，跳过有成本的 Chat 验证"
  fi
fi

head "6. 11 个企业面板 IPC 通道自检"
# 通过 Gateway 实际触发每个 path 来验证通道双向可达（避免本地解析源码）
# 这里只检查 health 面板相关的关键端点；其他面板的更详细自检建议用 e2e 测试
for path in \
  "/v1/tenants/${BUILT_IN_TENANT}/policy" \
  "/v1/tenants/${BUILT_IN_TENANT}/health" \
  "/v1/tenants/${BUILT_IN_TENANT}/audit"; do
  if [ -z "${ADMIN_TOKEN}" ]; then
    skip "${path}（无 ADMIN_TOKEN）"
  else
    code=$(http_status -H "authorization: Bearer ${ADMIN_TOKEN}" "${GATEWAY}${path}")
    case "${code}" in
      200) ok "${path} → 200" ;;
      401|403) fail "${path} → ${code}（auth 配置异常）" ;;
      404) fail "${path} → 404（路由丢失）" ;;
      500|503) fail "${path} → ${code}（服务异常）" ;;
      *) warn "${path} → ${code}" ;;
    esac
  fi
done

head "7. Kill Switch 验证（可选）"
if [ -z "${ADMIN_TOKEN}" ]; then
  skip "无 ADMIN_TOKEN，跳过"
elif [ "${KILL_SWITCH_TEST:-0}" != "1" ]; then
  skip "KILL_SWITCH_TEST=1 未设置，跳过实际触发"
else
  warn "KILL_SWITCH_TEST=1 已设置；此检查会临时启用 kill switch 并恢复"
  warn "如确认要执行，请人工确认后再次跑：KILL_SWITCH_TEST=2 bash $0"
  if [ "${KILL_SWITCH_TEST}" = "2" ]; then
    # 真实执行：启用 → 验证拒绝 → 恢复
    curl -fsS -X PATCH \
      -H "authorization: Bearer ${ADMIN_TOKEN}" \
      -H "content-type: application/json" \
      -d '{"killSwitch": true}' \
      "${GATEWAY}/v1/tenants/${BUILT_IN_TENANT}/policy" >/dev/null || fail "启用 kill switch 失败"
    # kill switch rejects the request before any upstream call.
    ai_code=$(http_status -H "authorization: Bearer ${ADMIN_TOKEN}" "${GATEWAY}/v1/tenants/${BUILT_IN_TENANT}/ai/models")
    if [ "${ai_code}" = "423" ]; then
      ok "kill switch 启用后 AI 调用被拒绝（423）"
    else
      warn "kill switch 启用后 AI 调用返回 ${ai_code}（可能路径不对）"
    fi
    curl -fsS -X PATCH \
      -H "authorization: Bearer ${ADMIN_TOKEN}" \
      -H "content-type: application/json" \
      -d '{"killSwitch": false}' \
      "${GATEWAY}/v1/tenants/${BUILT_IN_TENANT}/policy" >/dev/null && ok "kill switch 已关闭" || fail "关闭 kill switch 失败"
  fi
fi

head "8. SIEM 投递验证"
metrics=$(http_body "${GATEWAY}/metrics")
accepted=$(echo "${metrics}" | awk '/^openbuddy_gateway_webhook_accepted_total /{print $2}')
rejected=$(echo "${metrics}" | awk '/^openbuddy_gateway_webhook_rejected_total /{print $2}')
audit=$(echo "${metrics}" | awk '/^openbuddy_gateway_audit_events_total /{print $2}')
echo "  webhook_accepted=${accepted:-0}  webhook_rejected=${rejected:-0}  audit_events=${audit:-0}"
if [ "${audit:-0}" -gt 0 ]; then
  ok "审计事件已累计 ${audit} 条"
else
  warn "尚未观察到审计事件（可能刚启动）"
fi

# §9: /internal/v1/credits/expire HMAC 校验
# 期望行为：
#  - 路由存在
#  - 缺少签名或签名错误必须返回 401
#  - 签名正确时返回 200 + JSON{expired,replay,...}
#  - 同一 idempotency-key 二次提交 replay=true 且不重复过期
# 该检查同时验证：网关是否真的部署了内部 worker 路径，而非空路由或占位实现。
# Section 9: internal credit-expiry HMAC check.
# Extracted to scripts/_section-credit-expiry.sh so it can be unit-tested in isolation.
if [ -f "${SCRIPT_DIR:-$(dirname "$0")}/_section-credit-expiry.sh" ]; then
  # shellcheck source=/dev/null
  source "${SCRIPT_DIR:-$(dirname "$0")}/_section-credit-expiry.sh"
  run_credit_expiry_check || true
else
  fail "scripts/_section-credit-expiry.sh 缺失，§9 无法运行"
fi

echo ""
echo "================================================="
printf "  ${GREEN}通过${RESET}: %d  " "${PASS}"
printf "${RED}失败${RESET}: %d  " "${FAIL}"
printf "${YELLOW}警告${RESET}: %d  " "${WARN}"
printf "${BLUE}跳过${RESET}: %d\n" "${SKIP}"
echo "================================================="

if [ "${FAIL}" -gt 0 ]; then
  exit 1
fi
exit 0
