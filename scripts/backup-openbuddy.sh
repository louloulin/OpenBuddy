#!/usr/bin/env bash
# OpenBuddy daily backup script.
#
# 备份策略：
#  1) Postgres 全量逻辑备份（pg_dump -Fc，自定义压缩格式）
#  2) Resource Gateway JSON 目录快照（仅 RESOURCE_GATEWAY_STORE=json 时）
#  3) 上传到 S3/OSS（可选）
#  4) 清理超出保留期的本地与远端备份
#
# 适用环境：
#  - 服务部署在 docker compose（services/casdoor-resource-gateway/docker-compose.production.yml）
#  - 可访问 docker CLI / psql / pg_dump / aws cli（或 ossutil64）
#
# 用法：
#   ./scripts/backup-openbuddy.sh                  # 默认运行（保留 14 天）
#   BACKUP_RETAIN_DAYS=30 ./scripts/backup-openbuddy.sh
#   BACKUP_S3_BUCKET=s3://my-bucket/openbuddy ./scripts/backup-openbuddy.sh
#   DRY_RUN=1 ./scripts/backup-openbuddy.sh       # 仅打印不执行
#
# 环境变量：
#   BACKUP_DIR              本地备份目录（默认 /var/backups/openbuddy）
#   BACKUP_RETAIN_DAYS      本地保留天数（默认 14）
#   PG_HOST                 Postgres 主机（默认 127.0.0.1）
#   PG_PORT                 Postgres 端口（默认 5432）
#   PG_USER                 Postgres 用户（默认 openbuddy）
#   PG_DB                   Postgres 库名（默认 openbuddy）
#   PGPASSWORD              Postgres 密码（必填，强烈建议走 Secret Manager）
#   COMPOSE_FILE            docker-compose 文件路径
#                            （默认 services/casdoor-resource-gateway/docker-compose.production.yml）
#   COMPOSE_PROJECT         docker compose project 名（默认 openbuddy）
#   S3_BUCKET               远端备份桶（可选；s3:// 或 oss://）
#   S3_ENDPOINT             远端 S3 兼容 endpoint（OSS/MinIO 必需）
#   S3_AUTO_DELETE          是否同步清理远端过期（默认 1）
#   DRY_RUN                 1 = 只打印不写

set -euo pipefail

BACKUP_DIR=${BACKUP_DIR:-/var/backups/openbuddy}
BACKUP_RETAIN_DAYS=${BACKUP_RETAIN_DAYS:-14}
PG_HOST=${PG_HOST:-127.0.0.1}
PG_PORT=${PG_PORT:-5432}
PG_USER=${PG_USER:-openbuddy}
PG_DB=${PG_DB:-openbuddy}
COMPOSE_FILE=${COMPOSE_FILE:-services/casdoor-resource-gateway/docker-compose.production.yml}
COMPOSE_PROJECT=${COMPOSE_PROJECT:-openbuddy}
S3_BUCKET=${S3_BUCKET:-}
S3_ENDPOINT=${S3_ENDPOINT:-}
S3_AUTO_DELETE=${S3_AUTO_DELETE:-1}
DRY_RUN=${DRY_RUN:-0}

TIMESTAMP=$(date +%Y%m%d-%H%M%S)
DATE_DIR="${BACKUP_DIR}/${TIMESTAMP}"
LOCAL_DUMP="${DATE_DIR}/postgres.dump"
LOCAL_AUDIT_DIR="${DATE_DIR}/audit"
LOCAL_SIEM_DIR="${DATE_DIR}/siem"
LOG_FILE="${BACKUP_DIR}/backup.log"

mkdir -p "${BACKUP_DIR}"

log() {
  local ts=$(date -Iseconds)
  echo "[${ts}] $*" | tee -a "${LOG_FILE}"
}

run_or_print() {
  if [ "${DRY_RUN}" = "1" ]; then
    echo "[DRY-RUN] $*"
  else
    eval "$@"
  fi
}

validate_env() {
  if [ -z "${PGPASSWORD:-}" ]; then
    log "ERROR: PGPASSWORD 未设置；强烈建议从 Secret Manager 注入，不要硬编码"
    exit 1
  fi
  if ! command -v pg_dump >/dev/null 2>&1 && ! command -v docker >/dev/null 2>&1; then
    log "ERROR: 至少需要 pg_dump 或 docker 二进制"
    exit 1
  fi
}

dump_postgres() {
  log "Step 1/3: Postgres 全量逻辑备份 → ${LOCAL_DUMP}"
  if [ "${DRY_RUN}" = "1" ]; then
    echo "[DRY-RUN] pg_dump -h ${PG_HOST} -p ${PG_PORT} -U ${PG_USER} -d ${PG_DB} -Fc -f ${LOCAL_DUMP}"
    return
  fi
  mkdir -p "${DATE_DIR}"
  if command -v pg_dump >/dev/null 2>&1; then
    run_or_print pg_dump \
      -h "${PG_HOST}" \
      -p "${PG_PORT}" \
      -U "${PG_USER}" \
      -d "${PG_DB}" \
      -Fc \
      -f "${LOCAL_DUMP}"
  else
    # 从 docker compose 容器里 dump（确保本地无 pg_dump）
    run_or_print docker compose \
      -f "${COMPOSE_FILE}" \
      -p "${COMPOSE_PROJECT}" \
      exec -T postgres \
      pg_dump -U "${PG_USER}" -d "${PG_DB}" -Fc \
      ">" "${LOCAL_DUMP}"
  fi
  if [ ! -s "${LOCAL_DUMP}" ]; then
    log "ERROR: 备份文件为空或创建失败：${LOCAL_DUMP}"
    exit 1
  fi
  local size=$(du -h "${LOCAL_DUMP}" | cut -f1)
  log "  ✓ 备份完成（${size}）"
}

