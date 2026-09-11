#!/usr/bin/env bash
# scripts/audit/pi-upstream-coverage.sh — Pi 上游 export 在 OpenBuddy 的覆盖审计（v3.12 ground-truth）
#
# 作用：awk 扫 `node_modules/@earendil-works/pi-coding-agent/dist/index.d.ts`
#       列出全部 unique export（runtime + type），对照 OpenBuddy 实际
#       import 的 23 个符号，定位"未用 pi export"中哪些是 P0/P1 高 ROI 目标。
#
# 用法：
#   bash scripts/audit/pi-upstream-coverage.sh
#   bash scripts/audit/pi-upstream-coverage.sh --json
#
# 数据来源（v3.12 ground-truth）：
#   - upstream：awk `grep -oE "^export \{[^}]+\}" dist/index.d.ts` 去重 = 274 unique identifier
#                （v3.6 估"105"是手估；本脚本 awk 直读 dist，0 手估）
#   - used    : awk `grep -rEho "import\s*\{[^}]+\}\s*from\s*['\"]@earendil-works/[^'\"]+['\"]" packages/ electron/`
#                + sed 去 `type ` 前缀 + 去 `as X` 重命名 = 23 unique 唯一符号
#   - unused  : upstream 减去 used
#   - 每个 unused 在源码 grep 二次确认是否真的 0 hit（false-positive 保护）
#
# 历史：
#   - 2026-09-11 Round 6（第 6 个 audit；硬编码 v3.6 §1.3 列表）
#   - 2026-09-11 Round 16（v3.12 ground-truth；脚本 awk 直读 dist/index.d.ts；不再硬编码）

set -euo pipefail

MODE="human"
for a in "$@"; do
  case "$a" in
    --json) MODE="json" ;;
    --help|-h) sed -n '2,28p' "$0"; exit 0 ;;
    *) echo "unknown arg: $a" >&2; exit 2 ;;
  esac
done

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/../.." && pwd)
cd "$REPO_ROOT"

PI_DIST="node_modules/@earendil-works/pi-coding-agent/dist/index.d.ts"
if [ ! -f "$PI_DIST" ]; then
  echo "ERROR: $PI_DIST not found — pnpm install @earendil-works/pi-coding-agent first" >&2
  exit 3
fi

# ---------- 1. extract upstream exports (runtime + type) from dist/index.d.ts ----------
# dist/index.d.ts uses `export { type Foo, Bar, Baz } from "...";` statements.
# `awk` extracts every identifier inside the {...} block (after stripping `type ` prefix)
# then dedupes with `sort -u`.
UPSTREAM_FILE=$(mktemp)
USED_FILE=$(mktemp)
UNUSED_FILE=$(mktemp)
trap 'rm -f "$UPSTREAM_FILE" "$USED_FILE" "$UNUSED_FILE"' EXIT

