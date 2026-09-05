#!/usr/bin/env bash
# Casdoor Provider 批量导入脚本。
#
# 用 Casdoor admin API（POST /api/add-provider）把 docs/casdoor-providers/*.json 全部
# 导入到 Casdoor 服务端。模板中的 REPLACE_WITH_* 占位符必须先用真实凭据替换（或用
# 环境变量覆盖，见下）。
#
# 用法：
#   CASDOOR_ENDPOINT=https://casdoor.example.com \\
#   CASDOOR_ADMIN_USER=admin CASDOOR_ADMIN_PWD='xxx' \\
#     bash scripts/import-casdoor-providers.sh
#
#   DRY_RUN=1 bash scripts/import-casdoor-providers.sh   # 仅打印不导入
#   PROVIDERS_DIR=path/to/json bash ...                 # 自定义模板目录
#
# 环境变量：
#   CASDOOR_ENDPOINT     Casdoor 服务端地址（必填）
#   CASDOOR_ADMIN_USER   Casdoor 管理员用户名（默认 admin）
#   CASDOOR_ADMIN_PWD    Casdoor 管理员密码（必填，建议走 Secret Manager）
#   CASDOOR_ORG          覆盖模板中的 owner 字段（默认保留模板里的）
#   PROVIDERS_DIR        Provider 模板目录（默认 docs/casdoor-providers）
#   DRY_RUN              1 = 仅打印请求不发送

set -euo pipefail

CASDOOR_ENDPOINT=${CASDOOR_ENDPOINT:-${CASDOOR_ORIGIN:-}}
CASDOOR_ADMIN_USER=${CASDOOR_ADMIN_USER:-admin}
CASDOOR_ADMIN_PWD=${CASDOOR_ADMIN_PWD:-${CASDOOR_ADMIN_PASSWORD:-}}
CASDOOR_ORG_OVERRIDE=${CASDOOR_ORG:-}
PROVIDERS_DIR=${PROVIDERS_DIR:-docs/casdoor-providers}
DRY_RUN=${DRY_RUN:-0}

if [ -z "${CASDOOR_ENDPOINT}" ]; then
  echo "ERROR: CASDOOR_ENDPOINT 未设置" >&2
  exit 2
fi
if [ -z "${CASDOOR_ADMIN_PWD}" ]; then
  echo "ERROR: CASDOOR_ADMIN_PWD 未设置（建议从 Secret Manager 注入，不要硬编码）" >&2
  exit 2
fi

log() { printf "[%s] %s\n" "$(date -Iseconds)" "$*"; }

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    log "ERROR: 缺少依赖：$1"
    exit 2
  fi
}
require_cmd curl
require_cmd jq

login_and_get_token() {
  log "登录 Casdoor: ${CASDOOR_ENDPOINT} (user=${CASDOOR_ADMIN_USER})"
  local response
  response=$(curl -sS -X POST \
    -H "content-type: application/json" \
    -d "$(jq -n --arg u "${CASDOOR_ADMIN_USER}" --arg p "${CASDOOR_ADMIN_PWD}" '{username:$u, password:$p, application:"app-built-in", organization:"built-in", signinMethod:"Password"}')" \
    "${CASDOOR_ENDPOINT}/api/login")
  local token=$(echo "${response}" | jq -r '.data // empty')
  if [ -z "${token}" ]; then
    log "ERROR: 登录失败：${response}"
    exit 1
  fi
  echo "${token}"
}

check_placeholders() {
  local file=$1
  if grep -q "REPLACE_WITH_" "${file}"; then
    log "WARN: ${file} 包含未替换的占位符："
    grep -n "REPLACE_WITH_" "${file}" | sed 's/^/    /'
    if [ "${STRICT:-0}" = "1" ]; then
      log "ERROR: STRICT=1 时拒绝导入含占位符的模板"
      return 1
    fi
    return 0
  fi
}

import_one() {
  local file=$1
  local token=$2
  log "导入: ${file}"
  check_placeholders "${file}" || return 0
  # 读模板，把 _notes 删掉（Casarest 后端会拒绝未知字段）
  local payload
  payload=$(jq 'del(._notes)' "${file}")
  if [ -n "${CASDOOR_ORG_OVERRIDE}" ]; then
    payload=$(echo "${payload}" | jq --arg o "${CASDOOR_ORG_OVERRIDE}" '.owner = $o')
  fi
  if [ "${DRY_RUN}" = "1" ]; then
    echo "[DRY-RUN] POST ${CASDOOR_ENDPOINT}/api/add-provider"
    echo "${payload}" | jq '.'
    return 0
  fi
  local response
  response=$(curl -sS -X POST \
    -H "authorization: Bearer ${token}" \
    -H "content-type: application/json" \
    -d "${payload}" \
    "${CASDOOR_ENDPOINT}/api/add-provider")
  local status=$(echo "${response}" | jq -r '.status // empty')
  local msg=$(echo "${response}" | jq -r '.msg // empty')
  if [ "${status}" = "ok" ]; then
    log "  ✓ 成功"
  elif echo "${msg}" | grep -qi "already exists\|duplicate\|exists"; then
    log "  ○ 已存在，跳过"
  else
    log "  ✗ 失败：${msg}"
    return 1
  fi
}

main() {
  log "===== Casdoor Provider 批量导入 ====="
  log "  ENDPOINT=${CASDOOR_ENDPOINT}  USER=${CASDOOR_ADMIN_USER}  DIR=${PROVIDERS_DIR}  DRY_RUN=${DRY_RUN}"
  if [ ! -d "${PROVIDERS_DIR}" ]; then
    log "ERROR: 模板目录不存在：${PROVIDERS_DIR}"
    exit 2
  fi
  local files=( "${PROVIDERS_DIR}"/*.json )
  if [ ${#files[@]} -eq 0 ]; then
    log "ERROR: 模板目录无 .json 文件：${PROVIDERS_DIR}"
    exit 2
  fi

  local token
  if [ "${DRY_RUN}" = "1" ]; then
    token=""
  else
    token=$(login_and_get_token)
  fi

  local ok=0; local fail=0; local skipped=0
  for f in "${files[@]}"; do
    if [ "$(basename "${f}")" = "_schema.json" ]; then
      log "跳过 schema: ${f}"
      skipped=$((skipped+1))
      continue
    fi
    if import_one "${f}" "${token}"; then
      ok=$((ok+1))
    else
      fail=$((fail+1))
    fi
  done

  log "===== 完成：成功 ${ok} / 失败 ${fail} / 跳过 ${skipped} ====="
  [ "${fail}" -eq 0 ]
}

main "$@"
