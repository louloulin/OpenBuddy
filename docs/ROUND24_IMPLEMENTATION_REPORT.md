# Round 24 Implementation Report — G4 PR 3 bridge.image.* 接入 renderer + truncateLine 类型修正 (LUM-785, 2026-09-11)

## Round 24 真实落地的功能

### 1. G4 PR 3 — 一次性接入 4 个 bridge.image 死通道

新增 **4 个 helper**（`src/lib/agent/pi-client.ts:1609-1690`），对应 G4 spec §3 G4.6-G4.7：

| Helper | Bridge 通道 | G4 spec PR |
|---|---|---|
| `detectImageMime(filePath)` | `pi-bridge-image:detect-mime` | G4.6 |
| `resizeBridgeImage(bytes, mime, opts?)` | `pi-bridge-image:resize` | G4.7 |
| `resizeBridgeImageFile(filePath, opts?)` | `pi-bridge-image:resize-file` | G4.7 |
| `convertBridgeImageToPng(base64, mime)` | `pi-bridge-image:convert-to-png` | G4.7 |

**Fallback 链** 4 层（统一返回 `null`）——与 text 系列不同，**image 系列 fallback 与 IPC main handler 行为一致**：

| 层 | 触发条件 | 返回 |
|---|---|---|
| 1 | `bridge missing` | `null` |
| 2 | `image` namespace 缺 method | `null` |
| 3 | `bridge throws` | `null` |
| 4 | 正常 | `bridge.image.<method>(...)` 结果 |

### 2. PiBridgeTextApi.truncateLine 类型修正（Round 23 遗留 bug fix）

```diff
- truncateLine(content: string, opts?: { maxLines?: number; maxBytes?: number }): Promise<string>;
+ truncateLine(content: string, opts?: { maxChars?: number }): Promise<string>;
```

修复后 `src/lib/agent/pi-client.ts:1547-1563` 的 `truncateLineText` 不再需要 `opts as never` cast，JSDoc 注释同步更新。

### 3. 真实验证结果

- `tsc -p tsconfig.json --noEmit` → **0 错** ✅（仅 pre-existing `theme-pi.ts:29` getEditorTheme，Round 11 G6 已知）
- `vitest run image-bridge-helpers.test.ts` → **13/13** ✅
- `vitest run parse-skill-frontmatter + strip-skill-frontmatter + text-bridge-helpers + image-bridge-helpers` → **40/40** ✅（0 regression）

### 4. 13 个新 vitest case（全部通过）

| Helper | Case | 覆盖 |
|---|---|---|
| `detectImageMime` | missing / delegate / throws | 3 |
| `resizeBridgeImage` | missing / delegate (full payload) / throws | 3 |
| `resizeBridgeImageFile` | missing / delegate / image-namespace-empty | 3 |
| `convertBridgeImageToPng` | missing / delegate / throws | 3 |
| `truncateLineText` (type fix) | opts.maxChars allowed without `as never` | 1 |

## 具体实现的细节

### 5. 为什么 image 系列 fallback 到 `null`

IPC main handler `electron/main/agent/pi-bridge/index.ts:69-105` 本身就返回 `null`（不支持的 MIME / decode 失败 / 转换失败）。让 renderer fallback 与 main fallback 同形，避免 caller 看到两种不同的"失败"形状——一个 `null` 走完全栈。

### 6. 为什么 resize 系列分两个 helper

`resizeBridgeImage` 接 Uint8Array（caller 自己读文件后调），`resizeBridgeImageFile` 接 filePath（main 直接读 + resize）。后者省一次 IPC round-trip，main 直接 fs read。

### 7. pi-bridge 利用率更新（**50% → 79%，+29 pp**）

