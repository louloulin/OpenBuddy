#!/usr/bin/env bash
# scripts/audit/pi-sdk-usage.sh
#
# Pi-native baseline audit for OpenBuddy 五期（plan4.1.md §1 / Phase A.1）.
#
# 用纯 grep/awk/sed 生成 baseline 数字，不需要 node/pnpm.
# 默认输出：stdout 人类可读表格 + stderr JSON baseline.
# JSON 可被 CI 进一步消费：`bash scripts/audit/pi-sdk-usage.sh --json`.
#
# Usage:
#   bash scripts/audit/pi-sdk-usage.sh                # human table + JSON on stderr
#   bash scripts/audit/pi-sdk-usage.sh --json         # 只输出 JSON（stdout）
#   bash scripts/audit/pi-sdk-usage.sh --root <dir>  # 指定 OpenBuddy 根目录
#
# Exit codes:
#   0  audit ran（gates intentionally non-fatal; the script is informative）
#   1  root 不存在 / 参数错误
#
# plan4.1.md §5 GA 门（reuse ≥70%、29/29 e2e、pi-bridge ≥80%）引用本脚本输出。

set -euo pipefail

ROOT="${OPENBUDDY_ROOT:-$(cd "$(dirname "$0")/../.." && pwd -P)}"
JSON_ONLY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --json) JSON_ONLY=1 ;;
    --root) ROOT="$2"; shift ;;
    -h|--help)
      sed -n '2,28p' "$0"; exit 0
      ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
  shift
done

if [ ! -d "$ROOT" ]; then
  echo "OpenBuddy root not found: $ROOT" >&2; exit 1
fi

cd "$ROOT"

# common grep excludes
GREP_EXCLUDES=(
  --exclude-dir=node_modules
  --exclude-dir=dist
  --exclude-dir=build
  --exclude-dir=.git
  --exclude-dir=out
  --exclude-dir=coverage
  --exclude-dir=.vite
  --exclude-dir=.turbo
)

# ---------- 1) unique pi packages ----------
PI_PKG_FILE=$(mktemp)
{ grep -rEho 'from "[@](earendil-works|mariozechner)/pi-[a-z0-9_-]+"' "${GREP_EXCLUDES[@]}" \
    --include="*.ts" --include="*.tsx" --include="*.mjs" \
    electron/ packages/ src/ scripts/ 2>/dev/null \
    | sed -E 's/^from "([@a-z0-9_-]+\/pi-[a-z0-9_-]+)"$/\1/' ;
  grep -rEho 'from "pi-[a-z0-9_-]+"' "${GREP_EXCLUDES[@]}" \
    --include="*.ts" --include="*.tsx" --include="*.mjs" \
    electron/ packages/ src/ scripts/ 2>/dev/null \
    | sed -E 's/^from "(pi-[a-z0-9_-]+)"$/\1/' ;
} | sort -u > "$PI_PKG_FILE" || true
PI_PACKAGE_COUNT=$(wc -l < "$PI_PKG_FILE" | tr -d ' ')

# ---------- 2) unique imported pi symbols ----------
PI_SYM_FILE=$(mktemp)
grep -rEh 'import \{[^}]+\} from "@earendil-works/' \
  "${GREP_EXCLUDES[@]}" \
  --include="*.ts" --include="*.tsx" --include="*.mjs" \
  electron/ packages/ src/ scripts/ 2>/dev/null \
  | sed -E 's/.*import \{([^}]+)\}.*/\1/' \
  | tr ',' '\n' \
  | sed -E 's/^ +//; s/ +$//' \
  | sed -E 's/^type +//; s/ +as +[A-Za-z_$][A-Za-z0-9_$]*$//' \
  | grep -v '^$' \
  | sort -u > "$PI_SYM_FILE" || true
PI_SYMBOL_COUNT=$(wc -l < "$PI_SYM_FILE" | tr -d ' ')