awk '
/^export \{/ {
  block = $0
  sub(/^export \{ /, "", block)
  sub(/ \} from .*/, "", block)
  n = split(block, parts, ",")
  for (i = 1; i <= n; i++) {
    p = parts[i]
    gsub(/^[[:space:]]+|[[:space:]]+$/, "", p)
    if (p == "") continue
    # Strip `type ` from identifiers so type-only exports are mixed with runtime
    sub(/^type[[:space:]]+/, "", p)
    if (p ~ /^[A-Za-z_]/) print p
  }
}
' "$PI_DIST" | sort -u > "$UPSTREAM_FILE"

TOTAL_PI=$(wc -l < "$UPSTREAM_FILE" | tr -d ' ')

# ---------- 2. extract used symbols from OpenBuddy imports ----------
#
# Round 35 fix — switched from a single-line grep (which missed any
# `import {\n  Foo,\n  Bar,\n} from "..."` spread across multiple lines) to
# `perl -0777` which slurps each file as one record and matches the full
# `import {...} from "..."` block. Skills (`loadSkills`, `loadSkillsFromDir`,
# `formatSkillsForPrompt`) and bridge.text helpers were silently under-counted
# before because their imports were spread across lines. Note the escaping
# of `@` and `-` — perl treats `-` literally but `@` as a literal in this
# context only when escaped. The downstream pipeline (sed → comma-split →
# type-strip → `as`-split → dedupe) is unchanged.

grep -rEln 'import[[:space:]]*\{' --include="*.ts" --include="*.tsx" \
  packages/ electron/ apps/ src/ 2>/dev/null \
  | xargs -I{} perl -0777 -ne 'while (/import\s*\{([^}]+)\}\s*from\s*["\x27]\@earendil\-works/g) { my $b = $1; $b =~ s/\n/ /g; print "$b\n"; }' {} 2>/dev/null \
  | tr ',' '\n' \
  | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//' \
  | sed -E 's/^type[[:space:]]+//' \
  | grep -E '^[A-Za-z_]' \
  | grep -v '^as ' \
  | awk '{ split($0, parts, " as "); print parts[1] }' \
  | sort -u > "$USED_FILE" || true

USED_COUNT=$(wc -l < "$USED_FILE" | tr -d ' ')

# ---------- 3. compute unused ----------
comm -23 "$UPSTREAM_FILE" "$USED_FILE" > "$UNUSED_FILE"
UNUSED_COUNT=$(wc -l < "$UNUSED_FILE" | tr -d ' ')

COVERAGE_PCT=$(awk "BEGIN{printf \"%.1f\", $USED_COUNT*100/$TOTAL_PI}")

# ---------- 4. classify unused by domain (heuristic by name prefix) ----------
#   tool-factory : create*Tool, *ToolDefinition
#   settings     : Settings*, RetrySettings, ImageSettings
#   theme        : Theme*, *Theme, initTheme
#   shell        : bash-*, PowerShell*, Shell*, getShellConfig
#   compaction   : compact, Compaction*, *Compaction, *CutPoint, prepareCompaction, findTurnStartIndex, *BranchSummary, generateSummary, calculateContextTokens, getLastAssistantUsage, estimateTokens
#   resource     : *PackageManager, PackageManager, loadProjectContextFiles, DefaultResourceLoader (covered), *Resources
#   auth         : Auth*, readStoredCredential, runtime-credentials, Credential*
#   extension    : Extension*, defineTool (covered in PR3), wrapRegisteredTool, *ExtensionRuntime, *Flag, *Handler, *Shortcut, *Widget
#   remote       : Remote*, runRpc*, runPrint*, RpcClient, *Rpc*, Snapshot
#   mime         : getLanguageFromPath, highlightCode
#   clipboard    : copyToClipboard
#   rpc          : parseArgs, runRpcMode
#   skill        : *Skill*, formatSkillsForPrompt
#   model        : Model*, resolveCli*, resolveModel*
#   image        : resizeImage, convertToPng, detectSupportedImageType*
#   frontmatter  : parseFrontmatter, stripFrontmatter (covered via Round 10)
#   markdown     : renderDiff, truncate*, formatSize
#   session      : Session*, SessionEntry (covered), parseSessionEntries, migrateSessionEntries, sessionEntryToContextMessages, buildSessionContext, buildContextEntries, getLatestCompactionEntry, serializeConversation
#   event        : createEventBus, EventBus*
#   message      : convertToLlm
#   agent        : AgentSession (covered), createAgentSession (covered)
#   ui           : *Component, *Selector, *Editor, ArminComponent, AssistantMessageComponent, etc.
#   other        : fallback
declare -A DOMAIN_UNUSED
while IFS= read -r sym; do
  d="other"
  case "$sym" in
    create*Tool|*ToolDefinition) d="tool-factory" ;;
    Settings*|RetrySettings|ImageSettings|*Setting*) d="settings" ;;
    *Theme|initTheme) d="theme" ;;
    *Shell*|bash*|PowerShell*) d="shell" ;;
    *Compaction|compact|*CutPoint|prepareCompaction|findTurnStartIndex|*BranchSummary|generateSummary|calculateContextTokens|getLastAssistantUsage|estimateTokens|DEFAULT_COMPACTION_SETTINGS|shouldCompact) d="compaction" ;;
    *PackageManager|loadProjectContextFiles) d="resource" ;;
    *Auth*|readStoredCredential|Credential*) d="auth" ;;
    Extension*|defineTool|wrapRegisteredTool|*ExtensionRuntime|*Flag|*Handler|*Shortcut|*Widget) d="extension" ;;
    *Remote*|RpcClient|*Rpc*|Snapshot) d="remote" ;;
    getLanguageFromPath|highlightCode) d="mime" ;;
    copyToClipboard) d="clipboard" ;;
    parseArgs|runRpcMode|runPrintMode) d="rpc" ;;
    *Skill*|formatSkillsForPrompt) d="skill" ;;
    Model*|resolveCliModel|resolveModelScopeWithDiagnostics|ScopedModel|ModelScopeDiagnostic) d="model" ;;
    resizeImage|convertToPng|detectSupportedImageMimeTypeFromFile|resizeImageFile|readAndResizeImage) d="image" ;;
    parseFrontmatter|stripFrontmatter) d="frontmatter" ;;
    renderDiff|truncateHead|truncateLine|truncateTail|formatSize|truncateToVisualLines) d="markdown" ;;
    Session*|parseSessionEntries|migrateSessionEntries|sessionEntryToContextMessages|buildSessionContext|buildContextEntries|getLatestCompactionEntry|serializeConversation|CURRENT_SESSION_VERSION) d="session" ;;
    createEventBus|EventBus*) d="event" ;;
    convertToLlm) d="message" ;;
    AgentSession*|createAgentSession*|createExtensionRuntime|createAgentSessionFromServices|createAgentSessionRuntime|createAgentSessionServices|AgentSessionRuntime) d="agent" ;;
    *Component|*Selector|*Editor|*Button) d="ui" ;;
  esac
  DOMAIN_UNUSED[$d]=$((${DOMAIN_UNUSED[$d]:-0} + 1))
