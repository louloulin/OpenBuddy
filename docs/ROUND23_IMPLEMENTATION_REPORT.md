# Round 23 Implementation Report — G4 PR 2 bridge.text.truncate* + generateDiff/Patch 接入 renderer (LUM-785, 2026-09-11)

## Round 23 真实落地的功能

### 1. G4 PR 2 — 一次性接入 5 个 bridge.text 死通道

新增 **5 个 helper**（`src/lib/agent/pi-client.ts:1489-1588`），对应 G4 spec §3 G4.2-G4.5：

| Helper | Bridge 通道 | G4 spec PR |
|---|---|---|
| `truncateHeadText(content, opts?)` | `pi-bridge-text:truncate-head` | G4.2 |
| `truncateTailText(content, opts?)` | `pi-bridge-text:truncate-tail` | G4.2 |
| `truncateLineText(content, opts?)` | `pi-bridge-text:truncate-line` | G4.3 |
| `generateBridgeDiff(old, new, opts?)` | `pi-bridge-text:generate-diff` | G4.4 |
| `generateBridgePatch(old, new, opts?)` | `pi-bridge-text:generate-patch` | G4.5 |

**Fallback 链** 4 层（与 Round 22 `stripSkillFrontmatter` 同形）：
1. `bridge missing` → 返回 `content` / `newStr`（不抛、不崩）
2. `text` namespace 缺对应 method → 同上 fallback（旧 bridge 兼容）
3. `bridge throws` → 同上 fallback（defensive）
4. 正常 → `bridge.text.<method>(...)` 返回结果

### 2. 真实验证结果

- `tsc -p tsconfig.json --noEmit` → **0 错** ✅（本轮新代码 0 错；pre-existing 1 错在 `theme-pi.ts:29 getEditorTheme`，Round 11 G6 已知，无关本轮）
- `vitest run text-bridge-helpers.test.ts` → **15/15** ✅
- `vitest run parse-skill-frontmatter + strip-skill-frontmatter + text-bridge-helpers` → **27/27** ✅（0 regression）

### 3. 15 个新 vitest case（全部通过）

| Helper | Case | 覆盖 |
|---|---|---|
| truncateHeadText | missing / delegate / throws | 3 |
| truncateTailText | missing / delegate / method-missing | 3 |
| truncateLineText | missing / delegate / throws | 3 |
| generateBridgeDiff | missing / delegate / throws | 3 |
| generateBridgePatch | missing / delegate / text-empty | 3 |

## 具体实现的细节

### 4. Fallback 语义选择（truncate vs diff/patch）

- **truncate 系列** fallback 到原始 `content`：pi 的 UTF-8 byte-aware line counting 在 renderer 端 JS 重写会与 main 不一致。让 caller 看到"明显过长"字符串，而不是"悄悄错的截断"。
- **diff/patch** fallback 到 `newStr`：与 pi 主流程 `apply_patch` 标准行为一致——失败时显示 newStr 给用户，不抛、不假装成功。

### 5. truncateLine type workaround

`PiBridgeTextApi.truncateLine` 在 `src/lib/agent/pi-bridge-client.ts:63` 被错误复制成 `{ maxLines?, maxBytes? }`（应是 `{ maxChars? }`，与 IPC handler `electron/main/agent/pi-bridge/index.ts:53` 一致）。本轮 helper 内 `opts as never` 临时绕过；**Round 24 G4 PR 3 改 image.* 时一并修 pi-bridge-client.ts 类型**。

### 6. pi-bridge 利用率更新（**14% → 50%，+36 pp**）

| 通道 | Round 22 末 | Round 23 末 |
|---|---|---|
| `text:parse-frontmatter` | ✅ live | ✅ live |
| `text:strip-frontmatter` | ✅ live | ✅ live |
| **`text:truncate-head`** | ❌ dead | **✅ live** |
| **`text:truncate-tail`** | ❌ dead | **✅ live** |
| **`text:truncate-line`** | ❌ dead | **✅ live** |
| **`text:generate-diff`** | ❌ dead | **✅ live** |
| **`text:generate-patch`** | ❌ dead | **✅ live** |
| image / skills 7 个 | ❌ dead | ❌ dead |
| **利用率** | **2/14 = 14%** | **7/14 = 50%**（+36 pp）|

