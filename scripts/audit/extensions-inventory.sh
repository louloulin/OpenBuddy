#!/usr/bin/env bash
# scripts/audit/extensions-inventory.sh — OpenBuddy ExtensionFactory / 扩展系统静态审计
#
# 作用：把 OpenBuddy 内部扩展系统（pi ExtensionAPI / ExtensionFactory / builtin 注册）
# 全部摸一遍：哪些文件、哪些 factory、哪些 builtin name、LOC、测试覆盖、与 G1/G10/G11 关系。
#
# 用法：
#   bash scripts/audit/extensions-inventory.sh         # 人读
#   bash scripts/audit/extensions-inventory.sh --json  # JSON
#
# 历史：2026-09-11 LUM-785 Round 6（继 4 个 audit 之后的第 5 个）

set -euo pipefail

MODE="human"
for a in "$@"; do
  case "$a" in
    --json) MODE="json" ;;
    --help|-h) sed -n '2,18p' "$0"; exit 0 ;;
    *) echo "unknown arg: $a" >&2; exit 2 ;;
  esac
done

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/../.." && pwd)
cd "$REPO_ROOT"

# ---------- categories ----------
EXT_DIR="electron/main/agent/extensions"
PI_EXT_FILE="electron/main/agent/pi-extensions.ts"
AGENT_DIR="electron/main/agent"

# guard wc
safe_lc() {
  local f="$1"
  [ -f "$f" ] && wc -l < "$f" || echo 0
}

# 1) extension files in electron/main/agent/extensions/
EXT_FILES=$(find "$EXT_DIR" -maxdepth 1 -name "*.ts" -not -name "*.test.ts" 2>/dev/null | sort)
EXT_FILE_COUNT=$(echo "$EXT_FILES" | grep -c . || true)
EXT_FILES_TOTAL_LOC=0
EXT_FILES_WITH_PI=0
EXT_FILES_WITH_PI_LIST=""

EXT_DETAIL_TSV=$(mktemp)
trap 'rm -f "$EXT_DETAIL_TSV"' EXIT

while IFS= read -r f; do
  [ -z "$f" ] && continue
  loc=$(safe_lc "$f")
  EXT_FILES_TOTAL_LOC=$((EXT_FILES_TOTAL_LOC + loc))
  pi_imports=$(grep -cE 'from\s+"@earendil-works/' "$f" 2>/dev/null || echo 0)
  if [ "$pi_imports" -gt 0 ]; then EXT_FILES_WITH_PI=$((EXT_FILES_WITH_PI + 1)); fi
  EXT_FILES_WITH_PI_LIST+="$f ($pi_imports pi imports),"
  printf "%s\t%s\t%s\n" "$f" "$loc" "$pi_imports" >> "$EXT_DETAIL_TSV"
done <<< "$EXT_FILES"

# 2) create*Extension factory functions (return type ExtensionFactory)
FACTORY_LINES=$(grep -rnE 'function\s+create[A-Z][a-zA-Z]*Extension\s*\(' \
  "$AGENT_DIR" "$EXT_DIR" 2>/dev/null | grep -v test || true)
FACTORY_COUNT=$(echo "$FACTORY_LINES" | grep -c . || true)

# 3) builtin extension names from pi-extensions.ts builtinPiExtensionFactories record
BUILTIN_NAMES=$(grep -E '^\s*"openbuddy-[a-z0-9-]+":\s*\(' "$PI_EXT_FILE" 2>/dev/null \
  | sed -E 's/^\s*"([^"]+)".*/\1/' | sort -u || true)
BUILTIN_COUNT=$(echo "$BUILTIN_NAMES" | grep -c . || true)

# 4) ExtensionFactory imports across whole repo (who consumes the API)
EF_CONSUMERS=$(grep -rlE 'ExtensionFactory|ExtensionAPI' electron packages src 2>/dev/null | grep -v test | sort -u | head -50)
EF_CONSUMER_COUNT=$(echo "$EF_CONSUMERS" | grep -c . || true)

# 5) tests for extensions
EXT_TEST_FILES=$(find "$EXT_DIR" -name "*.test.ts" 2>/dev/null | sort)
EXT_TEST_COUNT=$(echo "$EXT_TEST_FILES" | grep -c . || true)
PI_EXT_TEST=$(find . -maxdepth 4 -name "pi-extensions.test.ts" 2>/dev/null | head -1)
PI_EXT_TEST_LOC=$(safe_lc "$PI_EXT_TEST")

# 6) hotspot file LOC
APPLY_PATCH_LOC=$(safe_lc "$EXT_DIR/apply-patch.ts")
PI_EXT_LOC=$(safe_lc "$PI_EXT_FILE")
PROFILE_MGR_LOC=$(safe_lc "packages/runtime/openbuddy-plugin-host/src/profile-manager.ts")
SETTINGS_STORE_LOC=$(safe_lc "packages/runtime/openbuddy-storage/src/sqlite/settings-store.ts")

# ---------- emit ----------

