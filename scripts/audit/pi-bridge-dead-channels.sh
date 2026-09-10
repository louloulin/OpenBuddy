#!/usr/bin/env bash
# scripts/audit/pi-bridge-dead-channels.sh
#
# 把 `electron/main/agent/pi-bridge/index.ts` 注册的 14 个 IPC 通道逐条映射到
# （a）底层 pi 函数；（b）renderer 当前消费者（path:line）；（c）建议接入位置
# （基于 plan4.0.md §1.8 B1–B13 + plan4.1.md §2 G3）.
#
# 这是 plan4.1.md §3 Phase D 的入口证据脚本。
# 输出 JSON 给 verify:plan / CI 用；人类表格给 review 用。
#
# 用纯 bash + grep 实现，runnable 在任何带 bash + grep 的环境。

set -euo pipefail

ROOT="${OPENBUDDY_ROOT:-$(cd "$(dirname "$0")/../.." && pwd -P)}"
JSON_ONLY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --json) JSON_ONLY=1 ;;
    --root) ROOT="$2"; shift ;;
    -h|--help) sed -n '2,18p' "$0"; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
  shift
done

cd "$ROOT"

# 静态映射：channel → pi 函数 → 当前消费者 → 建议接入位置（plan4.0.md §1.8 B1-B13 锁定）。
# NOTE: 这是基于 plan + 实际 renderer grep 的手动策展；脚本不做"自动找最佳接入点"，
# 因为 renderer 接 pi-bridge 的契约需要人类判断（哪种 file picker / preview 才合理）。
# 列分隔符：`|`。每条 4 列。

declare -a CHANNELS=(
  "pi-bridge-text:parse-frontmatter|parseFrontmatter|src/lib/agent/pi-client.ts:1460|src/lib/agent/pi-client.ts:1457 (already; expand to all plugin manifest sites)"
  "pi-bridge-text:strip-frontmatter|stripFrontmatter|NONE|packages/runtime/openbuddy-plugin-sdk/src/manifest.ts (replace custom YAML parser)"
  "pi-bridge-text:truncate-head|truncateHead|NONE|src/components/chat/MessageList.tsx (long-file preview) + src/lib/agent/attachment/preview.ts"
  "pi-bridge-text:truncate-tail|truncateTail|NONE|src/components/chat/MessageList.tsx (long log preview) + src/lib/agent/attachment/preview.ts"
  "pi-bridge-text:truncate-line|truncateLine|NONE|src/lib/agent/attachment/preview.ts (single-line wrap preview)"
  "pi-bridge-text:generate-diff|generateDiffString|NONE|src/components/chat/ToolCallCard.tsx (diff render) + src/components/files/DiffView.tsx"
  "pi-bridge-text:generate-patch|generateUnifiedPatch|NONE|src/components/chat/ToolCallCard.tsx (apply_patch preview)"
  "pi-bridge-image:detect-mime|detectSupportedImageMimeTypeFromFile|NONE|src/lib/agent/attachment/upload.ts (paste image)"
  "pi-bridge-image:resize|resizeImage|NONE|src/lib/agent/attachment/upload.ts (paste image > 5MB downscale)"
  "pi-bridge-image:resize-file|readAndResizeImage|NONE|src/lib/agent/attachment/upload.ts (image file from picker)"
  "pi-bridge-image:convert-to-png|convertToPng|NONE|src/lib/agent/attachment/upload.ts (HEIC/AVIF clipboard image → png)"
  "pi-bridge-skills:load|loadSkills|NONE|packages/runtime/openbuddy-plugin-host/src/skills.ts (already wraps; renderer never reaches it)"
  "pi-bridge-skills:load-from-dir|loadSkillsFromDir|NONE|packages/runtime/openbuddy-plugin-host/src/skills.ts (already wraps; renderer never reaches it)"
  "pi-bridge-skills:format-for-prompt|formatSkillsForPrompt|NONE|packages/runtime/openbuddy-plugin-host/src/skills.ts (already wraps; renderer never reaches it)"
)

# JSON array
JSON_ARR=""
COVERED=0
DEAD=0
HUMAN_TABLE=""