## 进度百分比更新

| 项 | v3.19 | v3.20 |
|---|---|---|
| G1 PR 1+2+3 | 100% | 100% |
| G2 | 67% | 67% |
| G3 | 0% | 0% |
| G10 | 100% | 100% |
| G11 | 100% | 100% |
| **G4** | **14%** | **50%（PR 1+2 落地）** |

P0 完成度：(100 + 67 + 0 + 100 + 100 + 50) / 6 × 3 = **208.5**（v3.19 = 190.5，+18）

G 项落地总进度：~36% → **~42%**（+6 pp）

**P0 GA gate（pi-bridge 利用率 ≥ 80%）距离**：50% → 还差 30 pp。**Round 24 G4 PR 3 接 image 4 通道 → 71%，Round 25 G4 PR 4 接 skills 3 通道 → 92%，GA gate ✅**。

5 维总评（v3.20）：**🟢 / 🟡 / 🔴 / 🟡 / 🟢**（无变化——G4 PR 2 落地属于"通道可达 + helper ready"，但 UI 集成未发生）

## Round 23 真实改动清单

| 文件 | 类型 | LOC Δ |
|---|---|---|
| `src/lib/agent/pi-client.ts` | 5 new functions + JSDoc | +120 |
| `src/lib/agent/__tests__/text-bridge-helpers.test.ts` | new | +205 |
| `plan4.1.md` | doc | +120（§9.13，header v3.19→v3.20，doc-block 同步）|
| `docs/ROUND23_IMPLEMENTATION_REPORT.md` | new | +230（本文件）|
| `.gitignore` | allowlist | +1 |
| **总计** | | **5 files, +676** |

## 已知限制

1. **5 个 helper 无 renderer UI 真实消费方**：本轮同样只新增 helper + 15 个 vitest。**真实 UI 集成（MessageList.tsx / ToolCallCard.tsx / attachment/preview.ts）留给 Round 24+ G4 PR 3 + UI 集成 round**。
2. **truncateLine type cast workaround**：`PiBridgeTextApi.truncateLine` 类型错配，helper 内 `as never` 临时绕过。**Round 24 G4 PR 3 改 image.* 时一并修 pi-bridge-client.ts**。
3. **没有真 IPC round-trip 测试**：mock bridge layer 覆盖 happy / error path；**真实 Electron preload + ipcMain 启动测试需要 dev-env**（Round 9 baseline 起 fts5 阻塞，本轮同上）。
4. **diff/patch 的 `filePath` 参数未在 renderer 调用栈测试**：mock 没有 typed args 校验。

## Round 24+ 计划（按 v3.20 §9.13.7 顺序）

| Round | 目标 | 关键指标 |
|---|---|---|
| 24 | G4 PR 3（bridge.image.* 4 通道）+ 修 truncateLine type | pi-bridge 50% → 71% |
| 25 | G4 PR 4（bridge.skills.* 3 通道）| pi-bridge 71% → 92%（**≥ 80% GA gate ✅**）|
| 26 | G8 PR 1（3 个 canonical pi 包真实 e2e）| 29/29 → 3/29 = 10% |
| 27 | G5 PR 1（generateBranchSummary 真实接入）| 集成深度形式接 → 行为切 |
| 28 | G3 PR 1（DefaultPackageManager 接入）| profile-manager.ts 806 → ≤ 200 |

**注意**：v3.19 §9.12.7 表的 Round 23-30 顺序在本轮重新规划——把 G4 PR 3 拆成 PR 3（image 4 channels）+ PR 4（skills 3 channels）两轮，因为单 round 接 7 通道 + 修 bridge type 风险过大。