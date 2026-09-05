#!/usr/bin/env bash
# Install the New API capability snapshot and reconciliation timers.
# This script never uploads environment files, mapping files, or secrets.
# Dry-run is the default; set DEPLOY_APPLY=1 to install files remotely.

set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
ssh_host=${DEPLOY_SSH_HOST:-}
ssh_user=${DEPLOY_SSH_USER:-}
ssh_key=${DEPLOY_SSH_KEY:-}
ssh_port=${DEPLOY_SSH_PORT:-22}
remote_runtime_dir=${WORKER_REMOTE_RUNTIME_DIR:-/opt/service/openbuddy}
remote_etc_dir=${WORKER_REMOTE_ETC_DIR:-/etc/openbuddy}
apply=${DEPLOY_APPLY:-0}
enable_timers=${WORKER_ENABLE_TIMERS:-0}

die() { printf 'install-new-api-worker-remote: %s\n' "$1" >&2; exit 2; }
require_command() { command -v "$1" >/dev/null 2>&1 || die "missing command: $1"; }

[[ -n "${ssh_host}" ]] || die "DEPLOY_SSH_HOST is required"
[[ -n "${ssh_user}" ]] || die "DEPLOY_SSH_USER is required"
[[ -n "${ssh_key}" ]] || die "DEPLOY_SSH_KEY is required"
[[ -f "${ssh_key}" ]] || die "DEPLOY_SSH_KEY does not exist"
[[ "${apply}" == "0" || "${apply}" == "1" ]] || die "DEPLOY_APPLY must be 0 or 1"
[[ "${enable_timers}" == "0" || "${enable_timers}" == "1" ]] || die "WORKER_ENABLE_TIMERS must be 0 or 1"
[[ "${ssh_port}" =~ ^[0-9]+$ && "${ssh_port}" -ge 1 && "${ssh_port}" -le 65535 ]] || die "DEPLOY_SSH_PORT is invalid"
[[ "${remote_runtime_dir}" =~ ^/[a-zA-Z0-9._/-]+$ ]] || die "WORKER_REMOTE_RUNTIME_DIR is invalid"
[[ "${remote_etc_dir}" =~ ^/[a-zA-Z0-9._/-]+$ ]] || die "WORKER_REMOTE_ETC_DIR is invalid"
[[ "${remote_runtime_dir}" == "/opt/service/openbuddy" ]] || die "WORKER_REMOTE_RUNTIME_DIR must be /opt/service/openbuddy because systemd units use the canonical path"

require_command ssh
require_command tar
require_command bash

files=(
  scripts/new-api-capability-snapshot.mjs
  scripts/new-api-reconciliation-worker.mjs
  scripts/check-reconciliation-heartbeat.mjs
  scripts/validate-new-api-capability-snapshot.mjs
  scripts/validate-capability-snapshot-install.sh
  scripts/validate-reconciliation-worker-install.sh
  deploy/openbuddy-new-api-capability-snapshot.service
  deploy/openbuddy-new-api-capability-snapshot.timer
  deploy/openbuddy-new-api-reconciliation-worker.service
  deploy/openbuddy-new-api-reconciliation-worker.timer
  deploy/openbuddy-new-api-reconciliation-watchdog.service
  deploy/openbuddy-new-api-reconciliation-watchdog.timer
  scripts/credit-expiry-worker.mjs
  deploy/openbuddy-credit-expiry-worker.service
  deploy/openbuddy-credit-expiry-worker.timer
  deploy/credit-expiry-worker.env.example
)
for file in "${files[@]}"; do
  [[ -f "${repo_root}/${file}" ]] || die "required repository file is missing: ${file}"
done
grep -Fq 'validate-new-api-capability-snapshot.mjs' "${repo_root}/scripts/new-api-reconciliation-worker.mjs" \
  || die "Worker dependency contract changed; review the upload list"

target="${ssh_user}@${ssh_host}"
ssh_args=(-i "${ssh_key}" -p "${ssh_port}" -o BatchMode=yes -o ConnectTimeout=10)

printf 'Checking SSH and remote Node runtime (secrets are not printed)\n'
ssh "${ssh_args[@]}" "${target}" "command -v node >/dev/null && command -v systemctl >/dev/null"

if [[ "${apply}" == "0" ]]; then
  printf 'Dry-run passed; no files uploaded and no timers changed\n'
  printf 'Set DEPLOY_APPLY=1 to install the Worker runtime\n'
  exit 0
fi

printf 'Uploading Worker scripts and unit templates to %s\n' "${remote_runtime_dir}"
tar -C "${repo_root}" -czf - "${files[@]}" | ssh "${ssh_args[@]}" "${target}" \
  "sudo -n mkdir -p '${remote_runtime_dir}' && sudo -n tar -xzf - -C '${remote_runtime_dir}'"