# ---------- 3) raw import statements + files importing pi ----------
PI_IMPORT_STATEMENTS=$(grep -rE 'from "@earendil-works/' \
  "${GREP_EXCLUDES[@]}" \
  --include="*.ts" --include="*.tsx" --include="*.mjs" \
  -c electron/ packages/ src/ scripts/ 2>/dev/null \
  | awk -F: '{ s += $2 } END { print s+0 }')

PI_FILES=$(grep -rEl 'from "@earendil-works/' \
  "${GREP_EXCLUDES[@]}" \
  --include="*.ts" --include="*.tsx" --include="*.mjs" \
  electron/ packages/ src/ scripts/ 2>/dev/null \
  | wc -l | tr -d ' ')

# ---------- 4) pi-bridge IPC channels registered ----------
PI_BRIDGE_FILE="electron/main/agent/pi-bridge/index.ts"
PI_BRIDGE_CHANNELS=0
if [ -f "$PI_BRIDGE_FILE" ]; then
  PI_BRIDGE_CHANNELS=$(grep -cE '^[[:space:]]*ipcMain\.handle\(' "$PI_BRIDGE_FILE" || echo 0)
fi

# ---------- 5) pi-bridge renderer consumers ----------
PI_BRIDGE_CONSUMERS=$(grep -rEn 'bridge\.(text|image|skills)\.[a-zA-Z]+[[:space:]]*\(' \
  "${GREP_EXCLUDES[@]}" \
  --include="*.ts" --include="*.tsx" \
  src/lib/agent/pi-client.ts src/components/ packages/ui 2>/dev/null \
  | grep -v '__tests__' \
  | grep -v 'pi-bridge-client' \
  | wc -l | tr -d ' ')

# ---------- 6) dead channels ----------
PI_BRIDGE_DEAD=$((PI_BRIDGE_CHANNELS - PI_BRIDGE_CONSUMERS))
[ "$PI_BRIDGE_DEAD" -lt 0 ] && PI_BRIDGE_DEAD=0

# ---------- 7) canonical pi packages declared ----------
CANON_FILE="electron/main/agent/pi-extension-discovery.ts"
CANON_COUNT=0
if [ -f "$CANON_FILE" ]; then
  CANON_COUNT=$(awk '/CANONICAL_PI_PACKAGES.*=.*\[/,/^\];/' "$CANON_FILE" \
    | grep -cE '^[[:space:]]+"[^"]+"' || echo 0)
fi

# ---------- 8) self-implementation hotspots ----------
HOT_APPLY_PATCH=$(wc -l < electron/main/agent/extensions/apply-patch.ts 2>/dev/null || echo 0)
HOT_SETTINGS=$(wc -l < packages/runtime/openbuddy-storage/src/sqlite/settings-store.ts 2>/dev/null || echo 0)
HOT_PROFILE=$(wc -l < packages/runtime/openbuddy-plugin-host/src/profile-manager.ts 2>/dev/null || echo 0)

# ---------- 9) canonical packages with e2e coverage ----------
# NOTE: with set -euo pipefail, an empty `find` pipeline may exit non-zero
# via pipefail even when each stage is individually OK; guard with || true.
CANON_E2E_FILES=$(find tests -name 'real-pi-package-*.test.ts' -type f 2>/dev/null \
  | wc -l | tr -d ' ') || CANON_E2E_FILES=0
if [ "$CANON_E2E_FILES" = "0" ]; then
  CANON_E2E_FILES=$(find . -path ./node_modules -prune -o -name 'real-pi-package-*.test.ts' -type f -print 2>/dev/null \
    | grep -v '^./node_modules' | wc -l | tr -d ' ') || CANON_E2E_FILES=0
fi

# ---------- 10) utilization ----------
if [ "$PI_BRIDGE_CHANNELS" -gt 0 ]; then
  PI_BRIDGE_UTIL_PCT=$(awk -v c="$PI_BRIDGE_CONSUMERS" -v t="$PI_BRIDGE_CHANNELS" \
    'BEGIN { printf "%.0f", (c/t)*100 }')
else
  PI_BRIDGE_UTIL_PCT=0
fi

