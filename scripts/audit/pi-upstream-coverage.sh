#!/usr/bin/env bash
# scripts/audit/pi-upstream-coverage.sh — Pi 上游 105 export 在 OpenBuddy 的覆盖审计
#
# 作用：把 pi-coding-agent / pi-ai / pi-agent-core 上游 export 按域分类，
#       对照 OpenBuddy 实际 import 的 23 个符号，定位"60+ unused pi export"
#       中哪些是 Phase B/C/D 的高 ROI 目标。
#
# 用法：
#   bash scripts/audit/pi-upstream-coverage.sh
#   bash scripts/audit/pi-upstream-coverage.sh --json
#
# 数据来源：
#   - "used" 列表：硬编码 plan4.1.md v3 §1.1 / §1.2 实测 23 个
#   - "unused" 列表：硬编码 plan4.1.md v3 §1.3 实测 60+ 个
#   - "self-implemented" 列表：plan4.1.md §1.3 + §2 G-gap 自实现位置
#   - 每个 unused 在源码 grep 二次确认是否真的 0 hit（false-positive 保护）
#
# 历史：2026-09-11 LUM-785 Round 6（第 6 个 audit）

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

# ---------- used pi symbols (实测 23，源自 plan4.1 v3 §1.1 + §1.2) ----------
USED_SYMBOLS=(
  # pi-coding-agent
  "AgentSession|createAgentSession + session orchestration"
  "DefaultResourceLoader|resource loader (overridden)"
  "ExtensionFactory|extension registration"
  "ExtensionUIContext|UI context for extensions"
  "ModelRegistry|model discovery"
  "ModelRuntime|model runtime"
  "SessionEntry|session entries"
  "SessionManager|session persistence"
  "Theme|theme base"
  "ToolDefinition|tool schema"
  "collectEntriesForBranchSummary|branch summary helper"
  "createAgentSession|factory"
  "createExtensionRuntime|extension runtime"
  "discoverAndLoadExtensions|extension discovery"
  "generateDiffString|via piGenerateDiffString"
  "generateUnifiedPatch|via piGenerateUnifiedPatch"
  "parseFrontmatter|via piParseFrontmatter"
  "prepareBranchEntries|branch entries"
  "stripFrontmatter|via piStripFrontmatter"
  # pi-agent-core
  "DEFAULT_COMPACTION_SETTINGS|compaction defaults"
  "shouldCompact|compaction trigger"
  # pi-ai
  "Type|model type enum"
  "streamSimple|simple stream"
)