printf 'Installing systemd units and validating the existing secret files\n'
ssh "${ssh_args[@]}" "${target}" "sudo -n install -d -m 0755 '${remote_etc_dir}' && \
  sudo -n install -o root -g root -m 0644 '${remote_runtime_dir}/deploy/openbuddy-new-api-capability-snapshot.service' /etc/systemd/system/openbuddy-new-api-capability-snapshot.service && \
  sudo -n install -o root -g root -m 0644 '${remote_runtime_dir}/deploy/openbuddy-new-api-capability-snapshot.timer' /etc/systemd/system/openbuddy-new-api-capability-snapshot.timer && \
  sudo -n install -o root -g root -m 0644 '${remote_runtime_dir}/deploy/openbuddy-new-api-reconciliation-worker.service' /etc/systemd/system/openbuddy-new-api-reconciliation-worker.service && \
  sudo -n install -o root -g root -m 0644 '${remote_runtime_dir}/deploy/openbuddy-new-api-reconciliation-worker.timer' /etc/systemd/system/openbuddy-new-api-reconciliation-worker.timer && \
  sudo -n install -o root -g root -m 0644 '${remote_runtime_dir}/deploy/openbuddy-new-api-reconciliation-watchdog.service' /etc/systemd/system/openbuddy-new-api-reconciliation-watchdog.service && \
  sudo -n install -o root -g root -m 0644 '${remote_runtime_dir}/deploy/openbuddy-new-api-reconciliation-watchdog.timer' /etc/systemd/system/openbuddy-new-api-reconciliation-watchdog.timer openbuddy-credit-expiry-worker.timer && \
  sudo -n systemctl daemon-reload && \
  sudo -n env CAPABILITY_SNAPSHOT_ENV_FILE='${remote_etc_dir}/new-api-reconciliation-worker.env' CAPABILITY_SNAPSHOT_UNIT_FILE=/etc/systemd/system/openbuddy-new-api-capability-snapshot.service CAPABILITY_SNAPSHOT_RUNTIME_DIR='${remote_runtime_dir}' bash '${remote_runtime_dir}/scripts/validate-capability-snapshot-install.sh' && \
  sudo -n env WORKER_ENV_FILE='${remote_etc_dir}/new-api-reconciliation-worker.env' WORKER_MAPPING_FILE='${remote_etc_dir}/new-api-tenant-subject-map.json' WORKER_UNIT_FILE=/etc/systemd/system/openbuddy-new-api-reconciliation-worker.service WORKER_WATCHDOG_UNIT_FILE=/etc/systemd/system/openbuddy-new-api-reconciliation-watchdog.service WORKER_RUNTIME_DIR='${remote_runtime_dir}' bash '${remote_runtime_dir}/scripts/validate-reconciliation-worker-install.sh' && \
  sudo -n install -o root -g root -m 0644 '${remote_runtime_dir}/deploy/openbuddy-credit-expiry-worker.service' /etc/systemd/system/openbuddy-credit-expiry-worker.service && \
  sudo -n install -o root -g root -m 0644 '${remote_runtime_dir}/deploy/openbuddy-credit-expiry-worker.timer' /etc/systemd/system/openbuddy-credit-expiry-worker.timer && \
  sudo -n env EXPIRY_ENV_FILE='${remote_etc_dir}/credit-expiry-worker.env' EXPIRY_UNIT_FILE=/etc/systemd/system/openbuddy-credit-expiry-worker.service EXPIRY_RUNTIME_DIR='${remote_runtime_dir}' bash '${remote_runtime_dir}/scripts/validate-credit-expiry-worker-install.sh'"

if [[ "${enable_timers}" == "1" ]]; then
  printf 'Enabling capability snapshot and reconciliation timers\n'
  ssh "${ssh_args[@]}" "${target}" "sudo -n systemctl enable --now openbuddy-new-api-capability-snapshot.timer openbuddy-new-api-reconciliation-worker.timer openbuddy-new-api-reconciliation-watchdog.timer openbuddy-credit-expiry-worker.timer && \
    sudo -n systemctl is-active --quiet openbuddy-new-api-capability-snapshot.timer && \
    sudo -n systemctl is-active --quiet openbuddy-new-api-reconciliation-worker.timer && \
    sudo -n systemctl is-active --quiet openbuddy-new-api-reconciliation-watchdog.timer && \
    sudo -n systemctl is-active --quiet openbuddy-credit-expiry-worker.timer"
else
  printf 'Units installed; timers remain disabled (set WORKER_ENABLE_TIMERS=1 to enable)\n'
fi

printf 'New API Worker installation completed; no secrets were uploaded by this script\n'
