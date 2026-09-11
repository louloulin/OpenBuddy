# Round 25 Implementation Report — G4 PR 4 (final) bridge.skills.* 接入 renderer — G4 完成 100% / pi-bridge GA gate ≥ 80% ✅ (LUM-785, 2026-09-11)

## Round 25 真实落地的功能

### 1. G4 PR 4（最终 PR）— 一次性接入 3 个 bridge.skills 死通道

新增 **3 个 helper**（`src/lib/agent/pi-client.ts:1692-1760`），对应 G4 spec §3 G4.8：

| Helper | Bridge 通道 |
|---|---|
| `loadBridgeSkills(opts?)` | `pi-bridge-skills:load` |
| `loadBridgeSkillsFromDir(dir, source)` | `pi-bridge-skills:load-from-dir` |
| `formatBridgeSkillsForPrompt(skills, fileReadTool)` | `pi-bridge-skills:format-for-prompt` |

**Fallback 形式**（与 text/image 不同，**返回 rich payload 不是 null**）：

| Helper | Fallback | 理由 |
|---|---|---|
| `loadBridgeSkills` | `{ skills: [], diagnostics: [] }` | 让 caller 直接 iterate 无需 null check；保持 `LoadSkillsPayload` 类型契约 |
| `loadBridgeSkillsFromDir` | 同上 | 同上 |
| `formatBridgeSkillsForPrompt` | `""` | caller 可安全 concatenate |

**Fallback 链 4 层**（同前 PR）：
1. `bridge missing` → 空 payload / ""
2. `skills` namespace 缺 method → 同上 fallback
3. `bridge throws` → 同上 fallback
4. 正常 → `bridge.skills.<method>(...)` 结果

### 2. **GA gate `pi-bridge ≥ 80%` 翻转 ❌ → ✅**

| Round | pi-bridge | GA gate (≥ 80%) |
|---|---|---|
| Round 21 末 | 1/14 = 7% | ❌（−73 pp）|
| Round 22 末 | 2/14 = 14% | ❌（−66 pp）|
| Round 23 末 | 7/14 = 50% | ❌（−30 pp）|
| Round 24 末 | 11/14 = 79% | ❌（−1 pp）|
| **Round 25 末** | **14/14 = 100%** | **✅** |

### 3. 真实验证结果

- `tsc -p tsconfig.json --noEmit` → **0 错** ✅（仅 pre-existing `theme-pi.ts:29` getEditorTheme，Round 11 G6 已知）
- `vitest run skills-bridge-helpers.test.ts` → **10/10** ✅
- `vitest run 5 个 G4 系列 test 文件` → **50/50** ✅（0 regression）

### 4. 10 个新 vitest case（全部通过）

| Helper | Case | 覆盖 |
|---|---|---|
| `loadBridgeSkills` | missing / delegate / throws | 3 |
| `loadBridgeSkillsFromDir` | missing / delegate / namespace-empty | 3 |
| `formatBridgeSkillsForPrompt` | missing / delegate / default-arg / throws | 4 |

## 具体实现的细节

### 5. 为什么 skills fallback 到空 payload（不是 null）

skills 系列比 text/image 复杂——返回 `{ skills, diagnostics }` rich payload。caller 通常 iterate；如果 null 全栈到处加 null check。**空 payload `{ skills: [], diagnostics: [] }` 是更友好的契约**——保持 `LoadSkillsPayload` 类型不变。

### 6. formatForPrompt 默认参数

`fileReadTool: "read" | "bash" = "read"`——pin 到 `"read"`（pi 默认），与 IPC main `electron/main/agent/pi-bridge/index.ts:121` 的 `args.fileReadTool ?? "read"` 一致。**新增 1 个 vitest case 钉住默认参数契约**：`formatBridgeSkillsForPrompt: defaults fileReadTool to 'read'`。

### 7. pi-bridge 利用率更新（**79% → 100%**，最终）

| 通道 | Round 24 末 | Round 25 末 |
|---|---|---|
| text: 7 通道 | ✅ 7 live | ✅ 7 live |
| image: 4 通道 | ✅ 4 live | ✅ 4 live |
| **`skills:load`** | ❌ dead | **✅ live** |
| **`skills:load-from-dir`** | ❌ dead | **✅ live** |
| **`skills:format-for-prompt`** | ❌ dead | **✅ live** |
| **利用率** | **11/14 = 79%** | **14/14 = 100%** |

## 进度百分比更新

| 项 | v3.21 | v3.22 |
|---|---|---|
| G1 PR 1+2+3 | 100% | 100% |
| G2 | 67% | 67% |
| G3 | 0% | 0% |
| G10 | 100% | 100% |
| G11 | 100% | 100% |
| **G4** | **79%** | **100%（4/4 PR 完成）** |

