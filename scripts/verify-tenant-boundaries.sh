#!/usr/bin/env bash
# Verify ordinary Casdoor member tenant isolation against the Resource Gateway.
# This probe is read-only and never prints bearer tokens or response bodies.
#
#   OPENBUDDY_GATEWAY_URL=https://gateway.example.com \
#   OPENBUDDY_TENANT_A=tenant-a OPENBUDDY_TOKEN_A=<short-lived-token> \
#   OPENBUDDY_TENANT_B=tenant-b OPENBUDDY_TOKEN_B=<short-lived-token> \
#   bash scripts/verify-tenant-boundaries.sh
#
# Optional:
#   OPENBUDDY_RESOURCE_ID=<resource-created-in-tenant-a>
#   VERIFY_TENANT_CATALOG=1

set -euo pipefail

gateway=${OPENBUDDY_GATEWAY_URL:-}
tenant_a=${OPENBUDDY_TENANT_A:-}
tenant_b=${OPENBUDDY_TENANT_B:-}
token_a=${OPENBUDDY_TOKEN_A:-}
token_b=${OPENBUDDY_TOKEN_B:-}
resource_id=${OPENBUDDY_RESOURCE_ID:-}
verify_catalog=${VERIFY_TENANT_CATALOG:-0}

die() { echo "tenant-boundary-probe: $1" >&2; exit 2; }
[[ -n "${gateway}" && -n "${tenant_a}" && -n "${tenant_b}" ]] || die "需要 OPENBUDDY_GATEWAY_URL、OPENBUDDY_TENANT_A、OPENBUDDY_TENANT_B"
[[ -n "${token_a}" && -n "${token_b}" ]] || die "需要两名普通成员的 OPENBUDDY_TOKEN_A 和 OPENBUDDY_TOKEN_B"
[[ "${tenant_a}" != "${tenant_b}" ]] || die "两个租户必须不同"
[[ "${verify_catalog}" == "0" || "${verify_catalog}" == "1" ]] || die "VERIFY_TENANT_CATALOG 必须是 0 或 1"
[[ "${tenant_a}" =~ ^[a-zA-Z0-9_.:/-]{1,200}$ ]] || die "OPENBUDDY_TENANT_A 格式无效"
[[ "${tenant_b}" =~ ^[a-zA-Z0-9_.:/-]{1,200}$ ]] || die "OPENBUDDY_TENANT_B 格式无效"
command -v curl >/dev/null 2>&1 || die "缺少 curl"
command -v jq >/dev/null 2>&1 || die "缺少 jq"

gateway=${gateway%/}
response_file=$(mktemp)
trap 'rm -f "${response_file}"' EXIT

error_code() {
  jq -r '.code // .error.code // "UNKNOWN"' "${response_file}" 2>/dev/null || printf 'UNKNOWN'
}

probe() {
  local label=$1 tenant=$2 token=$3 path=$4 expected=$5 expected_code=${6:-}
  local status code
  status=$(curl -sS --max-time 20 -o "${response_file}" -w '%{http_code}' \
    -H "Authorization: Bearer ${token}" "${gateway}/v1/tenants/${tenant}${path}") || status=000
  code=$(error_code)
  if [[ "${status}" != "${expected}" ]]; then
    echo "FAIL ${label}: HTTP ${status}, expected ${expected}, code=${code}" >&2
    return 1
  fi
  if [[ -n "${expected_code}" && "${code}" != "${expected_code}" ]]; then
    echo "FAIL ${label}: HTTP ${status}, code=${code}, expected ${expected_code}" >&2
    return 1
  fi
  echo "PASS ${label}: HTTP ${status}${expected_code:+, code=${code}}"
}

failed=0
probe "tenant A member reads own resources" "${tenant_a}" "${token_a}" "/resources" 200 || failed=1
probe "tenant B member reads own resources" "${tenant_b}" "${token_b}" "/resources" 200 || failed=1
probe "tenant A member cannot read tenant B resources" "${tenant_b}" "${token_a}" "/resources" 403 TENANT_MEMBERSHIP_REQUIRED || failed=1
probe "tenant B member cannot read tenant A resources" "${tenant_a}" "${token_b}" "/resources" 403 TENANT_MEMBERSHIP_REQUIRED || failed=1

if [[ -n "${resource_id}" ]]; then
  [[ "${resource_id}" =~ ^[a-zA-Z0-9._:-]{1,200}$ ]] || die "OPENBUDDY_RESOURCE_ID 格式无效"
  probe "tenant B member cannot read tenant A resource" "${tenant_a}" "${token_b}" "/resources/${resource_id}" 403 TENANT_MEMBERSHIP_REQUIRED || failed=1
fi

if [[ "${verify_catalog}" == "1" ]]; then
  probe "tenant A member reads own commercial catalog" "${tenant_a}" "${token_a}" "/ai/catalog" 200 || failed=1
  probe "tenant B member reads own commercial catalog" "${tenant_b}" "${token_b}" "/ai/catalog" 200 || failed=1
  probe "tenant A member cannot read tenant B catalog" "${tenant_b}" "${token_a}" "/ai/catalog" 403 TENANT_MEMBERSHIP_REQUIRED || failed=1
  probe "tenant B member cannot read tenant A catalog" "${tenant_a}" "${token_b}" "/ai/catalog" 403 TENANT_MEMBERSHIP_REQUIRED || failed=1
fi

if [[ "${failed}" -ne 0 ]]; then
  echo "结论：普通成员多租户隔离验收失败" >&2
  exit 1
fi
echo "结论：普通成员本租户访问与跨租户拒绝均通过"