# ---------- emit JSON ----------
TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
PKG_JSON=$(awk 'NF { printf "\"%s\",", $0 }' "$PI_PKG_FILE" | sed 's/,$//' \
  | awk 'BEGIN{printf "["} {printf "%s", $0} END{print "]"}')
[ -z "$(cat "$PI_PKG_FILE" 2>/dev/null | grep -v '^$')" ] && PKG_JSON="[]"

JSON="{\"schemaVersion\":1,\"generatedAt\":\"$TS\",\"root\":\"$ROOT\",\"piPackages\":$PI_PACKAGE_COUNT,\"piPackagesList\":$PKG_JSON,\"piSymbols\":$PI_SYMBOL_COUNT,\"piSymbolStatements\":$PI_IMPORT_STATEMENTS,\"piFiles\":$PI_FILES,\"piBridge\":{\"channels\":$PI_BRIDGE_CHANNELS,\"rendererConsumers\":$PI_BRIDGE_CONSUMERS,\"deadChannels\":$PI_BRIDGE_DEAD,\"utilizationPct\":$PI_BRIDGE_UTIL_PCT,\"gaGate\":\">=80%\"},\"canonicalPackages\":{\"declared\":$CANON_COUNT,\"e2eFiles\":$CANON_E2E_FILES,\"gaGate\":\"$CANON_COUNT/$CANON_COUNT e2e\"},\"hotspots\":{\"applyPatch\":$HOT_APPLY_PATCH,\"settingsStore\":$HOT_SETTINGS,\"profileManager\":$HOT_PROFILE}}"

# Capture human-readable list BEFORE cleaning up
PKG_LIST_DISPLAY=""
while IFS= read -r line; do
  PKG_LIST_DISPLAY="${PKG_LIST_DISPLAY}  · ${line}"$'\n'
done < "$PI_PKG_FILE"
if [ -z "$PKG_LIST_DISPLAY" ]; then PKG_LIST_DISPLAY=$'  (none)\n'; fi

rm -f "$PI_PKG_FILE" "$PI_SYM_FILE"

if [ "$JSON_ONLY" -eq 1 ]; then
  echo "$JSON"
  exit 0
fi

# stderr JSON for piping
echo "$JSON" >&2

cat <<EOF
┌──────────────────────────────────────────────────────────────────────┐
│  OpenBuddy Pi-SDK Baseline Audit (Phase A.1)         $TS  │
└──────────────────────────────────────────────────────────────────────┘
PI packages imported       : $PI_PACKAGE_COUNT
${PKG_LIST_DISPLAY}Unique pi symbols          : $PI_SYMBOL_COUNT       (raw count; reuse % measured separately)
Pi import statements       : $PI_IMPORT_STATEMENTS
Files importing pi         : $PI_FILES

PI-bridge IPC channels     : $PI_BRIDGE_CHANNELS
PI-bridge renderer usage   : $PI_BRIDGE_CONSUMERS  (bridge.text/image/skills.X calls in src/)
PI-bridge DEAD channels    : $PI_BRIDGE_DEAD
PI-bridge utilization      : ${PI_BRIDGE_UTIL_PCT}%    GA gate: ≥80%

Canonical pi packages      : $CANON_COUNT declared, $CANON_E2E_FILES e2e files    GA gate: ${CANON_COUNT}/${CANON_COUNT} e2e

Self-implemented hotspots:
  electron/main/agent/extensions/apply-patch.ts                 $HOT_APPLY_PATCH LOC
  packages/runtime/openbuddy-storage/src/sqlite/settings-store.ts $HOT_SETTINGS LOC
  packages/runtime/openbuddy-plugin-host/src/profile-manager.ts   $HOT_PROFILE LOC

Plan4.1.md GA gates (§5):
  pi reuse ≥70%            — measured separately
  pi-bridge utilization ≥80%  — current ${PI_BRIDGE_UTIL_PCT}%
  ${CANON_COUNT}/${CANON_COUNT} canonical e2e     — current $CANON_E2E_FILES / $CANON_COUNT
EOF

exit 0