# ---------- unused pi exports (实测 0 hit，按 11 个域分类，源自 plan4.1 v3 §1.3) ----------
# format: domain|symbol|selfImplLocation
UNUSED_PI_EXPORTS=(
  # Tool 工厂
  "tool-factory|createBashTool|electron/main/agent/extensions/apply-patch.ts"
  "tool-factory|createReadTool|electron/main/agent/extensions/apply-patch.ts"
  "tool-factory|createWriteTool|electron/main/agent/extensions/apply-patch.ts"
  "tool-factory|createEditTool|electron/main/agent/extensions/apply-patch.ts"
  "tool-factory|createGrepTool|(renderer 端暂无)"
  "tool-factory|createFindTool|(renderer 端暂无)"
  "tool-factory|createLsTool|(renderer 端暂无)"
  # Settings
  "settings|SettingsManager|packages/runtime/openbuddy-storage/src/sqlite/settings-store.ts (196 LOC)"
  "settings|RetrySettings|models-config.ts 自实现"
  "settings|ImageSettings|renderer 端"
  "settings|settings-diagnostics|未实现"
  # Theme
  "theme|initTheme|packages/ui/openbuddy-ui-theme 自实现"
  "theme|getMarkdownTheme|packages/ui/openbuddy-ui-theme 自实现"
  "theme|getSelectListTheme|未使用"
  "theme|getSettingsListTheme|未使用"
  # Shell
  "shell|getShellConfig|apply-patch.ts:39-40 直接 child_process.execFile"
  "shell|getPowerShellConfig|apply-patch.ts:39-40"
  "shell|bash-executor|apply-patch.ts:39-40"
  "shell|exec|未使用"
  # Compaction
  "compaction|findCutPoint|branch-summary-format.ts 自实现"
  "compaction|prepareCompaction|未实现"
  "compaction|generateSummary|未实现"
  "compaction|generateBranchSummary|branch-summary-format.ts 注释明确 NOT using"
  "compaction|estimateTokens|packages/ui/openbuddy-ui-conversation/src/lib/streaming-metrics.ts:33 自实现"
  "compaction|calculateContextTokens|未实现"
  "compaction|getLastAssistantUsage|未实现"
  "compaction|findTurnStartIndex|未实现"
  "compaction|generateSummaryWithUsage|未实现"
  # Resource / Package
  "resource|DefaultPackageManager|packages/runtime/openbuddy-plugin-host/src/profile-manager.ts (806 LOC 自实现 ProfilePackageManager)"
  "resource|PackageManager|profile-manager.ts"
  "resource|loadProjectContextFiles|packages/runtime/openbuddy-plugin-host/src/include.ts (350 LOC 自实现)"
  # Auth
  "auth|AuthStorage|electron/main/deepseek-generic.ts 自实现 CredentialStore"
  "auth|readStoredCredential|deepseek-generic.ts"
  "auth|runtime-credentials|未实现"
  # Extension
  "extension|defineTool|electron/main/agent/pi-tool-bridge.ts 自实现"
  "extension|wrapRegisteredTool|pi-tool-bridge.ts"
  "extension|createToolDefinition|pi-tool-bridge.ts"
  # Remote / Print / RPC
  "remote|RemoteSession|electron/main/harness/harness-server.ts (1327 LOC 自实现)"
  "remote|applyTranscriptProgress|harness-server.ts"
  "remote|Snapshot|harness-server.ts"
  "remote|runRpcMode|harness-server.ts"
  "remote|runPrintMode|harness-server.ts"
  "remote|parseArgs|harness-server.ts"
  "remote|RpcClient|harness-server.ts"
  # MIME / Lang
  "mime|getLanguageFromPath|renderer markdown 用 highlight.js 绕开"
  "mime|highlightCode|renderer markdown 自实现"
  # Clipboard
  "clipboard|copyToClipboard|electron/main/ 直接用 clipboard 模块"
)

# ---------- grep-verify (optional second-pass check, false-positive 保护) ----------
VERIFY=1
[ "${SKIP_VERIFY:-0}" = "1" ] && VERIFY=0

reverify_count=0
newly_used=()
if [ "$VERIFY" = "1" ]; then
  # 对每个 unused symbol grep 一次（防止 v3 写完后实际已用）
  while IFS='|' read -r domain sym loc; do
    [ -z "$sym" ] && continue
    hits=$(grep -rE "\b${sym}\b" electron packages src 2>/dev/null | grep -v "pi-upstream-coverage" | wc -l) || hits=0
    if [ "$hits" -gt 0 ]; then
      reverify_count=$((reverify_count + 1))
      newly_used+=("$sym")
    fi
  done < <(printf "%s\n" "${UNUSED_PI_EXPORTS[@]}")
fi