snapshot_gateway_data() {
  # 仅当 RESOURCE_GATEWAY_STORE=json 时才需要备份数据目录
  # 生产推荐 postgres 模式，跳过此步
  local store_kind="${RESOURCE_GATEWAY_STORE:-json}"
  if [ "${store_kind}" != "json" ]; then
    log "Step 2/3: 跳过 Gateway 数据目录（STORE=${store_kind}）"
    return
  fi
  log "Step 2/3: Gateway 数据目录快照 → ${LOCAL_AUDIT_DIR}"
  if [ "${DRY_RUN}" = "1" ]; then
    echo "[DRY-RUN] docker cp ${COMPOSE_PROJECT}-resource-gateway-1:/var/lib/openbuddy-resource-gateway ${LOCAL_AUDIT_DIR}"
    return
  fi
  mkdir -p "${LOCAL_AUDIT_DIR}"
  local gateway_container=$(docker compose -f "${COMPOSE_FILE}" -p "${COMPOSE_PROJECT}" ps -q resource-gateway 2>/dev/null | head -1 || true)
  if [ -z "${gateway_container}" ]; then
    log "  WARN: resource-gateway 容器未运行；跳过数据目录快照"
    return
  fi
  run_or_print docker cp "${gateway_container}:/var/lib/openbuddy-resource-gateway/." "${LOCAL_AUDIT_DIR}/"
  log "  ✓ 数据目录快照完成"
}

upload_to_s3() {
  if [ -z "${S3_BUCKET}" ]; then
    log "Step 3/3: 跳过 S3 上传（S3_BUCKET 未设置）"
    return
  fi
  log "Step 3/3: 上传备份到 ${S3_BUCKET}/${TIMESTAMP}/"
  if [ "${DRY_RUN}" = "1" ]; then
    echo "[DRY-RUN] aws --endpoint-url ${S3_ENDPOINT:-default} s3 cp ${DATE_DIR}/ ${S3_BUCKET}/${TIMESTAMP}/ --recursive"
    return
  fi
  local s3_args=()
  if [ -n "${S3_ENDPOINT}" ]; then
    s3_args+=(--endpoint-url "${S3_ENDPOINT}")
  fi
  run_or_print aws "${s3_args[@]}" s3 cp "${DATE_DIR}/" "${S3_BUCKET}/${TIMESTAMP}/" --recursive
  log "  ✓ 上传完成"
}

prune_local() {
  log "Prune: 清理 ${BACKUP_RETAIN_DAYS} 天前的本地备份"
  if [ "${DRY_RUN}" = "1" ]; then
    find "${BACKUP_DIR}" -mindepth 1 -maxdepth 1 -type d -mtime +${BACKUP_RETAIN_DAYS} -print
    return
  fi
  local deleted=$(find "${BACKUP_DIR}" -mindepth 1 -maxdepth 1 -type d -mtime +${BACKUP_RETAIN_DAYS} -print -exec rm -rf {} +)
  log "  ✓ 删除：$(echo "${deleted}" | tr '\n' ' ')"
}

prune_s3() {
  if [ -z "${S3_BUCKET}" ] || [ "${S3_AUTO_DELETE}" != "1" ]; then
    return
  fi
  if [ "${DRY_RUN}" = "1" ]; then
    echo "[DRY-RUN] aws s3 ls ${S3_BUCKET}/ | awk '{print \$4}' | ... | xargs aws s3 rm --recursive"
    return
  fi
  local s3_args=()
  if [ -n "${S3_ENDPOINT}" ]; then
    s3_args+=(--endpoint-url "${S3_ENDPOINT}")
  fi
  local cutoff=$(date -d "-${BACKUP_RETAIN_DAYS} days" -u +%Y%m%d)
  aws "${s3_args[@]}" s3 ls "${S3_BUCKET}/" 2>/dev/null \
    | awk '{print $4}' \
    | while read -r prefix; do
        [ -z "${prefix}" ] && continue
        local pdate=${prefix%/}
        if [[ "${pdate}" < "${cutoff}" ]]; then
          log "  删除远端：${S3_BUCKET}/${prefix}"
          aws "${s3_args[@]}" s3 rm "${S3_BUCKET}/${prefix}" --recursive >/dev/null
        fi
      done || true
}

main() {
  log "===== OpenBuddy 备份开始 ====="
  log "  BACKUP_DIR=${BACKUP_DIR}  RETAIN=${BACKUP_RETAIN_DAYS}d  DRY_RUN=${DRY_RUN}"
  log "  PG=${PG_HOST}:${PG_PORT}/${PG_DB}  S3=${S3_BUCKET:-<none>}"
  validate_env
  dump_postgres
  snapshot_gateway_data
  upload_to_s3
  prune_local
  prune_s3
  log "===== OpenBuddy 备份完成 ====="
}

main "$@"
