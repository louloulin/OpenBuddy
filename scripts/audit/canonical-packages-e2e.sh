#!/usr/bin/env bash
# scripts/audit/canonical-packages-e2e.sh
#
# 列出 CANONICAL_PI_PACKAGES 中每个 package 是否在仓库里有真实 e2e / integration
# 测试，并打印缺口（plan4.1.md Phase E + GA gate "29/29 e2e"）.
#
# 判定方式：每个 canonical package name 在 tests/ 下至少有 1 个匹配的 e2e/smoke
# 用例（按文件名 `<pkg>-*.test.ts` 或 `real-pi-package-<pkg>.test.ts` 命中，
# 再加一个 content grep 兜底）。这是 plan4.1.md §3 Phase E 的入口脚本。
#
# 用纯 grep/awk/sed/find 实现，runnable 在任何带 bash + grep + find 的环境。
#
# Usage:
#   bash scripts/audit/canonical-packages-e2e.sh
#   bash scripts/audit/canonical-packages-e2e.sh --json
#   bash scripts/audit/canonical-packages-e2e.sh --root <dir>

set -euo pipefail

ROOT="${OPENBUDDY_ROOT:-$(cd "$(dirname "$0")/../.." && pwd -P)}"
JSON_ONLY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --json) JSON_ONLY=1 ;;
    --root) ROOT="$2"; shift ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
  shift
done

if [ ! -d "$ROOT" ]; then
  echo "OpenBuddy root not found: $ROOT" >&2; exit 1
fi
cd "$ROOT"

CANON_FILE="electron/main/agent/pi-extension-discovery.ts"
if [ ! -f "$CANON_FILE" ]; then
  echo "missing $CANON_FILE" >&2; exit 1
fi

# 提取 CANONICAL_PI_PACKAGES 块里的每个 pkg 名
PKG_TMP=$(mktemp)
awk '/CANONICAL_PI_PACKAGES.*=.*\[/,/^\];/' "$CANON_FILE" \
  | grep -E '^[[:space:]]+"[^"]+"' \
  | sed -E 's/^[[:space:]]+"(.*)",?[[:space:]]*$/\1/' > "$PKG_TMP" || true

TOTAL=$(wc -l < "$PKG_TMP" | tr -d ' ')
COVERED=0
MISSING_LIST=""

# JSON array buffer
JSON_ARR=""

while IFS= read -r pkg; do
  [ -z "$pkg" ] && continue
  # sanitize for filename match (drop @scope/)
  safe=$(echo "$pkg" | sed -E 's|^@||; s|/|--|g')

  has_e2e=0
  for pat in "tests/**/${pkg}-*.test.ts" \
             "tests/**/${pkg}*.test.ts" \
             "tests/**/real-pi-package-${pkg}.test.ts" \
             "tests/**/real-pi-package-${safe}.test.ts" \
             "tests/**/*${pkg}*.test.ts"; do
    # shellcheck disable=SC2086
    matches=$(find tests -type f -name "*${pkg}*.test.ts" 2>/dev/null \
      | head -3 | wc -l | tr -d ' ')
    if [ "$matches" -gt 0 ]; then
      has_e2e=1
      break
    fi
  done
  # content grep fallback: pi-mcp-adapter mentioned anywhere in tests/
  if [ "$has_e2e" -eq 0 ]; then
    if grep -rq --include="*.test.ts" --include="*.test.mjs" "$pkg" tests/ 2>/dev/null; then
      has_e2e=1
    fi
  fi

  if [ "$has_e2e" -eq 1 ]; then
    COVERED=$((COVERED + 1))
    status="covered"
  else
    MISSING_LIST="${MISSING_LIST}  ✗ ${pkg}"$'\n'
    status="missing"
  fi

  JSON_ARR="${JSON_ARR}{\"package\":\"$pkg\",\"e2e\":\"$status\"},"
done < "$PKG_TMP"

JSON_ARR_CLEAN=$(echo "$JSON_ARR" | sed 's/,$//')

TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
JSON="{\"schemaVersion\":1,\"generatedAt\":\"$TS\",\"root\":\"$ROOT\",\"total\":$TOTAL,\"covered\":$COVERED,\"missing\":$((TOTAL - COVERED)),\"gaGate\":\"$TOTAL/$TOTAL\",\"packages\":[$JSON_ARR_CLEAN]}"

if [ "$JSON_ONLY" -eq 1 ]; then
  echo "$JSON"
  rm -f "$PKG_TMP"
  exit 0
fi

echo "$JSON" >&2

cat <<EOF
┌──────────────────────────────────────────────────────────────────────┐
│  Canonical Pi Packages E2E Coverage         $TS  │
└──────────────────────────────────────────────────────────────────────┘
Total declared             : $TOTAL
Covered (e2e file or content grep): $COVERED
Missing                    : $((TOTAL - COVERED))
GA gate                    : ${TOTAL}/${TOTAL} e2e

Missing packages:
${MISSING_LIST:-  (all covered)}
EOF

rm -f "$PKG_TMP"
exit 0
