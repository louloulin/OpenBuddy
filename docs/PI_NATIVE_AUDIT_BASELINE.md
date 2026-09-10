# PI Native Audit Baseline — OpenBuddy 五期（plan4.1.md §1 / §5 实测基线）

> 📅 2026-09-10 · 仓库 `louloulin/OpenBuddy` · 父任务 LUM-785
>
> 本文是 `plan4.1.md §5` GA 门槛（pi 复用 ≥70%、pi-bridge 利用 ≥80%、29/29 canonical e2e）所对应的实测基线文档。
>
> **数据来源**：3 个 `scripts/audit/*.{sh,mjs}` 脚本的 `--json` 输出，可重跑验证。
>
> **静态审计声明**：本文所有数字来自 source-tree 静态扫描（grep / awk / sed / find），**未跑过** vitest / tsc / Electron smoke（容器无 node/pnpm/moon）。runtime verification 待 dev-env 补齐。

---

## 0. 一页概览（2026-09-10）

| 指标 | 当前值 | GA gate | 差距 | 阻断状态 |
|---|---|---|---|---|
| **pi 包直接复用数** | 3 / 3 available | ≥ 3 | ✓ | ✅ |
| **唯一 pi 符号 import 数** | 23 | (raw; reuse % 另算) | n/a | info |
| **pi 复用度**（粗算） | ~22% (23 / 105 exports) | ≥ 70% | -48 pp | ❌ |
| **pi-bridge 通道数** | 14 | — | — | info |
| **pi-bridge renderer 消费者数** | 1 (parseSkillFrontmatter) | ≥ 12 (≥ 85%) | -11 | ❌ |
| **pi-bridge 利用率** | 7% | ≥ 80% | -73 pp | ❌ |
| **CANONICAL_PI_PACKAGES 声明数** | 29 | — | — | info |
| **CANONICAL_PI_PACKAGES e2e 覆盖数** | 0 | 29 (100%) | -29 | ❌ |
| **extensions/apply-patch.ts LOC** | 228 | < 100 | -128 | ❌ |
| **storage settings-store.ts LOC** | 196 | ≤ 50 | -146 | ❌ |
| **plugin-host profile-manager.ts LOC** | 806 | ≤ 200 | -606 | ❌ |

**生产可用门槛距离**：5 个 ❌ / 11 个 info-or-pass。

---

## 1. 实测 JSON（脚本输出，可重跑）

### 1.1 `bash scripts/audit/pi-sdk-usage.sh --json`

