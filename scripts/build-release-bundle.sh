#!/usr/bin/env bash
# Build an offline release bundle that the operator can manually upload.
#
# The bundle contains every script, systemd unit, env example and openapi
# spec that production deployment needs, plus a SHA256SUMS file. It does
# NOT contain the production env file, capability snapshot, tenant map,
# or any secret. The operator uploads the bundle via scp / rsync / Caddy
# file-server and runs `scripts/verify-remote-install.sh` on the target.
#
# Usage:
#   scripts/build-release-bundle.sh [output-dir]
#   scripts/build-release-bundle.sh /tmp/openbuddy-release
#
# Default output directory: ./out/release

set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
output_dir=${1:-${repo_root}/out/release}
release_version=${RELEASE_VERSION:-$(git -C "${repo_root}" rev-parse --short=12 HEAD)}
release_label=${RELEASE_LABEL:-openbuddy-release-${release_version}}
bundle_dir="${output_dir}/${release_label}"
archive_path="${output_dir}/${release_label}.tar.gz"
checksum_path="${output_dir}/${release_label}.sha256"
manifest_path="${output_dir}/${release_label}.manifest.json"

die() { printf 'build-release-bundle: %s\n' "$1" >&2; exit 2; }
require_command() { command -v "$1" >/dev/null 2>&1 || die "missing command: $1"; }

require_command git
require_command tar
require_command sha256sum
require_command awk
require_command jq

[[ "${release_version}" =~ ^[a-zA-Z0-9._-]{1,80}$ ]] || die "release version is invalid: ${release_version}"

bundle_files=(
  services/casdoor-resource-gateway/Dockerfile
  services/casdoor-resource-gateway/docker-compose.production.yml
  services/casdoor-resource-gateway/docker-compose.remote-dev.yml
  services/casdoor-resource-gateway/Caddyfile
  services/casdoor-resource-gateway/openapi.yaml
  services/casdoor-resource-gateway/README.md
  services/casdoor-resource-gateway/tsconfig.json
  services/casdoor-resource-gateway/package.json
  services/casdoor-resource-gateway/src/index.ts
  services/casdoor-resource-gateway/src/store.ts
  services/casdoor-resource-gateway/src/production-config.ts
  services/casdoor-resource-gateway/src/encryption.ts
  services/casdoor-resource-gateway/src/credit-ledger.ts
  
  services/casdoor-resource-gateway/src/trace.ts
  services/casdoor-resource-gateway/src/optional-drivers.d.ts
  scripts/deploy-gateway-remote.sh
  scripts/install-new-api-worker-remote.sh
  scripts/validate-production-compose.sh
  scripts/validate-capability-snapshot-install.sh
  scripts/validate-reconciliation-worker-install.sh
  scripts/validate-credit-expiry-worker-install.sh
  scripts/new-api-capability-snapshot.mjs
  scripts/new-api-reconciliation-worker.mjs
  scripts/check-reconciliation-heartbeat.mjs
  scripts/credit-expiry-worker.mjs
  scripts/audit-commercial-model.mjs
  scripts/audit-enterprise-release.mjs
  scripts/verify-tenant-boundaries.sh
  scripts/build-release-bundle.sh
  scripts/verify-remote-install.sh
  scripts/deploy-doctor.sh
  scripts/_section-credit-expiry.sh
  deploy/openbuddy-new-api-capability-snapshot.service
  deploy/openbuddy-new-api-capability-snapshot.timer
  deploy/openbuddy-new-api-reconciliation-worker.service
  deploy/openbuddy-new-api-reconciliation-worker.timer
  deploy/openbuddy-new-api-reconciliation-watchdog.service
  deploy/openbuddy-new-api-reconciliation-watchdog.timer
  deploy/openbuddy-credit-expiry-worker.service
  deploy/openbuddy-credit-expiry-worker.timer
  deploy/new-api-reconciliation-worker.env.example
  deploy/credit-expiry-worker.env.example
  deploy/openbuddy-commercial-model.example.json
  services/casdoor-resource-gateway/Caddyfile
  services/casdoor-resource-gateway/README.md
  services/casdoor-resource-gateway/docker-compose.example.yml
  services/casdoor-resource-gateway/docker-compose.remote-dev.yml
  docs/deployment-guide.md
  docs/casdoor-enterprise-auth.md
  docs/casdoor-new-api-openbuddy-commercial-architecture.md
  docs/casdoor-newapi-openbuddy-architecture-diagram.md
  docs/casdoor-newapi-openbuddy-architecture-diagram.svg
  docs/enterprise-casdoor-newapi-openbuddy-architecture.md
  docs/enterprise-completion-matrix.md
  docs/enterprise-live-verification-2026-08-29.md
  docs/enterprise-live-verification-2026-08-30.md
  docs/new-api-casdoor-openbuddy.md
  docs/new-api-channel-capability-matrix.md
  docs/openbuddy-commercial-model.md
  docs/token-billing-and-reconciliation-architecture.md
  docs/workbuddy-points-system-comparison.md
  docs/publish-checklist-v0.15.0.md
  CHANGELOG.md
)

mkdir -p "${bundle_dir}"
> "${checksum_path}"
> "${manifest_path}"

manifest_entries=()
for file in "${bundle_files[@]}"; do
  src="${repo_root}/${file}"
  if [[ ! -f "${src}" ]]; then
    die "required file missing in repository: ${file}"
  fi
  dest="${bundle_dir}/${file}"
  mkdir -p "$(dirname "${dest}")"
  cp -p "${src}" "${dest}"
  hash=$(sha256sum "${dest}" | awk '{ print $1 }')
  size=$(wc -c < "${dest}")
  printf '%s  %s\n' "${hash}" "${file}" >> "${checksum_path}"
  manifest_entries+=("$(jq -n --arg path "${file}" --arg sha256 "${hash}" --argjson size "${size}" '{path:$path,sha256:$sha256,size:$size}')")
done

jq -n \
  --arg version "${release_version}" \
  --arg label "${release_label}" \
  --arg sha "${release_version}" \
  --arg generated "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --argjson files "$(printf '%s\n' "${manifest_entries[@]}" | jq -s .)" \
  '{releaseVersion:$version,releaseLabel:$label,gitShortSha:$sha,generatedAt:$generated,files:$files}' > "${manifest_path}"

tar -C "${output_dir}" -czf "${archive_path}" "${release_label}"
sha256sum "${archive_path}" | awk '{ print $1 }' > "${archive_path}.sha256"

printf 'Release bundle generated:\n'
printf '  archive:   %s\n' "${archive_path}"
printf '  checksums: %s\n' "${checksum_path}"
printf '  manifest:  %s\n' "${manifest_path}"
printf '  contents:  %s files (no secrets)\n' "${#bundle_files[@]}"