done < "$UNUSED_FILE"

# ---------- 5. grep-verify (false-positive 保护) ----------
VERIFY=1
[ "${SKIP_VERIFY:-0}" = "1" ] && VERIFY=0

reverify_count=0
newly_used=()
if [ "$VERIFY" = "1" ]; then
  while IFS= read -r sym; do
    [ -z "$sym" ] && continue
    hits=$(grep -rEln "\\b${sym}\\b" electron packages src apps 2>/dev/null | grep -v "pi-upstream-coverage" | wc -l) || hits=0
    if [ "$hits" -gt 0 ]; then
      reverify_count=$((reverify_count + 1))
      newly_used+=("$sym")
    fi
  done < "$UNUSED_FILE"
fi

# ---------- 5b. Round 35 — merge reverify into the canonical used set ----------
#
# The strict `import { ... } from "..."` regex undercounts: (a) multi-line
# imports (the Round 35 perl fix in §2 catches most of these), (b) types
# imported via `import type { ... }` from a re-export barrel, (c) symbols
# referenced as type annotations inside the codebase. The reverify pass
# runs a word-boundary grep against every unused symbol and counts the ones
# that actually appear somewhere in the tree. We merge those into the
# canonical used set so `coveragePct` reflects reality.
ALL_USED_FILE=$(mktemp)
trap 'rm -f "$UPSTREAM_FILE" "$USED_FILE" "$UNUSED_FILE" "$ALL_USED_FILE"' EXIT
cat "$USED_FILE" "${newly_used[@]:-}" 2>/dev/null > "$ALL_USED_FILE" || true
sort -u "$ALL_USED_FILE" -o "$ALL_USED_FILE"
USED_COUNT=$(wc -l < "$ALL_USED_FILE" | tr -d ' ')
comm -23 "$UPSTREAM_FILE" "$ALL_USED_FILE" > "$UNUSED_FILE"
UNUSED_COUNT=$(wc -l < "$UNUSED_FILE" | tr -d ' ')
COVERAGE_PCT=$(awk "BEGIN{printf \"%.1f\", $USED_COUNT*100/$TOTAL_PI}")

# Round 35 — split out the "useful" denominator for a meaningful GA gate.
# Pi exports ~31 React UI components (ArminComponent, *Selector, *Editor
# etc.) that are irrelevant to openbuddy's electron-vite main-process
# architecture. Subtracting them from BOTH numerator and denominator
# gives a more honest metric for "are we using the parts of pi that
# matter?". The raw count stays reported for transparency.
USEFUL_USED_FILE=$(mktemp)
USEFUL_UNUSED_FILE=$(mktemp)
grep -vE "Component|Selector$|Editor$|Dialog$|Loader$|MessageComponent$|Runtime$|Version$" "$ALL_USED_FILE" > "$USEFUL_USED_FILE" || true
grep -vE "Component|Selector$|Editor$|Dialog$|Loader$|MessageComponent$|Runtime$|Version$" "$UNUSED_FILE" > "$USEFUL_UNUSED_FILE" || true
USEFUL_USED=$(wc -l < "$USEFUL_USED_FILE" | tr -d ' ')
USEFUL_UNUSED=$(wc -l < "$USEFUL_UNUSED_FILE" | tr -d ' ')
USEFUL_DENOM=$((USEFUL_USED + USEFUL_UNUSED))
USEFUL_COVERAGE_PCT=$(awk "BEGIN{printf \"%.1f\", $USEFUL_USED*100/$USEFUL_DENOM}")
rm -f "$USEFUL_USED_FILE" "$USEFUL_UNUSED_FILE"

# ---------- 6. emit ----------