```bash
$ bash scripts/audit/pi-sdk-usage.sh --json
```

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-09-10T23:48:08Z",
  "root": "/home/devbox/multica_workspaces/.../OpenBuddy",
  "piPackages": 3,
  "piPackagesList": [
    "@earendil-works/pi-agent-core",
    "@earendil-works/pi-ai",
    "@earendil-works/pi-coding-agent"
  ],
  "piSymbols": 23,
  "piSymbolStatements": 113,
  "piFiles": 88,
  "piBridge": {
    "channels": 14,
    "rendererConsumers": 1,
    "deadChannels": 13,
    "utilizationPct": 7,
    "gaGate": ">=80%"
  },
  "canonicalPackages": {
    "declared": 29,
    "e2eFiles": 0,
    "gaGate": "29/29 e2e"
  },
  "hotspots": {
    "applyPatch": 228,
    "settingsStore": 196,
    "profileManager": 806
  }
}
```

### 1.2 `bash scripts/audit/pi-bridge-dead-channels.sh --json`（摘要）

```bash
$ bash scripts/audit/pi-bridge-dead-channels.sh --json | jq '{total,covered,dead,utilizationPct,gaOk}'
```

```json
{
  "total": 14,
  "covered": 1,
  "dead": 13,
  "utilizationPct": 7,
  "gaOk": false
}
```

完整 channels 列表见脚本输出，对应 plan4.0.md §1.8 B1-B13 + plan4.1.md §2 G4。

### 1.3 `bash scripts/audit/canonical-packages-e2e.sh --json`（摘要）

```bash
$ bash scripts/audit/canonical-packages-e2e.sh --json | jq '{total,covered,missing}'
```

```json
{
  "total": 29,
  "covered": 0,
  "missing": 29
}
```

29 个 missing package 列表：

```
pi-hermes-memory, @remnic/plugin-pi, @juicesharp/rpiv-todo, @anthropic/pi-todo,
pi-web-access, @diegopetrucci/pi-web-access, pi-mcp-adapter,
pi-plan-mode, @narumitw/pi-plan-mode, @arvoretech/pi-plan-mode, @plannotator/pi-extension,
pi-permission-system,
pi-folder-trust, @anthropic/pi-folder-trust,
pi-notification, @anthropic/pi-notification,
pi-goal, pi-goal-x, @narumitw/pi-goal,
pi-automation, pi-workflow, pi-cron, pi-schedule, @anthropic/pi-automation,
pi-subagents,
pi-lens, pi-simplify, pi-hashline, pi-worktree
```

---

## 2. 唯一 pi 符号清单（v3 实测 23 个）

来源：`scripts/audit/pi-sdk-usage.sh` `piSymbolStatements` 去重后。

```
AgentSession                  (pi-coding-agent)
DEFAULT_COMPACTION_SETTINGS   (pi-agent-core)
DefaultResourceLoader         (pi-coding-agent)
ExtensionFactory              (pi-coding-agent)
ExtensionUIContext            (pi-coding-agent)
ModelRegistry                 (pi-coding-agent)
ModelRuntime                  (pi-coding-agent)
SessionEntry                  (pi-coding-agent)
SessionManager                (pi-coding-agent)
Theme                         (pi-coding-agent)
ToolDefinition                (pi-coding-agent)
Type                          (pi-ai)
collectEntriesForBranchSummary (pi-coding-agent)
createAgentSession            (pi-coding-agent)
createExtensionRuntime        (pi-coding-agent)
discoverAndLoadExtensions     (pi-coding-agent)
generateDiffString            (pi-coding-agent, via piGenerateDiffString)
generateUnifiedPatch          (pi-coding-agent, via piGenerateUnifiedPatch)
parseFrontmatter              (pi-coding-agent, via piParseFrontmatter)
prepareBranchEntries          (pi-coding-agent)
shouldCompact                 (pi-agent-core)
streamSimple                  (pi-ai)
stripFrontmatter              (pi-coding-agent, via piStripFrontmatter)
```

注：上面 4 个 `as pi*` 重命名按 v3 修正表去重；底层的 `parseFrontmatter / stripFrontmatter / generateDiffString / generateUnifiedPatch` 各算 1 个。

**对比 plan4.1.md v2 §1**：v2 写"24 个"，v3 实测 23（脚本 `sed` 去重 `as` 重命名）。差异在 v2 把 4 个重命名算成 8 个。

---

## 3. 文件级 pi import 分布

`scripts/audit/pi-sdk-usage.sh` `piFiles=88` 包含：

- `electron/main/agent/agent-host.ts` — composition root，import `Model` (Type) from pi-ai
- `electron/main/agent/pi-extensions.ts` — `ExtensionAPI, ExtensionFactory` + `Type` + `shouldCompact`
- `electron/main/agent/host-modules/session-store.ts` — `SessionManager, collectEntriesForBranchSummary, prepareBranchEntries`
- `electron/main/agent/extensions/*.ts` — 6 个 builtin ExtensionFactory
- `electron/main/agent/pi-bridge/text-utils.ts` — `parseFrontmatter, stripFrontmatter, truncateHead/Tail/Line, generateDiffString, generateUnifiedPatch`
- `packages/runtime/openbuddy-plugin-host/src/skills.ts` — `loadSkills/loadSkillsFromDir/formatSkillsForPrompt` 薄壳

---

## 4. 与 plan4.1.md §5 GA 门槛的对应关系

| GA 门槛 | 来源脚本 + 字段 | 当前值 | 目标 | 状态 |
|---|---|---|---|---|
| **pi 复用度 ≥ 70%** | `pi-sdk-usage.json` `piSymbols=23` vs pi 上游 105 exports (含 agents/skills/tools/etc.) | ~22% | ≥ 70% | ❌ |
| **第三方 pi 包 e2e 29/29** | `canonical-packages-e2e.json` `covered` | 0 | 29 | ❌ |
| **pi-bridge 利用 ≥ 80%** | `pi-bridge-dead-channels.json` `utilizationPct` | 7% | ≥ 80% | ❌ |
| **TypeScript 0 error** | `cd electron && pnpm exec tsc -p tsconfig.json --noEmit --incremental false` | n/a（本容器未跑） | 0 error | ⏳ |
| **vitest 542 文件 / 5517 通过** | `pnpm workspace:test` | n/a（本容器未跑） | 全绿 | ⏳ |
| **Performance cold start ≤ 2.5s** | `pnpm perf:ipc` + `pnpm perf:streaming` | n/a（本容器未跑） | ≤ 2.5s | ⏳ |
| **Electron smoke 全过** | `pnpm test:electron:*` | n/a（本容器未跑） | 全过 | ⏳ |

---

## 5. 进度更新契约（每次 PR）

每个 PR 完成后，重新跑三个 audit + 比较：

```bash
# 1) 重跑 baseline（每次 PR 必跑）
bash scripts/audit/pi-sdk-usage.sh > /tmp/before.txt
bash scripts/audit/pi-bridge-dead-channels.sh > /tmp/before-dead.txt
bash scripts/audit/canonical-packages-e2e.sh > /tmp/before-canon.txt

# 2) PR diff
diff /tmp/before.txt /tmp/after.txt  # 或 git diff /tmp/before.txt

# 3) 在 PR 模板里贴出对比
```

期望的 PR 增量（按 G1 / G4 / G8 等）：
- G1 PR：`hotspots.applyPatch` ↓ ≥ 50 LOC
- G4 PR：`utilizationPct` ↑ ≥ 5 pp
- G8 PR：`canonicalPackages.e2eFiles` ↑ ≥ 1
- G2 PR：`hotspots.settingsStore` ↓ ≥ 30 LOC

---

## 6. 已知限制

1. **静态审计**：未跑 vitest / tsc / Electron smoke（容器无 node）；所有数字都是 grep/awk 在 source tree 上的产出。
2. **未区分 runtime import 与 `import type`**：`piSymbolStatements=113` 包含两者；如要严格区分 runtime 数量，扩展脚本加 `--runtime-only` flag。
3. **死 pi-bridge 通道的"建议接入位置"是手动策展**：基于 plan4.0.md §1.8 B1-B13 锁定，未做"自动找最佳接入点"。
4. **canonical e2e 缺真实验证**：脚本只检查文件名 + content grep，没真装包；要确认 `npm install <pkg>` 能装得上，需要 dev-env + 真网络。

---

## 7. 验证矩阵

| 维度 | 命令 | 状态 |
|---|---|---|
| 静态 audit（pi-sdk） | `bash scripts/audit/pi-sdk-usage.sh` | ✅ 在本容器跑通 |
| 静态 audit（pi-bridge） | `bash scripts/audit/pi-bridge-dead-channels.sh` | ✅ 在本容器跑通 |
| 静态 audit（canonical） | `bash scripts/audit/canonical-packages-e2e.sh` | ✅ 在本容器跑通 |
| 数字与本文一致 | `bash scripts/audit/*.sh --json` 跟 §1.1/1.2/1.3 对比 | ✅ |
| TypeScript 0 error | `pnpm typecheck` | ⏳ 待 dev-env |
| vitest 全过 | `pnpm workspace:test` | ⏳ 待 dev-env |
| Electron smoke | `pnpm test:electron:*` | ⏳ 待 dev-env |

---

## 8. 关联文档

- `plan4.md` — 架构总纲
- `plan4.0.md` — UI 细节 + B1-B13 死 pi-bridge 整改
- `plan4.1.md` — pi-native 重构 8 阶段路线
- `docs/PI_INTEGRATION_BACKLOG.md` — 15 项 G-gap 执行级 backlog
- `docs/pi-analysis-critique.md` — v1 plan4.1.md 方法论批判
- `scripts/audit/pi-sdk-usage.{sh,mjs}` — pi-sdk 静态审计
- `scripts/audit/pi-bridge-dead-channels.{sh,mjs}` — pi-bridge 死通道审计
- `scripts/audit/canonical-packages-e2e.{sh,mjs}` — canonical 包 e2e 覆盖审计
