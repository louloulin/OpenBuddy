#!/usr/bin/env bash
# Deploy the production Resource Gateway to a remote Docker host.
#
# Dry-run (default):
#   DEPLOY_SSH_HOST=203.0.113.10 \
#   DEPLOY_SSH_USER=deploy \
#   DEPLOY_SSH_KEY=~/.ssh/openbuddy-prod \
#   DEPLOY_ENV_FILE=/secure/openbuddy/.env.production \
#   bash scripts/deploy-gateway-remote.sh
#
# Apply changes only when explicitly enabled:
#   DEPLOY_APPLY=1 ... bash scripts/deploy-gateway-remote.sh
#
# The environment file is uploaded directly to the remote host with mode 0600,
# is never printed, and is never copied into the repository.

set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
service_dir="${repo_root}/services/casdoor-resource-gateway"
ssh_host=${DEPLOY_SSH_HOST:-}
ssh_user=${DEPLOY_SSH_USER:-}
ssh_key=${DEPLOY_SSH_KEY:-}
env_file=${DEPLOY_ENV_FILE:-${service_dir}/.env.production}
remote_dir=${DEPLOY_REMOTE_DIR:-/opt/service/openbuddy}
apply=${DEPLOY_APPLY:-0}
ssh_port=${DEPLOY_SSH_PORT:-22}
release_version=${DEPLOY_VERSION:-$(git -C "${repo_root}" rev-parse --short=12 HEAD)}

die() { printf 'deploy-gateway-remote: %s\n' "$1" >&2; exit 2; }
require_command() { command -v "$1" >/dev/null 2>&1 || die "missing command: $1"; }

[[ -n "${ssh_host}" ]] || die "DEPLOY_SSH_HOST is required"
[[ -n "${ssh_user}" ]] || die "DEPLOY_SSH_USER is required"
[[ -n "${ssh_key}" ]] || die "DEPLOY_SSH_KEY is required"
[[ -f "${ssh_key}" ]] || die "DEPLOY_SSH_KEY does not exist"
[[ -f "${env_file}" ]] || die "DEPLOY_ENV_FILE does not exist"
[[ "${apply}" == "0" || "${apply}" == "1" ]] || die "DEPLOY_APPLY must be 0 or 1"
[[ "${ssh_port}" =~ ^[0-9]+$ && "${ssh_port}" -ge 1 && "${ssh_port}" -le 65535 ]] || die "DEPLOY_SSH_PORT is invalid"
[[ "${remote_dir}" =~ ^/[a-zA-Z0-9._/-]+$ ]] || die "DEPLOY_REMOTE_DIR must be an absolute safe path"
[[ "${release_version}" =~ ^[a-zA-Z0-9._-]{1,80}$ ]] || die "DEPLOY_VERSION is invalid"

require_command ssh
require_command scp
require_command tar
require_command bash

if [[ ! -x "${repo_root}/scripts/validate-production-compose.sh" ]]; then
  die "production compose validator is not executable"
fi

printf 'Validating local production configuration (secrets are not printed)\n'
"${repo_root}/scripts/validate-production-compose.sh" "${env_file}"

target="${ssh_user}@${ssh_host}"
ssh_args=(-i "${ssh_key}" -p "${ssh_port}" -o BatchMode=yes -o ConnectTimeout=10)
scp_args=(-i "${ssh_key}" -P "${ssh_port}" -o BatchMode=yes -o ConnectTimeout=10)

printf 'Checking SSH and Docker Compose on %s\n' "${target}"
ssh "${ssh_args[@]}" "${target}" "test -d / && command -v docker >/dev/null && docker compose version >/dev/null"

if [[ "${apply}" == "0" ]]; then
  printf 'Dry-run passed; no files uploaded and no services changed\n'
  printf 'Set DEPLOY_APPLY=1 to upload and restart the production stack\n'
  exit 0
fi

printf 'Uploading Gateway source to %s (excluding secrets and build artifacts)\n' "${remote_dir}"
tar -C "${service_dir}" \
  --exclude='./.env.production' \
  --exclude='./node_modules' \
  --exclude='./dist' \
  --exclude='./*.log' \
  -czf - . | ssh "${ssh_args[@]}" "${target}" "mkdir -p '${remote_dir}' && tar -xzf - -C '${remote_dir}'"

printf 'Uploading production environment file with mode 0600\n'
scp "${scp_args[@]}" "${env_file}" "${target}:${remote_dir}/.env.production"
ssh "${ssh_args[@]}" "${target}" "chmod 600 '${remote_dir}/.env.production'"

printf 'Persisting release version in remote environment (value=%s)\n' "${release_version}"
ssh "${ssh_args[@]}" "${target}" "if grep -q '^RESOURCE_GATEWAY_VERSION=' '${remote_dir}/.env.production'; then sed -i 's/^RESOURCE_GATEWAY_VERSION=.*/RESOURCE_GATEWAY_VERSION=${release_version}/' '${remote_dir}/.env.production'; else printf '\\nRESOURCE_GATEWAY_VERSION=${release_version}\\n' >> '${remote_dir}/.env.production'; fi; chmod 600 '${remote_dir}/.env.production'"

printf 'Validating and applying Docker Compose stack\n'
ssh "${ssh_args[@]}" "${target}" "cd '${remote_dir}' && docker compose --env-file .env.production -f docker-compose.production.yml config --quiet && docker compose --env-file .env.production -f docker-compose.production.yml up -d --build"

printf 'Waiting for the remote Gateway readiness check\n'
ssh "${ssh_args[@]}" "${target}" "cd '${remote_dir}' && for attempt in \$(seq 1 30); do if docker compose --env-file .env.production -f docker-compose.production.yml exec -T resource-gateway wget -q -O - http://127.0.0.1:8787/readyz >/dev/null 2>&1; then exit 0; fi; sleep 2; done; docker compose --env-file .env.production -f docker-compose.production.yml ps; docker compose --env-file .env.production -f docker-compose.production.yml logs --tail=80 resource-gateway; exit 1"

printf 'Verifying the deployed Gateway release version\n'
ssh "${ssh_args[@]}" "${target}" "cd '${remote_dir}' && health=\$(docker compose --env-file .env.production -f docker-compose.production.yml exec -T resource-gateway wget -q -O - http://127.0.0.1:8787/healthz) && if printf '%s' \"\${health}\" | grep -Fq '\"version\":\"${release_version}\"'; then exit 0; fi; printf 'Gateway health version mismatch; expected ${release_version}, response: %s\\n' \"\${health}\" >&2; docker compose --env-file .env.production -f docker-compose.production.yml ps; docker compose --env-file .env.production -f docker-compose.production.yml logs --tail=80 resource-gateway; exit 1"

printf 'Remote Gateway deployment completed; secrets were not printed\n'