# 帮助解析 pipe 分隔的 4 列
i=0
for line in "${CHANNELS[@]}"; do
  channel=$(echo "$line" | awk -F'|' '{gsub(/^ +| +$/,"",$1); print $1}')
  piFn=$(echo "$line" | awk -F'|' '{gsub(/^ +| +$/,"",$2); print $2}')
  consumer=$(echo "$line" | awk -F'|' '{gsub(/^ +| +$/,"",$3); print $3}')
  suggested=$(echo "$line" | awk -F'|' '{gsub(/^ +| +$/,"",$4); print $4}')

  # 双保险：用 grep 反查实际消费者（避免手工表格与现实漂移）。
  # NOTE: pipefail + set -e 会让"grep 0 匹配"kill 整个脚本；用 || true 兜底。
  actual_count=0
  if [ -n "$channel" ] && [ "$channel" != "NONE" ]; then
    # 优先用 pi 函数名（camelCase）查；fallback 用 channel method（kebab-case）
    domain="${channel#pi-bridge-}"; domain="${domain%%:*}"
    fn_candidates="$piFn"
    base="${channel#pi-bridge-}"; method="${base##*:}"
    fn_candidates="$fn_candidates $method"
    for fn in $fn_candidates; do
      cnt=$(grep -rEn "bridge\.${domain}\.${fn}[[:space:]]*\(" \
        --include="*.ts" --include="*.tsx" \
        --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=build \
        src/ packages/ 2>/dev/null \
        | grep -v __tests__ \
        | grep -v 'pi-bridge-client' \
        | wc -l | tr -d ' ') || cnt=0
      actual_count=$((actual_count + cnt))
    done
  fi

  # 二次核对：consumer 字段声称有消费者，但 grep 0 → 标 NONE
  if [ "$consumer" != "NONE" ] && [ "$actual_count" = "0" ]; then
    consumer="NONE (plan claimed: $consumer)"
  fi

  status="dead"
  if [ "$consumer" = "NONE" ] || echo "$consumer" | grep -q "^NONE"; then
    status="dead"
    DEAD=$((DEAD + 1))
  else
    status="covered"
    COVERED=$((COVERED + 1))
  fi

  # JSON
  esc_suggested=$(echo "$suggested" | sed 's/"/\\"/g')
  esc_consumer=$(echo "$consumer" | sed 's/"/\\"/g')
  JSON_ARR="${JSON_ARR}{\"channel\":\"$channel\",\"piFunction\":\"$piFn\",\"currentConsumer\":\"$esc_consumer\",\"suggestedTarget\":\"$esc_suggested\",\"status\":\"$status\"},"

  # Human table
  if [ "$status" = "dead" ]; then
    HUMAN_TABLE="${HUMAN_TABLE}  ✗ ${channel}  →  ${piFn}  [renderer: NONE]"$'\n'
    HUMAN_TABLE="${HUMAN_TABLE}      suggested: ${suggested}"$'\n'
  else
    HUMAN_TABLE="${HUMAN_TABLE}  ✓ ${channel}  →  ${piFn}  [renderer: ${consumer}]"$'\n'
  fi

  i=$((i + 1))
done

JSON_ARR_CLEAN=$(echo "$JSON_ARR" | sed 's/,$//')
TOTAL=$i
UTIL_PCT=$(awk -v c="$COVERED" -v t="$TOTAL" 'BEGIN { if (t>0) printf "%.0f", (c/t)*100; else print 0 }')
GA_OK="false"
if [ "$UTIL_PCT" -ge 80 ]; then GA_OK="true"; fi

TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
JSON="{\"schemaVersion\":1,\"generatedAt\":\"$TS\",\"root\":\"$ROOT\",\"total\":$TOTAL,\"covered\":$COVERED,\"dead\":$DEAD,\"utilizationPct\":$UTIL_PCT,\"gaGate\":\">=80%\",\"gaOk\":$GA_OK,\"channels\":[$JSON_ARR_CLEAN]}"

if [ "$JSON_ONLY" -eq 1 ]; then
  echo "$JSON"
  exit 0
fi

echo "$JSON" >&2

cat <<EOF
┌──────────────────────────────────────────────────────────────────────┐
│  pi-bridge IPC Dead-Channel Audit (plan4.1.md §3 Phase D)   $TS  │
└──────────────────────────────────────────────────────────────────────┘
Total channels           : $TOTAL
Covered (renderer uses)  : $COVERED
Dead (zero consumers)    : $DEAD
Utilization              : ${UTIL_PCT}%    GA gate: ≥80%   ${GA_OK}

$HUMAN_TABLE
Phase D work: see plan4.1.md §3 + plan4.0.md §1.8 B1-B13.
EOF

exit 0
