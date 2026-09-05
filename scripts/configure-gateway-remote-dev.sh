#!/usr/bin/env bash
# Configure the remote development Gateway with a short-lived New API token.
# Secrets travel over SSH stdin, are never put in command arguments or logs,
# and are written only to the remote .env file with mode 0600.
#
# Required:
#   DEPLOY_SSH_HOST=... DEPLOY_SSH_USER=... DEPLOY_SSH_KEY=...
#   NEW_API_TOKEN=... NEW_API_CAPABILITIES_JSON=...
#
# Optional:
#   DEPLOY_REMOTE_DIR=/opt/service/openbuddy
#   NEW_API_GROUP=default
#   CASDOOR_AUDIENCE=<Casdoor application client id>

set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
remote_host=${DEPLOY_SSH_HOST:-}
remote_user=${DEPLOY_SSH_USER:-}
ssh_key=${DEPLOY_SSH_KEY:-}
remote_dir=${DEPLOY_REMOTE_DIR:-/opt/service/openbuddy}
group=${NEW_API_GROUP:-default}
casdoor_audience=${CASDOOR_AUDIENCE:-}
token=${NEW_API_TOKEN:-}
capabilities=${NEW_API_CAPABILITIES_JSON:-}
release_version=${DEPLOY_VERSION:-$(git -C "${repo_root}" rev-parse --short=12 HEAD)}

die() { printf 'configure-gateway-remote-dev: %s\n' "$1" >&2; exit 2; }
for command in jq ssh; do
  command -v "${command}" >/dev/null 2>&1 || die "missing command: ${command}"
done
[[ -n "${remote_host}" ]] || die "DEPLOY_SSH_HOST is required"
[[ -n "${remote_user}" ]] || die "DEPLOY_SSH_USER is required"
[[ -f "${ssh_key}" ]] || die "DEPLOY_SSH_KEY does not exist"
[[ "${remote_dir}" =~ ^/[a-zA-Z0-9._/-]+$ ]] || die "DEPLOY_REMOTE_DIR is invalid"
[[ "${group}" =~ ^[a-zA-Z0-9_.:-]{1,80}$ ]] || die "NEW_API_GROUP is invalid"
[[ "${casdoor_audience}" =~ ^[a-zA-Z0-9._:-]{1,160}$ ]] || die "CASDOOR_AUDIENCE is required and invalid"
[[ ${#token} -ge 32 ]] || die "NEW_API_TOKEN must be at least 32 characters"
[[ -n "${capabilities}" ]] || die "NEW_API_CAPABILITIES_JSON is required"
[[ "${release_version}" =~ ^[a-zA-Z0-9._-]{1,80}$ ]] || die "DEPLOY_VERSION is invalid"

if ! jq -n -e --arg group "${group}" --argjson capabilities "${capabilities}" '
  ($capabilities | type) == "object" and
  ($capabilities | keys) == [$group] and
  ($capabilities[$group] | type) == "object" and
  (($capabilities[$group] | length) > 0) and
  ([ $capabilities[$group][] | to_entries[] | .value | select(.supported == true) ] | length > 0) and
  ([ $capabilities[$group][] | to_entries[] | .value | select(.supported == true) ] | all(
    .usage == "required" and
    (.verifiedAt | type == "string") and
    (.verifiedAt | test("^[0-9]{4}-[0-9]{2}-[0-9]{2}$"))
  ))
' >/dev/null 2>&1; then
  die "NEW_API_CAPABILITIES_JSON must contain exactly one Group with verified billable capabilities"
fi

payload=$(jq -cn --arg token "${token}" --arg group "${group}" --arg audience "${casdoor_audience}" --arg version "${release_version}" --argjson capabilities "${capabilities}" \
  '{token:$token,group:$group,casdoorAudience:$audience,version:$version,capabilities:$capabilities}')

target="${remote_user}@${remote_host}"
ssh_args=(-i "${ssh_key}" -o BatchMode=yes -o ConnectTimeout=10)
printf 'Checking remote Docker Compose (secrets are not printed)\n'
ssh "${ssh_args[@]}" "${target}" "test -f '${remote_dir}/.env.remote-dev' && command -v docker >/dev/null && docker compose version >/dev/null"

printf 'Applying short-lived New API configuration to remote development stack\n'
printf '%s' "${payload}" | ssh "${ssh_args[@]}" "${target}" \
  "sudo -n python3 -c 'import json, os, pathlib, tempfile, sys; p=json.load(sys.stdin); path=pathlib.Path(sys.argv[1]) / \".env.remote-dev\"; text=path.read_text(); updates={\"CASDOOR_AUDIENCE\":p[\"casdoorAudience\"],\"NEW_API_TOKEN\":p[\"token\"],\"NEW_API_GROUP\":p[\"group\"],\"RESOURCE_GATEWAY_VERSION\":p[\"version\"],\"NEW_API_GROUP_TOKENS_JSON\":json.dumps({p[\"group\"]:p[\"token\"]}, separators=(\",\",\":\")),\"NEW_API_CAPABILITIES_JSON\":json.dumps(p[\"capabilities\"], separators=(\",\",\":\"))}; lines=text.splitlines(); seen=set(); out=[]; [out.append((line.split(\"=\",1)[0]+\"=\"+updates[line.split(\"=\",1)[0]]) if line.split(\"=\",1)[0] in updates else line) or seen.add(line.split(\"=\",1)[0]) for line in lines]; out.extend(key+\"=\"+value for key,value in updates.items() if key not in seen); fd,tmp=tempfile.mkstemp(prefix=\".env.remote-dev.\", dir=str(path.parent), text=True); os.fchmod(fd,0o600); os.write(fd,(\"\\n\".join(out)+\"\\n\").encode()); os.close(fd); os.replace(tmp,path); os.chmod(path,0o600)' '${remote_dir}'"

printf 'Recreating remote development Gateway\n'
ssh "${ssh_args[@]}" "${target}" \
  "sudo -n docker compose --env-file '${remote_dir}/.env.remote-dev' -f '${remote_dir}/docker-compose.remote-dev.yml' config --quiet && sudo -n docker compose --env-file '${remote_dir}/.env.remote-dev' -f '${remote_dir}/docker-compose.remote-dev.yml' up -d --force-recreate && for attempt in \$(seq 1 30); do curl -fsS --max-time 2 http://127.0.0.1:8787/readyz >/dev/null && break; sleep 1; done; health=\$(curl -fsS --max-time 2 http://127.0.0.1:8787/healthz) || { echo 'remote Gateway did not become ready' >&2; sudo -n docker compose --env-file '${remote_dir}/.env.remote-dev' -f '${remote_dir}/docker-compose.remote-dev.yml' ps; sudo -n docker compose --env-file '${remote_dir}/.env.remote-dev' -f '${remote_dir}/docker-compose.remote-dev.yml' logs --tail=80 resource-gateway; exit 1; }; if printf '%s' \"\${health}\" | grep -Fq '\"version\":\"${release_version}\"'; then exit 0; fi; printf 'Gateway health version mismatch; expected ${release_version}, response: %s\\n' \"\${health}\" >&2; sudo -n docker compose --env-file '${remote_dir}/.env.remote-dev' -f '${remote_dir}/docker-compose.remote-dev.yml' ps; sudo -n docker compose --env-file '${remote_dir}/.env.remote-dev' -f '${remote_dir}/docker-compose.remote-dev.yml' logs --tail=80 resource-gateway; exit 1"

printf 'Remote development Gateway configuration applied; secrets were not printed\n'