# ---------- counts ----------
USED_COUNT=${#USED_SYMBOLS[@]}
UNUSED_COUNT=${#UNUSED_PI_EXPORTS[@]}
TOTAL_PI=105  # 上游 ~105 export (plan4.1 v3 §1)
COVERAGE_PCT=$(awk "BEGIN{printf \"%.1f\", $USED_COUNT*100/$TOTAL_PI}")

# group by domain
declare -A DOMAIN_USED
declare -A DOMAIN_UNUSED
for u in "${UNUSED_PI_EXPORTS[@]}"; do
  d="${u%%|*}"
  DOMAIN_UNUSED[$d]=$((${DOMAIN_UNUSED[$d]:-0} + 1))
done

# ---------- emit ----------

emit_json() {
  cat <<EOF
{
  "schemaVersion": 1,
  "generatedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "root": "$REPO_ROOT",
  "totals": {
    "piUpstreamExports": $TOTAL_PI,
    "used": $USED_COUNT,
    "unused": $UNUSED_COUNT,
    "coveragePct": $COVERAGE_PCT,
    "gaGate": ">= 70%"
  },
  "used": [$(for s in "${USED_SYMBOLS[@]}"; do
    sym="${s%%|*}"
    note="${s#*|}"
    printf '{"symbol":"%s","note":"%s"},' "$sym" "$note"
  done | sed 's/,$//')]
  ,
  "unusedByDomain": {$(for d in "${!DOMAIN_UNUSED[@]}"; do
    printf '"%s":%d,' "$d" "${DOMAIN_UNUSED[$d]}"
  done | sed 's/,$//')}
  ,
  "unused": [$(for u in "${UNUSED_PI_EXPORTS[@]}"; do
    d="${u%%|*}"; rest="${u#*|}"; sym="${rest%%|*}"; loc="${rest#*|}"
    printf '{"domain":"%s","symbol":"%s","selfImpl":"%s"},' "$d" "$sym" "$loc"
  done | sed 's/,$//')]
  ,
  "reverify": {
    "ranSecondPass": $VERIFY,
    "newlyUsedCount": $reverify_count,
    "newlyUsedSymbols": [$(printf '"%s",' "${newly_used[@]}" | sed 's/,$//')]
  },
  "highRoiTargets": [
    "G1  createBashTool + createReadTool + createWriteTool + createEditTool → 替换 apply-patch.ts 228 LOC",
    "G2  SettingsManager → 替换 settings-store.ts 196 LOC",
    "G3  DefaultPackageManager → 替换 profile-manager.ts 806 LOC",
    "G9  loadProjectContextFiles → 替换 include.ts 350 LOC",
    "G15 AuthStorage → 替换 deepseek-generic.ts 自实现 credential"
  ],
  "gaGate": "reusePct >= 70%（当前 $COVERAGE_PCT%）"
}
EOF
}

emit_human() {
  echo "=== Pi 上游 105 export 在 OpenBuddy 的覆盖审计（plan4.1 §1.3 + §2 G-gap）==="
  echo "Root: $REPO_ROOT"
  echo
  echo "--- 1. 一页概览 ---"
  printf "Pi 上游 exports  : %d\n" "$TOTAL_PI"
  printf "OpenBuddy 已用    : %d\n" "$USED_COUNT"
  printf "OpenBuddy 未用    : %d\n" "$UNUSED_COUNT"
  printf "覆盖率           : %s%% (GA gate ≥ 70%%)\n" "$COVERAGE_PCT"
  echo
  echo "--- 2. 按域 unused 分布 ---"
  for d in tool-factory settings theme shell compaction resource auth extension remote mime clipboard; do
    n=${DOMAIN_UNUSED[$d]:-0}
    printf "%-15s %d\n" "$d" "$n"
  done | sort -k2 -rn
  echo
  echo "--- 3. High-ROI targets (Phase B/C/D 工作入口) ---"
  echo "G1  tool-factory  → 替换 apply-patch.ts 228 LOC"
  echo "G2  settings      → 替换 settings-store.ts 196 LOC"
  echo "G3  resource      → 替换 profile-manager.ts 806 LOC"
  echo "G9  resource      → 替换 include.ts 350 LOC"
  echo "G15 auth          → 替换 deepseek-generic.ts 自实现 credential"
  echo
  if [ "$VERIFY" = "1" ]; then
    echo "--- 4. Reverify (second-pass grep) ---"
    printf "新发现已用符号数 : %d\n" "$reverify_count"
    if [ "$reverify_count" -gt 0 ]; then
      printf "新发现列表       : %s\n" "${newly_used[*]}"
    fi
    echo
  fi
  echo "--- 5. 已知限制 ---"
  echo "1. unused 列表源自 plan4.1 v3 §1.3 grep 结果，pi 0.86.x 新增 export 未覆盖"
  echo "2. used 列表是 23 唯一符号（去重 import type / as 重命名），与 pi-sdk-usage.sh 一致"
  echo "3. 105 总数是 v3 估算，未对每个 export 枚举（需要 dev-env + pi 包安装）"
  echo "4. selfImpl 位置是 v3 时的推断；如有实际改名需以 pi-sdk-usage.sh --json 为准"
}

if [ "$MODE" = "json" ]; then
  emit_json
else
  emit_human
fi