emit_json() {
  cat <<EOF
{
  "schemaVersion": 1,
  "generatedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "root": "$REPO_ROOT",
  "extensionFiles": {
    "count": $EXT_FILE_COUNT,
    "totalLoc": $EXT_FILES_TOTAL_LOC,
    "withPiImports": $EXT_FILES_WITH_PI,
    "details": $(awk -F'\t' 'BEGIN{printf "["} {if(NR>1)printf ","; printf "{\"file\":\"%s\",\"loc\":%s,\"piImports\":%s}", $1, $2, $3} END{printf "]"}' "$EXT_DETAIL_TSV")
  },
  "factoryFunctions": {
    "count": $FACTORY_COUNT,
    "lines": [$(echo "$FACTORY_LINES" | grep -v '^$' | head -20 | awk 'BEGIN{ORS=""; first=1} {if(!first)printf ","; first=0; gsub(/\\/, "\\\\"); gsub(/"/, "\\\""); printf "\"%s\"", $0}')]
  },
  "builtinExtensionNames": {
    "count": $BUILTIN_COUNT,
    "names": [$(echo "$BUILTIN_NAMES" | grep -v '^$' | awk 'BEGIN{ORS=""; first=1} {if(!first)printf ","; first=0; printf "\"%s\"", $0}')]
  },
  "extensionApiConsumers": {
    "count": $EF_CONSUMER_COUNT,
    "sample": [$(echo "$EF_CONSUMERS" | grep -v '^$' | head -10 | awk 'BEGIN{ORS=""; first=1} {if(!first)printf ","; first=0; printf "\"%s\"", $0}')]
  },
  "tests": {
    "extensionDirTests": $EXT_TEST_COUNT,
    "piExtensionsTest": "$PI_EXT_TEST",
    "piExtensionsTestLoc": $PI_EXT_TEST_LOC
  },
  "hotspots": {
    "applyPatch": $APPLY_PATCH_LOC,
    "piExtensions": $PI_EXT_LOC,
    "settingsStore": $SETTINGS_STORE_LOC,
    "profileManager": $PROFILE_MGR_LOC
  },
  "gMapping": {
    "G1": "apply-patch.ts $APPLY_PATCH_LOC LOC → pi-tool-factories.ts (target < 100)",
    "G10": "pi-extensions.ts $PI_EXT_LOC LOC → 单文件 registerBuiltinExtension factory 入口 (target ≤ 200)"
  },
  "gaGate": "apply-patch < 100 + pi-extensions ≤ 200 + 全部 builtin extension 有 ≥ 1 vitest"
}
EOF
}

emit_human() {
  echo "=== OpenBuddy Extension 系统静态审计（plan4.1 §3 Phase B 工作入口）==="
  echo "Root: $REPO_ROOT"
  echo
  echo "--- 1. Extension 文件 (electron/main/agent/extensions/) ---"
  printf "%-60s %-6s %-6s\n" "file" "loc" "pi#"
  while IFS=$'\t' read -r f loc pi; do
    printf "%-60s %-6s %-6s\n" "$f" "$loc" "$pi"
  done < "$EXT_DETAIL_TSV"
  echo "count=$EXT_FILE_COUNT  totalLoc=$EXT_FILES_TOTAL_LOC  withPiImports=$EXT_FILES_WITH_PI"
  echo
  echo "--- 2. create*Extension factory functions ---"
  echo "$FACTORY_LINES" | head -20 | sed 's|/home/[^:]*:||g'
  echo "count=$FACTORY_COUNT"
  echo
  echo "--- 3. builtin extension names (pi-extensions.ts builtinPiExtensionFactories) ---"
  echo "$BUILTIN_NAMES" | head -20
  echo "count=$BUILTIN_COUNT"
  echo
  echo "--- 4. ExtensionAPI/ExtensionFactory consumers ---"
  echo "$EF_CONSUMERS" | head -10
  echo "count=$EF_CONSUMER_COUNT (capped at 50 in json)"
  echo
  echo "--- 5. Tests ---"
  echo "extension files with .test.ts: $EXT_TEST_COUNT"
  echo "pi-extensions.test.ts: $PI_EXT_TEST ($PI_EXT_TEST_LOC LOC)"
  echo
  echo "--- 6. Hotspots ---"
  printf "%-50s %s\n" "apply-patch.ts"        "$APPLY_PATCH_LOC LOC  (G1 target < 100)"
  printf "%-50s %s\n" "pi-extensions.ts"      "$PI_EXT_LOC LOC  (G10 target ≤ 200)"
  printf "%-50s %s\n" "settings-store.ts"     "$SETTINGS_STORE_LOC LOC  (G2 target ≤ 50)"
  printf "%-50s %s\n" "profile-manager.ts"    "$PROFILE_MGR_LOC LOC  (G3 target ≤ 200)"
  echo
  echo "--- 7. G-mapping (work entry per plan4.1 backlog) ---"
  echo "G1  : apply-patch.ts 228 → pi-tool-factories.ts (target < 100) — Phase B 入口"
  echo "G10 : pi-extensions.ts 1222 → 单文件 registerBuiltinExtension factory 入口 (target ≤ 200)"
  echo "G11 : plugin-sdk/src/manifest.ts → 切 pi parseFrontmatter（renderer 端先跑通 → 共享给 main）"
  echo
  echo "--- 8. GA gate ---"
  echo "apply-patch < 100 + pi-extensions ≤ 200 + 全部 builtin extension 有 ≥ 1 vitest"
  echo
  echo "--- 9. 已知限制 ---"
  echo "1. builtin factory names grep 是按 pi-extensions.ts record key 模式 — 漏掉 inline named exports（如 createPiHooksExtension 之外的 named const）"
  echo "2. EF consumers 列表 capped 50 — 大仓会截断；接 CI 时改为 streamed 输出"
  echo "3. 静态未区分 runtime import vs type-only"
}

if [ "$MODE" = "json" ]; then
  emit_json
else
  emit_human
fi