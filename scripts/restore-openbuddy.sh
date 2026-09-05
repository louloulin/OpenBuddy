#!/usr/bin/env bash
# OpenBuddy 数据库恢复脚本。
#
# 用法：
#   ./scripts/restore-openbuddy.sh /path/to/postgres.dump
#   ./scripts/restore-openbuddy.sh /var/backups/openbuddy/20260829-120000/postgres.dump
#   DRY_RUN=1 ./scripts/restore-openbuddy.sh /path/to/postgres.dump
#
# 行为：
#  - 强制停止 Gateway 容器，避免恢复期间并发写
#  - 提示二次确认（除非 CONFIRM=1）
#  - 走 pg_restore --clean --if-exists 幂等恢复
#  - 恢复完成后自动重启 Gateway
#
# 环境变量：
#   PGPASSWORD              必填
#   PG_HOST / PG_PORT / PG_USER / PG_DB  与备份脚本一致
#   COMPOSE_FILE / COMPOSE_PROJECT        与备份脚本一致
#   CONFIRM                 1 = 跳过确认直接恢复（默认 0）

set -euo pipefail

DUMP_FILE=${1:-}
PG_HOST=${PG_HOST:-127.0.0.1}
PG_PORT=${PG_PORT:-5432}
PG_USER=${PG_USER:-openbuddy}
PG_DB=${PG_DB:-openbuddy}
COMPOSE_FILE=${COMPOSE_FILE:-services/casdoor-resource-gateway/docker-compose.production.yml}
COMPOSE_PROJECT=${COMPOSE_PROJECT:-openbuddy}
CONFIRM=${CONFIRM:-0}
DRY_RUN=${DRY_RUN:-0}

LOG_FILE="${RESTORE_LOG:-/tmp/openbuddy-restore.log}"

if [ -z "${DUMP_FILE}" ]; then
  echo "Usage: $0 <postgres.dump>" >&2
  exit 2
fi
if [ ! -f "${DUMP_FILE}" ]; then
  echo "ERROR: 备份文件不存在：${DUMP_FILE}" >&2
  exit 2
fi

log() {
  local ts=$(date -Iseconds)
  echo "[${ts}] $*" | tee -a "${LOG_FILE}"
}

confirm() {
  if [ "${CONFIRM}" = "1" ]; then
    return 0
  fi
  echo ""
  echo "⚠️  即将恢复：${DUMP_FILE}"
  echo "   目标：${PG_HOST}:${PG_PORT}/${PG_DB}"
  echo "   这将覆盖当前数据库全部数据。"
  echo ""
  read -rp "确认继续？输入 'yes' 继续，其他任意键取消：" answer
  if [ "${answer}" != "yes" ]; then
    log "用户取消恢复"
    exit 0
  fi
}

stop_gateway() {
  log "停止 Gateway 容器（防止并发写）..."
  if [ "${DRY_RUN}" = "1" ]; then
    echo "[DRY-RUN] docker compose -f ${COMPOSE_FILE} -p ${COMPOSE_PROJECT} stop resource-gateway"
    return
  fi
  docker compose -f "${COMPOSE_FILE}" -p "${COMPOSE_PROJECT}" stop resource-gateway
}

restore() {
  log "开始恢复 → ${DUMP_FILE}"
  if [ "${DRY_RUN}" = "1" ]; then
    echo "[DRY-RUN] pg_restore --clean --if-exists -h ${PG_HOST} -p ${PG_PORT} -U ${PG_USER} -d ${PG_DB} ${DUMP_FILE}"
    return
  fi
  if command -v pg_restore >/dev/null 2>&1; then
    pg_restore --clean --if-exists \
      -h "${PG_HOST}" \
      -p "${PG_PORT}" \
      -U "${PG_USER}" \
      -d "${PG_DB}" \
      "${DUMP_FILE}"
  else
    cat "${DUMP_FILE}" | docker compose -f "${COMPOSE_FILE}" -p "${COMPOSE_PROJECT}" \
      exec -T postgres \
      pg_restore -U "${PG_USER}" -d "${PG_DB}" --clean --if-exists
  fi
  log "  ✓ 恢复完成"
}

restart_gateway() {
  log "重启 Gateway 容器..."
  if [ "${DRY_RUN}" = "1" ]; then
    echo "[DRY-RUN] docker compose -f ${COMPOSE_FILE} -p ${COMPOSE_PROJECT} start resource-gateway"
    return
  fi
  docker compose -f "${COMPOSE_FILE}" -p "${COMPOSE_PROJECT}" start resource-gateway
  log "  ✓ Gateway 已重启"
}

verify_health() {
  log "健康检查..."
  if [ "${DRY_RUN}" = "1" ]; then
    echo "[DRY-RUN] curl -fsS https://gateway.example.com/healthz"
    return
  fi
  sleep 3
  local domain="${GATEWAY_DOMAIN:-gateway.example.com}"
  local protocol="${GATEWAY_PROTOCOL:-https}"
  if ! curl -fsS --max-time 10 "${protocol}://${domain}/healthz" >/dev/null; then
    log "  ⚠️  healthz 检查失败；请手动确认 Gateway 状态"
    return 1
  fi
  log "  ✓ Gateway 健康"
}

main() {
  log "===== OpenBuddy 恢复开始 ====="
  log "  DUMP_FILE=${DUMP_FILE}  TARGET=${PG_HOST}:${PG_PORT}/${PG_DB}"
  if [ -z "${PGPASSWORD:-}" ]; then
    log "ERROR: PGPASSWORD 未设置"
    exit 1
  fi
  confirm
  stop_gateway
  restore
  restart_gateway
  verify_health
  log "===== OpenBuddy 恢复完成 ====="
}

main "$@"
