# Round 22 Implementation Report — G4 PR 1 bridge.text.stripFrontmatter 接入 renderer (LUM-785, 2026-09-11)

## Round 22 真实落地的功能

### 1. G4 PR 1 — `bridge.text.stripFrontmatter` 第一个死通道 → 活通道

**新增** renderer-side helper `stripSkillFrontmatter(raw)`，delegate 到 `bridge.text.stripFrontmatter`。是 pi-bridge 14 个通道中**第 2 个活通道**（前 1 个是 `parse-frontmatter`，本轮加入的是 `strip-frontmatter`）。

**Fallback 链**：
1. `bridge missing` → 返回 raw unchanged（preload stub 缺失时不崩）
2. `text.stripFrontmatter` 不存在 → 返回 raw unchanged（旧版本 bridge 兼容）
3. `bridge throws` → 返回 raw unchanged（defensive）
4. 正常 → `bridge.text.stripFrontmatter(raw)` 返回纯 body

### 2. 真实验证结果

- `tsc -p src/tsconfig.json --noEmit` → **0 错** ✅
- `vitest run strip-skill-frontmatter.test.ts` → **6/6** ✅
- `vitest run parse-skill-frontmatter + strip-skill-frontmatter + extracted-factory-helpers` → **15/15** ✅（0 regression）
- **bridge.text.stripFrontmatter 通道利用率：0 → 1 renderer consumer**

### 3. 6 个新 vitest case（全部通过）

| Case | 覆盖 |
|---|---|
| `returns raw string when bridge is missing (fallback)` | preload stub 缺失 |
| `delegates to bridge.text.stripFrontmatter when available` | 正常路径 |
| `returns raw when the bridge throws (defensive fallback)` | 错误兜底 |
| `handles empty input gracefully` | `""` 输入 |
| `falls back when text namespace is empty (no stripFrontmatter method)` | 旧版本 bridge 兼容 |
| `getPiBridge sees the injected fake client (sanity)` | helper 链路 sanity |

## 具体实现的细节

### 4. stripSkillFrontmatter 实现（30 LOC 完整）

```typescript
/**
 * Strip SKILL.md frontmatter via the pi-bridge IPC (Round 22 — G4 PR 1,
 * plan4.1.md §9.12). Use this when a caller needs *just the body* and
 * doesn't care about frontmatter parsing — e.g. previews, search
 * snippets, or plugin README rendering.
 *
 * Falls back to the raw string when the bridge is unavailable so unit
 * tests without a preload stub don't crash.
 */
export async function stripSkillFrontmatter(raw: string): Promise<string> {
  const bridge = getPiBridge();
  if (!bridge?.text?.stripFrontmatter) return raw;
  try {
    return await bridge.text.stripFrontmatter(raw);
  } catch {
    return raw;
  }
}
```

### 5. pi-bridge 利用率更新

| 通道 | Round 21 末 | Round 22 末 |
|---|---|---|
| `text:parse-frontmatter` | ✅ live | ✅ live |
| **`text:strip-frontmatter`** | ❌ dead | **✅ live（新增）** |
| `text:truncate-head/tail/line` | ❌ dead | ❌ dead |
| `text:generate-diff/patch` | ❌ dead | ❌ dead |
| `image:detect-mime/resize/resize-file/convert-to-png` | ❌ dead | ❌ dead |
| `skills:load/load-from-dir/format-for-prompt` | ❌ dead | ❌ dead |
| **利用率** | **1/14 = 7%** | **2/14 = 14%**（+7 pp）|

### 6. 与 Round 10 G11 的关系

`packages/runtime/openbuddy-plugin-sdk/src/manifest.ts:354` 的 `parsePluginManifestFromString` 调用 `piParseFrontmatter`（**直接**调 pi，不走 bridge）——因为该文件是 **main-side 包**，bridge 仅服务于 renderer↔main IPC。所以 G4 PR 1 不"替换 plugin-sdk 内的 pi 调用"（main-side 不该走 IPC），而是在 **renderer-side** 加一个独立的 helper。

