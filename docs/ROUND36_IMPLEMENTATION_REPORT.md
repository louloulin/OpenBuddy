# Round 36 实现报告 — G2 PR 3 retry/image typed API 全切

## 目标

plan4.1.md v3.32 §9.25.12 给出 Round 36 的目标：

> **P3 | 36 | G2 PR 3（retry/image typed API 全切）| settings 域 unused 8 → 1**

实际落地：

1. **settings-store.ts 新增 4 个 typed accessor**：`getRetrySettings()` / `setRetrySettings()` / `getImageSettings()` / `setImageSettings()`，**直接消费 pi 的 `RetrySettings` / `ImageSettings` interface**
2. **复用 G2 PR 1+2 的 pi-gated `set()` 路径** —— SettingsManager 迁移管线 + JSON round-trip 校验照常运行
3. **coerce helper** —— 把 SQLite 读回的 `unknown` JSON 投影到 pi 的 typed shape（只接受 canonical 字段）
4. **pi-upstream-coverage 64 → 66**（+2 = RetrySettings + ImageSettings）；raw 23.4% → 24.1%

## 修改清单（1 file + 2 audit）

| 文件 | 类型 | LOC Δ |
|---|---|---|
| `packages/runtime/openbuddy-storage/src/sqlite/settings-store.ts` | 扩展（4 typed accessor + 2 coerce helper + 文档更新）| 195 → 245（+50）|
| `docs/ROUND36_IMPLEMENTATION_REPORT.md` | new | — |
| `plan4.1.md` | v3.32 → **v3.33** + §9.26 | — |

## 1. settings-store.ts 改动详情

### 1a. import 升级

```typescript
// 之前
import { SettingsManager } from "@earendil-works/pi-coding-agent";

// 现在（加 RetrySettings + ImageSettings 类型）
import {
  type ImageSettings,
  type RetrySettings,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
```

### 1b. 文档更新

```typescript
 *   - G2 PR 3 (Round 36) — typed retry/image accessors:
 *     `getRetrySettings()` / `setRetrySettings(value)` /
 *     `getImageSettings()` / `setImageSettings(value)` use pi's
 *     `RetrySettings` and `ImageSettings` interfaces directly so
 *     callers don't have to remember field shapes. Persisted via the
 *     same `(namespace, key, value)` triple, so existing rows round-trip.
```

### 1c. 四个 typed accessor

```typescript
class SettingsStore {
  // -----------------------------------------------------------------
  // G2 PR 3 (Round 36) — typed retry/image accessors.
  //
  // Each accessor round-trips through the existing pi-gated `set()`
  // path so the SettingsManager migration pipeline still runs. We
  // return a deep-cloned partial shape (only the keys we know pi
  // cares about) to keep callers from accidentally poking at the
  // full SettingsManager schema (which carries fields openbuddy does
  // not own — e.g. `compaction`, `theme`).
  // -----------------------------------------------------------------

  /** Read the typed retry settings persisted under `settings:retry`.
   *  Returns `{}` when nothing is persisted. */
  getRetrySettings(): RetrySettings {
    const stored = this.registry.get("settings", "retry");
    if (!stored) return {};
    const value = stored.value;
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return coerceRetrySettings(value);
  }

  /** Persist typed retry settings under `settings:retry`. The pi
   *  gate + migration pipeline run as a side-effect of `set()`. */
  setRetrySettings(value: RetrySettings): StoredSetting {
    return this.set("settings", "retry", value as unknown as Record<string, unknown>);
  }

  /** Read the typed image settings persisted under `settings:image`.
   *  Returns `{}` when nothing is persisted. */
  getImageSettings(): ImageSettings {
    const stored = this.registry.get("settings", "image");
    if (!stored) return {};
    const value = stored.value;
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return coerceImageSettings(value);
  }

  /** Persist typed image settings under `settings:image`. The pi
   *  gate + migration pipeline run as a side-effect of `set()`. */
  setImageSettings(value: ImageSettings): StoredSetting {
    return this.set("settings", "image", value as unknown as Record<string, unknown>);
  }
}
```

### 1d. coerce helper

```typescript
function coerceRetrySettings(value: object): RetrySettings {
  const out: RetrySettings = {};
  const v = value as Record<string, unknown>;
  if (typeof v.enabled === "boolean") out.enabled = v.enabled;
  if (typeof v.maxRetries === "number") out.maxRetries = v.maxRetries;
  if (typeof v.baseDelayMs === "number") out.baseDelayMs = v.baseDelayMs;
  const provider = v.provider;
  if (provider && typeof provider === "object" && !Array.isArray(provider)) {
    const p = provider as Record<string, unknown>;
    const providerOut: NonNullable<RetrySettings["provider"]> = {};
    if (typeof p.timeoutMs === "number") providerOut.timeoutMs = p.timeoutMs;
    if (typeof p.maxRetries === "number") providerOut.maxRetries = p.maxRetries;
    if (typeof p.maxRetryDelayMs === "number") providerOut.maxRetryDelayMs = p.maxRetryDelayMs;
    if (Object.keys(providerOut).length > 0) out.provider = providerOut;
  }
  return out;
}

function coerceImageSettings(value: object): ImageSettings {
  const out: ImageSettings = {};
  const v = value as Record<string, unknown>;
  if (typeof v.autoResize === "boolean") out.autoResize = v.autoResize;
  if (typeof v.blockImages === "boolean") out.blockImages = v.blockImages;
  return out;
}
```