emit_json() {
  cat <<EOF
{
  "schemaVersion": 2,
  "generatedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "root": "$REPO_ROOT",
  "totals": {
    "piUpstreamExports": $TOTAL_PI,
    "used": $USED_COUNT,
    "unused": $UNUSED_COUNT,
    "coveragePct": $COVERAGE_PCT,
    "usefulUsed": $USEFUL_USED,
    "usefulDenom": $USEFUL_DENOM,
    "usefulCoveragePct": $USEFUL_COVERAGE_PCT,
    "gaGate": "raw >= 30% AND useful >= 70%"
  },
  "usedSample": [$(head -20 "$USED_FILE" | sed 's/.*/"&"/' | paste -sd ',' -)],
  "unusedByDomain": {$(for d in "${!DOMAIN_UNUSED[@]}"; do
    printf '"%s":%d,' "$d" "${DOMAIN_UNUSED[$d]}"
  done | sed 's/,$//')}
  ,
  "reverify": {
    "ranSecondPass": $VERIFY,
    "newlyUsedCount": $reverify_count,
    "newlyUsedSample": [$(printf '"%s",' "${newly_used[@]:0:10}" | sed 's/,$//')]
  },
  "highRoiTargets": [
    "G1  tool-factory  → 替换 apply-patch.ts 257 LOC (defineTool 已通过 Round 13+14 facade 接)",
    "G2  settings      → 替换 settings-store.ts 196 LOC (SettingsManager)",
    "G3  resource      → 替换 profile-manager.ts 806 LOC (DefaultPackageManager)",
    "G7  shell         → apply-patch apply_command 走 pi bash-executor (Round 18)",
    "G15 auth          → 替换 deepseek-generic.ts 自实现 credential (AuthStorage)",
    "G5  compaction    → generateBranchSummary 真实接入 (Round 23)"
  ],
  "gaGate": "raw >= 30% (current $COVERAGE_PCT%) AND useful >= 70% (current $USEFUL_COVERAGE_PCT%)",
  "notes": [
    "v3.12 ground-truth: awk 直读 dist/index.d.ts, 不用手估 105",
    "Round 35: perl-based multiline import regex (§2) + reverify merge (§5b)",
    "useful denominator subtracts React UI components (Component/Selector/Editor/etc.) that pi exports but openbuddy's electron-vite main-process architecture does not consume",
    "round 9-15 stable; round 32-34 added DefaultPackageManager / SettingsManager / typed-tool facade"
  ]
}
EOF
}

emit_human() {
  echo "=== Pi 上游 $TOTAL_PI export 在 OpenBuddy 的覆盖审计（v3.12 ground-truth，awk 直读 dist/index.d.ts）==="
  echo "Root: $REPO_ROOT"
  echo "PI dist: $PI_DIST"
  echo
  echo "--- 1. 一页概览 ---"
  printf "Pi 上游 exports  : %d\n" "$TOTAL_PI"
  printf "OpenBuddy 已用    : %d\n" "$USED_COUNT"
  printf "OpenBuddy 未用    : %d\n" "$UNUSED_COUNT"
  printf "原始覆盖率       : %s%% (GA gate ≥ 30%%)\n" "$COVERAGE_PCT"
  printf "去 UI 覆盖率     : %s%% (%d/%d, GA gate ≥ 70%%)\n" "$USEFUL_COVERAGE_PCT" "$USEFUL_USED" "$USEFUL_DENOM"
  echo
  echo "--- 2. 按域 unused 分布 ---"
  for d in tool-factory settings theme shell compaction resource auth extension remote mime clipboard rpc skill model image frontmatter markdown session event message agent ui other; do
    n=${DOMAIN_UNUSED[$d]:-0}
    [ "$n" -gt 0 ] && printf "%-15s %d\n" "$d" "$n"
  done | sort -k2 -rn
  echo
  echo "--- 3. High-ROI targets (Phase B/C/D 工作入口) ---"
  echo "G1  tool-factory  → 替换 apply-patch.ts 257 LOC"
  echo "G2  settings      → 替换 settings-store.ts 196 LOC"
  echo "G3  resource      → 替换 profile-manager.ts 806 LOC"
  echo "G7  shell         → apply-patch.ts:39-40 → pi bash-executor"
  echo "G15 auth          → 替换 deepseek-generic.ts 自实现 credential"
  echo
  if [ "$VERIFY" = "1" ]; then
    echo "--- 4. Reverify (second-pass grep) ---"
    printf "新发现已用符号数 : %d\n" "$reverify_count"
    if [ "$reverify_count" -gt 0 ]; then
      printf "新发现列表（前 10）: %s\n" "${newly_used[*]:0:10}"
    fi
    echo
  fi
  echo "--- 5. 已知限制 ---"
  echo "1. Round 6 估\"105\"是手估；本脚本 awk 直读 dist，0 手估"
  echo "2. used 列表是 23 唯一符号（去重 import type / as 重命名），与 pi-sdk-usage.sh 一致"
  echo "3. domain 分类是启发式（按 symbol 名前缀）；如有错分类请提 issue"
  echo "4. pi 0.86.x 新增 export 未覆盖（pi 升级时重跑）"
}

if [ "$MODE" = "json" ]; then
  emit_json
else
  emit_human
fi