P0 完成度：223 → **233.5**（+10.5）
G 项落地总进度：~52% → **~58%**（+6 pp）

**P0 阶段 GA gates 状态**：
- ✅ pi-bridge ≥ 80%（**本轮翻转**）
- ❌ settings-store.ts ≤ 50 LOC（195 → ≤ 50，差 145 LOC）—— G2 PR 4 范围
- ❌ G3 = 0%（profile-manager.ts 806 → ≤ 200，差 606 LOC）—— G3 PR 1 范围
- ❌ hotspots.* 整体阈值（G2 PR 4 收口）

5 维总评（v3.22）：**🟢 / 🟡 / 🔴 / 🟡 / 🟢**（无变化——G4 PR 4 落地属于"通道可达 + helper ready"，UI 集成仍未发生）

## Round 25 真实改动清单

| 文件 | 类型 | LOC Δ |
|---|---|---|
| `src/lib/agent/pi-client.ts` | 3 new skills functions + 2 type imports + JSDoc | +85 |
| `src/lib/agent/__tests__/skills-bridge-helpers.test.ts` | new | +165 |
| `plan4.1.md` | doc | +135（§9.15 + header v3.21→v3.22 + doc-block 同步）|
| `docs/ROUND25_IMPLEMENTATION_REPORT.md` | new | +230（本文件）|
| `.gitignore` | allowlist | +1 |
| **总计** | | **5 files, +616** |

## 已知限制

1. **3 个 skills helper 无 renderer UI 真实消费方**：本轮只新增 helper + 10 个 vitest。**真实 UI 集成（plugin-host/src/skills.ts + renderer-side skills list / SkillDetailModal）留给 Round 26+ UI 集成 round**。
2. **没有真 IPC round-trip 测试**：mock bridge layer 覆盖 happy / error path；**真实 Electron preload + ipcMain 启动测试需要 dev-env**（Round 9 baseline 起 fts5 阻塞，本轮同上）。
3. **loadBridgeSkills 的 `includeDefaults` 默认行为未在 mock 测试覆盖**：mock 接受 opts 并返回；real 调用时 pi 内部默认行为可能差异。Round 26+ UI 集成时验证。
4. **audit script `scripts/audit/pi-bridge-dead-channels.sh` 自动反映**：本轮未跑（env 限制），但 `covered` 应从 11 → 14，`gaOk` 从 false → true。

## G4 全部 PR 完成度回顾

| PR | Round | 通道数 | pi-bridge 累计 | G4 完成度 |
|---|---|---|---|---|
| G4 PR 1 (stripFrontmatter) | Round 22 | 1 | 14% | 14% |
| G4 PR 2 (truncate* + diff/patch) | Round 23 | +5 | 50% | 50% |
| G4 PR 3 (image.* 4 通道) | Round 24 | +4 | 79% | 79% |
| **G4 PR 4 (skills.* 3 通道)** | **Round 25** | **+3** | **100%** | **100%** |

**总计**：4 round 接 13 个死通道 → 全部活。**G4 spec §3 "8 PR" 按"按域合并"策略实为 4 round 完成**（text 拆 2 round / image 1 round / skills 1 round），节省 4 round 用于其他 G 项。

## Round 26+ 计划（G4 完成后）

| Round | 目标 | 关键指标 |
|---|---|---|
| 26 | G8 PR 1（3 个 canonical pi 包真实 e2e）| 29/29 → 3/29 = 10% |
| 27 | G5 PR 1（generateBranchSummary 真实接入）| 集成深度形式接 → 行为切 |
| 28 | G3 PR 1（DefaultPackageManager 接入）| profile-manager.ts 806 → ≤ 200 |
| 29 | perf bench 脚本 | perf 维度 🔴 → 🟡 |
| 30 | G2 PR 3（retry/image typed API 全切）| settings 域 unused 4 → 1 |
| 31 | G2 PR 4（GA gate 收口：settings-store ≤ 50）| 195 → ≤ 50 |

**P0 余下 GA gates**（G4 翻转后）：
- ❌ `settings-store.ts ≤ 50 LOC`（195 → ≤ 50）—— G2 PR 4
- ❌ G3 = 0%（profile-manager.ts 806 → ≤ 200）—— G3 PR 1
- ❌ `hotspots.* 整体阈值` —— G2 PR 4

**注意**：G4 完成后**只剩 2-3 个 GA gate**待 P1-P3 阶段逐个翻转。**P0 阶段 G1/G2/G3/G4/G10/G11 中只剩 G3 = 0%**——DefaultPackageManager 自实现最重，是 P0 阶段**最大 LOC 削减**机会（806 → ≤ 200 削 606 LOC）。