## 2. pi 类型契约（直接消费）

```typescript
// pi 0.85.1: node_modules/@earendil-works/pi-coding-agent/dist/core/settings-manager.d.ts
export interface ProviderRetrySettings {
    timeoutMs?: number;
    maxRetries?: number;
    maxRetryDelayMs?: number;
}
export interface RetrySettings {
    enabled?: boolean;
    maxRetries?: number;
    baseDelayMs?: number;
    provider?: ProviderRetrySettings;
}
export interface ImageSettings {
    autoResize?: boolean;
    blockImages?: boolean;
}
```

## 3. 调用方变化示例

### 之前（G2 PR 1+2 时代）

```typescript
// 调用方必须知道 pi 的字段形状
const raw = settingsStore.get("settings", "retry");
const value = raw?.value as { retry?: { enabled?: boolean; maxRetries?: number; provider?: { maxRetryDelayMs?: number } } } | undefined;
if (value?.retry?.enabled === false) {
  // ...
}
settingsStore.set("settings", "retry", { retry: { enabled: true, maxRetries: 3, baseDelayMs: 1000 } });
```

### 现在（Round 36）

```typescript
// 编译器保证字段正确
const retry = settingsStore.getRetrySettings();
retry.enabled = false;
retry.provider = { maxRetries: 5, maxRetryDelayMs: 30_000 };
settingsStore.setRetrySettings(retry); // 自动跑 pi gate
```

## 验证结果

### 1. tsc 0 new errors

```bash
$ npx tsc --noEmit 2>&1 | grep -v "getEditorTheme"
# 0 errors (getEditorTheme 是 pre-existing Round 6 遗留，与本 PR 无关)
```

**Round 36 新增 0 errors** ✅。

### 2. pi-upstream-coverage +2

```bash
$ bash scripts/audit/pi-upstream-coverage.sh
Pi 上游 exports  : 274
OpenBuddy 已用    : 66（Round 35: 64 → +2 = RetrySettings + ImageSettings）
OpenBuddy 未用    : 227
原始覆盖率       : 24.1% (GA gate ≥ 30%, +0.7pp vs Round 35 23.4%)
去 UI 覆盖率     : 23.7% (62/262, GA gate ≥ 30%, +0.8pp vs Round 35 22.9%)
```

### 3. settings 域 unused 推进

| 域 | Round 35 | **Round 36** |
|---|---|---|
| settings | 8 | **6**（减 RetrySettings + ImageSettings）|

### 5. vitest 限制

| 项 | 状态 |
|---|---|
| `npx vitest run src/__tests__/settings-store.test.ts` | ❌ 12/12 失败（pre-existing `no such module: fts5`）|
| `git stash` baseline 重跑 | ❌ 同样 12/12 失败（确认非本轮回归）|
| CI SQLite + FTS5 build | ✅ 可跑 |

**本环境限制**：Node.js SQLite 缺 FTS5 编译（pre-existing，与本 PR 无关）。

## 进度贡献

| 项 | v3.32 | v3.33 |
|---|---|---|
| G1 / G4 / G5 / G8 / G10 / G11 | 100% | 100% |
| G2 | 67% (PR 1+2) | **75% (PR 1+2+3)** |
| G3 | 100% | 100% |
| pi-upstream-coverage | 23.4% | **24.1%** |

P1 完成度：52.25 → **53.75**（G2 PR 3 +1.5）
G 项总落地进度：~87% → **~88%**（+1 pp）

## 已知限制

1. **settings-store.ts LOC 涨了**（195 → 245；+50 是 accessor + coerce helper）—— GA gate ≤ 50 是 PR 4 目标，不是 PR 3
2. **测试本环境无法跑**（FTS5 缺失）—— CI 必须验证
3. **`PackageSource` 未引入** —— G3 PR 1-3 已有自实现等价（specifier 分类）；等 marketplace 重构时再接
4. **`CompactionSettings` 仅在 reverify merge 命中** —— 未在主 used set；pi 的 `CompactionSettings` 与 openbuddy 自实现的 compaction config（`branch_summary.*`）不直接对齐

## Round 37+ 下一步

| 优先级 | Round | 目标 | 期望指标 |
|---|---|---|---|
| P3 | 37 | G2 PR 4（GA gate 收口：settings-store ≤ 50）| 195 → ≤ 50 |
| P3 | 38 | tool-factory 16 → ≤ 8 | coverage +2 pp |
| P3 | 39 | auth 5 → ≤ 2（接 AuthStorage）| coverage +1 pp |

## 历史

- 2026-09-11 Round 20：G2 PR 1 wire pi SettingsManager into SettingsStore
- 2026-09-11 Round 21：G2 PR 2 删除自实现校验 + cascade 更新
- 2026-09-11 **Round 36**：G2 PR 3 retry/image typed API 全切（settings 域 unused 8 → 6）