#!/usr/bin/env bash
# Wrapper around electron-builder that:
#   1. Sets the npmmirror app-builder-binaries mirror by default.
#   2. Forwards all arguments to electron-builder.
#
# Why: electron-builder downloads `app-builder-bin` from
# `github.com/develar/app-builder-bin/releases` by default, which is slow
# or unreliable from many networks (including most CN networks). The mirror
# env var must be set BEFORE electron-builder starts (it is read at
# module-load time). npm config cannot set it, so we wrap the binary.
#
# Override mirrors:
#   - ELECTRON_BUILDER_BINARIES_MIRROR=https://other-mirror/path
#   - ELECTRON_MIRROR=https://other-mirror/path (also read by Electron
#     itself; electron-builder.yml also has `electronDownload.mirror`).
#
# Force the GitHub default:
#   - ELECTRON_BUILDER_BINARIES_MIRROR="" ./scripts/electron-builder.sh ...
#
# This script intentionally lives in scripts/ (not scripts/electron/) so
# moon task commands stay short (`./scripts/electron-builder.sh ...`).

set -euo pipefail

if [[ -z "${ELECTRON_BUILDER_BINARIES_MIRROR:-}" ]]; then
  export ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"
fi

# Resolve the local electron-builder binary so we don't depend on PATH
# inside moon's task runner.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

ELECTRON_BUILDER_BIN="${REPO_ROOT}/node_modules/.bin/electron-builder"
if [[ ! -x "${ELECTRON_BUILDER_BIN}" ]]; then
  echo "electron-builder not found at ${ELECTRON_BUILDER_BIN}; run 'pnpm install' first" >&2
  exit 1
fi

exec "${ELECTRON_BUILDER_BIN}" "$@"