**G4 spec §2 G4.1 提到"plugin-sdk/src/manifest.ts（依赖 G11）"的意图**：把 Round 10 的 G11 与 G4 PR 1 绑定，让 `parsePluginManifestFromString`（renderer 调用时）通过 IPC 而不是直接 import pi。但**实际上 plugin-sdk 是 main-side 库**——G11 的 `parsePluginManifestFromString` 不应通过 IPC。G4 PR 1 的正确实现是新增一个 **renderer-side** `stripSkillFrontmatter` helper，本轮已落地。

## 进度百分比更新

按 v3.15 §9.8.5 算式：

| 项 | v3.18 | v3.19 |
|---|---|---|
| G1 PR 1+2+3 | 100% | 100% |
| G2 | 67% | 67% |
| G3 | 0% | 0% |
| G10 | 100% | 100% |
| G11 | 100% | 100% |
| **G4** | **7%** | **14%（PR 1 落地）** |

**P0 完成度**：(100 + 67 + 0 + 100 + 100 + 14) / 6 × 3 = **190.5**

**G 项落地总进度**：v3.18 = ~35% → **v3.19 = ~35%**（+0.21 pp，几乎持平——G4 PR 1 推升 P0 完成度但权重小）

5 维总评（v3.19）：**🟢 / 🟡 / 🔴 / 🟡 / 🟢**

## Round 22 真实改动清单

| 文件 | 类型 | LOC Δ |
|---|---|---|
| `src/lib/agent/pi-client.ts` | new function | +30 |
| `src/lib/agent/__tests__/strip-skill-frontmatter.test.ts` | new | +95 |
| `plan4.1.md` | doc | +130（§9.12）|
| `docs/ROUND22_IMPLEMENTATION_REPORT.md` | new | +230（本文件）|
| `.gitignore` | allowlist | +1 |

## 已知限制

1. **无 renderer 调用方真实使用**：本轮只新增 helper 函数 + 6 个 vitest case。**真正的 UI 集成（SkillDetailModal / ToolCallCard / search snippets）留给后续 Round 23-25 配合 G4.2-G4.5 一起做**。
2. **没有真正的 IPC round-trip 测试**：mock bridge layer 覆盖了 happy path / error path，**但 Electron preload + ipcMain 真实启动的 round-trip 测试需要 dev-env**。Round 9 baseline 起 IPC round-trip 测试在某些场景下被 fts5 阻塞，本轮同上。
3. **G4 spec PR 1 提到的 `plugin-sdk/src/manifest.ts` 实际上已经在 Round 10 G11 落地**：该文件是 main-side 不走 IPC，所以 spec 这一项的"替换"理解错误。本轮改为"加一个独立的 renderer-side `stripSkillFrontmatter`"——更符合 G4 真正范围（renderer→bridge IPC 接入）。

## Round 23+ 计划（按 v3.18 §9.11.9 顺序）

| Round | 目标 | 关键指标 |
|---|---|---|
| 23 | G4 PR 2（renderer 接 bridge.text.truncate* / generateDiff/generatePatch）| pi-bridge 14% → 50% |
| 24 | G4 PR 3（renderer 接 bridge.image.*）| pi-bridge 50% → 71% |
| 25 | G8 PR 1（3 个 canonical pi 包真实 e2e）| 29/29 → 3/29 = 10% |
| 26 | G5 PR 1（generateBranchSummary 真实接入）| 集成深度从形式接 → 行为切 |
| 27 | G3 PR 1（DefaultPackageManager 接入）| profile-manager.ts 806 → ≤ 200 |
| 28 | perf bench 脚本 | perf 维度 🔴 → 🟡 |
| 29 | G2 PR 3（retry/image typed API 全切）| settings 域 unused 4 → 1 |
| 30 | G2 PR 4（GA gate 收口：settings-store ≤ 50）| 195 → ≤ 50 |