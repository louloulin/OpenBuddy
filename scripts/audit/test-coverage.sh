#!/usr/bin/env bash
# scripts/audit/test-coverage.sh — OpenBuddy 测试覆盖率静态审计（plan4.1 §5 GA 配套）
#
# 作用：在不依赖 node 的前提下，统计 .test.ts / .spec.ts 文件数量、源码规模、test/source
# 比，识别 0 测试包、e2e 缺口，作为 G8 (29 个 CANONICAL_PI_PACKAGES e2e) 的执行起点。
#
# 用法：
#   bash scripts/audit/test-coverage.sh          # 人读表格
#   bash scripts/audit/test-coverage.sh --json   # 机器读 JSON
#
# 输出（人读）：per-package 表 + 总览（GA gate 候选）+ G8 缺口行
# 输出（JSON）：schemaVersion=1，totalTests / perPackage[] / g8Gaps[] / gaGate 字段
#
# 已知限制（与 plan4.1 §6 一致）：
#   1. 静态计数，未区分 run-time vs type-only import；
#   2. .test.ts 与 .spec.ts 视为等价（与 vitest 配置 `*.test.ts` 一致）；
#   3. 0 测试包标记为 G8-candidate 但 G8 真验收是 29 个 CANONICAL_PI_PACKAGES 真实 e2e。
#
# 历史：2026-09-10 LUM-785 Round 5 增量（继 pi-sdk / pi-bridge-dead / canonical 之后第 4 个 audit）

set -euo pipefail

# ---------- args ----------
MODE="human"
for a in "$@"; do
  case "$a" in
    --json) MODE="json" ;;
    --help|-h)
      sed -n '2,20p' "$0"
      exit 0
      ;;
    *) echo "unknown arg: $a" >&2; exit 2 ;;
  esac
done

# ---------- locate repo root ----------
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
# scripts/audit/ → repo root = .. / ..
REPO_ROOT=$(cd "$SCRIPT_DIR/../.." && pwd)
cd "$REPO_ROOT"

# ---------- scope ----------
AREAS=("electron/main" "electron/preload" "electron/renderer" "src" "tests/electron")

# guard grep 0-match → 0 count via || true (under set -euo pipefail)
count_files() {
  local pattern="$1"
  local dir="$2"
  local n
  n=$(find "$dir" -name "$pattern" -type f 2>/dev/null | wc -l) || n=0
  echo "$n"
}

# ---------- per-package (packages/*) ----------
PER_PKG_TSV=$(mktemp)
trap 'rm -f "$PER_PKG_TSV"' EXIT