| 通道 | Round 23 末 | Round 24 末 |
|---|---|---|
| text: 7 通道 | ✅ 7 live | ✅ 7 live |
| **`image:detect-mime`** | ❌ dead | **✅ live** |
| **`image:resize`** | ❌ dead | **✅ live** |
| **`image:resize-file`** | ❌ dead | **✅ live** |
| **`image:convert-to-png`** | ❌ dead | **✅ live** |
| skills: 3 通道 | ❌ dead | ❌ dead |
| **利用率** | **7/14 = 50%** | **11/14 = 79%**（+29 pp）|

**GA gate（pi-bridge ≥ 80%）距离**：79% → 还差 **1 pp**。**Round 25 G4 PR 4 接 skills 任一通道即达成 GA gate**。

## 进度百分比更新

| 项 | v3.20 | v3.21 |
|---|---|---|
| G1 PR 1+2+3 | 100% | 100% |
| G2 | 67% | 67% |
| G3 | 0% | 0% |
| G10 | 100% | 100% |
| G11 | 100% | 100% |
| **G4** | **50%** | **79%（PR 1+2+3 落地）** |

P0 完成度：208.5 → **223**（+14.5）
G 项落地总进度：~42% → **~52%**（+10 pp）

5 维总评（v3.21）：**🟢 / 🟡 / 🔴 / 🟡 / 🟢**（无变化——G4 PR 3 落地属于"通道可达 + helper ready"，UI 集成仍未发生）

## Round 24 真实改动清单

| 文件 | 类型 | LOC Δ |
|---|---|---|
| `src/lib/agent/pi-bridge-client.ts` | type fix | 0（type-only 改动）|
| `src/lib/agent/pi-client.ts` | 4 new image functions + truncateLineText cleanup + ResizeImagePayload import | +88 |
| `src/lib/agent/__tests__/image-bridge-helpers.test.ts` | new | +180 |
| `plan4.1.md` | doc | +135（§9.14 + header v3.20→v3.21 + doc-block 同步）|
| `docs/ROUND24_IMPLEMENTATION_REPORT.md` | new | +230（本文件）|
| `.gitignore` | allowlist | +1 |
| **总计** | | **6 files, +634** |

## 已知限制

1. **4 个 image helper 无 renderer UI 真实消费方**：本轮只新增 helper + 13 个 vitest，**真实 UI 集成（paste-image / drag-image / attachment/preview）留给 Round 25+ UI 集成 round**。
2. **没有真 IPC round-trip 测试**：mock bridge layer 覆盖 happy / error path；**真实 Electron preload + ipcMain 启动测试需要 dev-env**（Round 9 baseline 起 fts5 阻塞，本轮同上）。
3. **image bytes 跨 IPC 是 `{0,1,2,...}` plain JSON**：main-side `electron/main/agent/pi-bridge/index.ts:80` 已 `Uint8Array.from(args.bytes)` 还原。**renderer-side helper 不需要做这层转换**（bridge 客户端已封装）。
4. **G4 spec §3 G4.7 是 3 通道 resize+resizeFile+convertToPng，加 G4.6 detectMime = 4 通道**——spec 把 detectMime 列在 G4.6（单独 PR），本轮把 G4.6+G4.7 合并实现（4 通道），节省一个 round。spec PR 拆分不影响 G4 完成度计算（按通道计）。

## Round 25+ 计划

| Round | 目标 | 关键指标 |
|---|---|---|
| 25 | G4 PR 4（bridge.skills.* 3 通道：load / loadFromDir / formatForPrompt）| pi-bridge 79% → 100%（**GA gate ≥ 80% ✅**，G4 完成度 100%）|
| 26 | G8 PR 1（3 个 canonical pi 包真实 e2e）| 29/29 → 3/29 = 10% |
| 27 | G5 PR 1（generateBranchSummary 真实接入）| 集成深度形式接 → 行为切 |
| 28 | G3 PR 1（DefaultPackageManager 接入）| profile-manager.ts 806 → ≤ 200 |

**注意**：Round 25 是 G4 完成的最后一轮，也是 P0 GA gate（≥ 80%）的达成轮次。Round 25 完成后 G4 100%，G 项总进度将达 ~55%。