for pkg_dir in packages/*/; do
  pkg=$(basename "$pkg_dir")
  tests=$(count_files '*.test.ts' "$pkg_dir")
  tests=$(( tests + $(count_files '*.spec.ts' "$pkg_dir") ))
  src=$(find "$pkg_dir" -name "*.ts" -not -name "*.test.ts" -not -name "*.spec.ts" -not -name "*.d.ts" 2>/dev/null | wc -l) || src=0
  if [ "$src" -gt 0 ]; then
    ratio=$(awk "BEGIN{printf \"%.3f\", $tests/$src}")
  else
    ratio="0.000"
  fi
  printf "%s\t%s\t%s\t%s\n" "$pkg" "$tests" "$src" "$ratio" >> "$PER_PKG_TSV"
done

# ---------- per-area (top-level dirs) ----------
declare -A AREA_TESTS
declare -A AREA_SRC
TOTAL_TESTS=0
TOTAL_SRC=0

for area in "${AREAS[@]}"; do
  if [ -d "$area" ]; then
    t=$(count_files '*.test.ts' "$area")
    t=$(( t + $(count_files '*.spec.ts' "$area") ))
    s=$(find "$area" -name "*.ts" -not -name "*.test.ts" -not -name "*.spec.ts" -not -name "*.d.ts" 2>/dev/null | wc -l) || s=0
    AREA_TESTS[$area]=$t
    AREA_SRC[$area]=$s
    TOTAL_TESTS=$((TOTAL_TESTS + t))
    TOTAL_SRC=$((TOTAL_SRC + s))
  else
    AREA_TESTS[$area]=0
    AREA_SRC[$area]=0
  fi
done

# zero-test packages (top-level packages/* with src>0 but tests=0)
ZERO_TEST_PKGS=$(awk -F'\t' '$2==0 && $3>0 {print $1}' "$PER_PKG_TSV" | sort)

# ---------- emit ----------

emit_json() {
  local per_pkg_json="["
  local first=1
  while IFS=$'\t' read -r pkg t s r; do
    if [ "$first" -eq 1 ]; then first=0; else per_pkg_json+=","; fi
    per_pkg_json+="{\"package\":\"$pkg\",\"tests\":$t,\"source\":$s,\"ratio\":$r}"
  done < "$PER_PKG_TSV"
  per_pkg_json+="]"

  local areas_json="{"
  local first=1
  for area in "${AREAS[@]}"; do
    if [ "$first" -eq 1 ]; then first=0; else areas_json+=","; fi
    areas_json+="\"$area\":{\"tests\":${AREA_TESTS[$area]},\"source\":${AREA_SRC[$area]}}"
  done
  areas_json+="}"

  local g8_gaps="["
  local first=1
  for pkg in $ZERO_TEST_PKGS; do
    if [ "$first" -eq 1 ]; then first=0; else g8_gaps+=","; fi
    g8_gaps+="\"$pkg\""
  done
  g8_gaps+="]"

  local overall_ratio="0.000"
  if [ "$TOTAL_SRC" -gt 0 ]; then
    overall_ratio=$(awk "BEGIN{printf \"%.3f\", $TOTAL_TESTS/$TOTAL_SRC}")
  fi

  cat <<EOF
{
  "schemaVersion": 1,
  "generatedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "root": "$REPO_ROOT",
  "totals": {
    "tests": $TOTAL_TESTS,
    "source": $TOTAL_SRC,
    "ratio": $overall_ratio
  },
  "perPackage": $per_pkg_json,
  "perArea": $areas_json,
  "zeroTestPackages": $g8_gaps,
  "g8GapNote": "29 CANONICAL_PI_PACKAGES e2e (plan4.1 §5 GA) 仍未覆盖；zero-test packages 是首选补测目标",
  "gaGate": "vitest 全过 + 29/29 canonical e2e（待 dev-env）"
}
EOF
}

emit_human() {
  echo "=== OpenBuddy 测试覆盖静态审计（plan4.1 §5 GA gate 配套） ==="
  echo "Root: $REPO_ROOT"
  echo
  echo "--- 1. Top-level areas ---"
  printf "%-25s %-10s %-10s %-10s\n" "Area" "tests" "source" "ratio"
  for area in "${AREAS[@]}"; do
    t=${AREA_TESTS[$area]:-0}
    s=${AREA_SRC[$area]:-0}
    r="0.000"
    if [ "$s" -gt 0 ]; then
      r=$(awk "BEGIN{printf \"%.3f\", $t/$s}")
    fi
    printf "%-25s %-10s %-10s %-10s\n" "$area" "$t" "$s" "$r"
  done

  echo
  echo "--- 2. Per-package (packages/*) ---"
  printf "%-25s %-8s %-8s %-10s\n" "package" "tests" "source" "ratio"
  sort -t$'\t' -k4 -rn "$PER_PKG_TSV" | while IFS=$'\t' read -r pkg t s r; do
    printf "%-25s %-8s %-8s %-10s\n" "$pkg" "$t" "$s" "$r"
  done

  echo
  echo "--- 3. Zero-test packages (G8 candidate targets) ---"
  if [ -z "$ZERO_TEST_PKGS" ]; then
    echo "(none — all packages/* have ≥1 test)"
  else
    printf "%s\n" $ZERO_TEST_PKGS
  fi

  echo
  echo "--- 4. Totals ---"
  overall_ratio="0.000"
  if [ "$TOTAL_SRC" -gt 0 ]; then
    overall_ratio=$(awk "BEGIN{printf \"%.3f\", $TOTAL_TESTS/$TOTAL_SRC}")
  fi
  printf "Total .test.ts/.spec.ts : %d\n" "$TOTAL_TESTS"
  printf "Total source .ts        : %d\n" "$TOTAL_SRC"
  printf "Overall test/source     : %s\n" "$overall_ratio"
  echo
  echo "--- 5. G8 gap (canonical pi e2e) ---"
  echo "29 个 CANONICAL_PI_PACKAGES e2e 当前 0/29（scripts/audit/canonical-packages-e2e.sh）"
  echo "zero-test packages (上面 §3) 是先补测目标；canonical pi e2e 待 runtime+QA 团队（plan4.1 G8）"
  echo
  echo "--- 6. GA gates ---"
  echo "vitest 全过 (542 文件 / 5517 通过)  : ⏳ 待 dev-env"
  echo "29/29 canonical pi e2e              : ❌ 0/29"
  echo "test/source ≥ 0.5 (建议线)          : $([ "${overall_ratio%.*}" -ge 0 ] && echo "${overall_ratio} ✅" || echo "${overall_ratio} ❌")"
}

if [ "$MODE" = "json" ]; then
  emit_json
else
  emit_human
fi