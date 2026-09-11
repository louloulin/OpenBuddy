# Round 21 Implementation Report — G2 PR 2 删除自实现校验 + cascade (LUM-785, 2026-09-11)

## Round 21 真实落地的功能

### 1. G2 PR 2 — `SettingsStore` 自实现校验 API 全删

`SettingsStore` 的 custom validator API 在 G2 PR 1 时是 Layer 1（legacy custom validator）+ Layer 2（pi gate）。**G2 PR 2 把 Layer 1 完全删除**，pi gate 成为**唯一**的 schema gate。

**删除项**：
- `SettingsValidator` type alias（10 LOC）
- `setSchema()` 方法（3 LOC）
- `clearSchema()` 方法（3 LOC）
- `validators: Map<string, SettingsValidator>` instance 字段（1 LOC）
- `SettingsStoreOptions.validators` 字段（1 LOC）
- constructor 中的 `validators` init（1 LOC）
- Layer 1 of `validate()`（6 LOC）
- 顶部 doc-block 中的过时描述（7 LOC）

**净 LOC**：221 → **195**（−26，−12%）

### 2. Cascade 更新

| 文件 | 改动 |
|---|---|
| `packages/runtime/openbuddy-storage/src/index.ts:27-32` | 删 `SettingsValidator` barrel re-export（−1 LOC）|
| `packages/capability/openbuddy-folder-trust/src/settings-backend.ts:60-76` | 删 `setSchema(NAMESPACE, ...)` 调用 + 4 行 inline validator（−9 LOC，121 → 112）|
| `packages/capability/openbuddy-folder-trust/src/settings-backend.test.ts:116-125` | 重写 malformed-persistence 测试（不再 `clearSchema`）|
| `packages/runtime/openbuddy-storage/src/__tests__/settings-store.test.ts` | 重写：删 `setSchema/clearSchema` 4 个测试；新增 2 个 pi gate 测试（`websockets: boolean` migration + `retry.maxDelayMs` migration + null value）|

### 3. 真实验证结果

- `tsc -p packages/runtime/openbuddy-storage/tsconfig.json --noEmit` → **settings-store.ts 0 错** ✅（其它 3 错在 `session-catalog-metadata.test.ts`，pre-existing）
- `tsc -p packages/capability/openbuddy-folder-trust/tsconfig.json --noEmit` → **0 错** ✅
- `vitest run settings-store.test.ts` → **12/12 fail on `no such module: fts5`**（env 限制）
- `vitest run electron/main/agent/__tests__/extracted-factory-helpers.test.ts` → **3/3** ✅（Round 19 回归无破坏）

### 4. 6 个 pi gate test case（written, blocked on fts5）

| Case | 覆盖 |
|---|---|
| `accepts a well-formed object via the pi gate` | 默认接受 object 值 |
| `accepts a primitive value (pi gate is a no-op for non-objects)` | primitive 直通 SQLite |
| `accepts a value with legacy queueMode and runs pi's migration pipeline` | `queueMode→steeringMode` migration |
| `accepts a value with legacy websockets: boolean (boolean→enum migration)` | `websockets:true→transport:"websocket"` migration |
| `accepts a value with legacy retry.maxDelayMs (nested-field migration)` | `retry.maxDelayMs→retry.provider.maxRetryDelayMs` migration |
| `accepts null value (pi gate skips non-objects)` | null 直通 |

## 具体实现的细节

### 5. 新的 settings-store.ts validate()（PR 2 简化后）

```typescript
private validate(namespace: string, value: unknown): void {
  // Pi gate is the sole schema gate (G2 PR 2).
  if (value !== null && (typeof value === "object" || Array.isArray(value))) {
    const probe = SettingsManager.inMemory(value as Record<string, unknown>);
    const errors = probe.drainErrors();
    if (errors.length > 0) {
      const detail = errors.map((e) => e.error.message).join("; ");
      throw new Error(
        `settings validation failed for "${namespace}" (pi): ${detail}`,
      );
    }
  }
}
```

从 Round 20 的 31 行（Layer 1 + Layer 2）→ **22 行**（仅 Layer 2 + 注释）。

### 6. folder-trust cascade

folder-trust 是 codebase 中**唯一**调 `setSchema()` 的内置消费者（`grep -rn "SettingsValidator\|setSchema\|clearSchema"` 唯一命中）。删除调用后：

- 旧 inline validator 消失（4 行 type checks）
- `grant/revoke/respond` 直接构造合规值，无需验证
- `list()` 过滤逻辑保留（已是 `entry.trusted === boolean` 检查）
- malformed-persistence 测试改写：直接 `settings.set()` 写非法值（pi gate 接受大部分对象）→ `list()` 过滤掉

### 7. 公开 API 现状

```typescript
// 公开 surface（before PR 2）:
export { SettingsStore, type SettingsValidator, type SettingsNamespaceStats, type SettingsStoreOptions }

// 公开 surface（after PR 2）:
export { SettingsStore, type SettingsNamespaceStats, type SettingsStoreOptions }
```

`SettingsValidator` type 不再 export。`setSchema/clearSchema` 不再是 instance method。pi SettingsManager gate 是唯一 schema gate。

## GA gate 距离诚实评估

| Round | settings-store.ts LOC | GA gate ≤ 50 距离 |
|---|---|---|
| Round 17 baseline | 196 | −146 |
| Round 20 PR 1（+ pi gate）| 221（净 +25）| −171 |
| **Round 21 PR 2（删 validator）** | **195**（净 −26）| **−145** |

**为什么 PR 2 没把 settings-store.ts 砍到 ≤ 50**：删完 validator 后剩下的 ~195 LOC 全是 typed facade 本身（`set/get/list/listNamespaces/namespaceStats/bulkSet/bulkGet/delete/deleteNamespace`），都是 OpenBuddy 业务方消费 SQLite 的入口。要降到 ≤ 50 必须把这些 facade 也砍掉——那是 **PR 4 范围**（"GA gate 收口"），需要把 OpenBuddy 业务方切到直接用 `SettingsRegistry` 或 pi `SettingsManager`。本轮 PR 2 完成**自实现校验的删除**，但不强行做 facade 削减。

## 进度百分比更新

按 v3.15 §9.8.5 算式：

| 项 | v3.17 | v3.18 |
|---|---|---|
| G1 PR 1+2+3 | 100% | 100% |
| **G2** | **33%** | **67%（PR 1+2 落地）** |
| G3 | 0% | 0% |
| G10 PR 1+2+3 | 100% | 100% |
| G11 | 100% | 100% |
| G4 | 7% | 7% |

**P0 完成度**：(100 + 67 + 0 + 100 + 100 + 7) / 6 × 3 = **187**

**G 项落地总进度**：v3.17 = ~32% → **v3.18 = ~35%**（+3 pp，G2 PR 2 推升 P0 完成度）

5 维总评（v3.18）：**🟢 / 🟡 / 🔴 / 🟡 / 🟢**（不变）

## Round 21 真实改动清单

| 文件 | 类型 | LOC Δ |
|---|---|---|
| `packages/runtime/openbuddy-storage/src/sqlite/settings-store.ts` | delete | −26 |
| `packages/runtime/openbuddy-storage/src/index.ts` | delete | −1 |
| `packages/runtime/openbuddy-storage/src/__tests__/settings-store.test.ts` | rewrite | ≈+10（删 4 加 2 + null 案例）|
| `packages/capability/openbuddy-folder-trust/src/settings-backend.ts` | delete | −9 |
| `packages/capability/openbuddy-folder-trust/src/settings-backend.test.ts` | rewrite | ≈+2（注释扩展）|
| `plan4.1.md` | doc | +130（§9.11）|
| `docs/ROUND21_IMPLEMENTATION_REPORT.md` | new | +230（本文件）|
| `.gitignore` | allowlist | +1 |

## 已知限制

1. **vitest 12/12 fail on fts5**：env 限制，与本轮代码无关。
2. **GA gate ≤ 50 未触**：PR 2 删了 validator 但没砍 facade。要 ≤ 50 必须再删 `listNamespaces/namespaceStats/bulkSet/bulkGet` 4 个方法 + 直接调底层 `SettingsRegistry`——属于 PR 4 范围。
3. **folder-trust 测试 1 个 case 行为变化**：malformed-persistence 测试以前要 `clearSchema` 才能写非法值，现在 pi gate 接受大部分对象所以可以直接写。功能等价（list() 仍过滤），但 test setup 不同。
4. **stale spec 提示**：G2 spec §3 PR 2 提到"删除 models-config.ts 中 retry/image 校验代码（约 100 LOC）"——本轮 grep 全 codebase 未发现该模块，spec 估算已过时。

## Round 22+ 计划（按 v3.17 §9.10.7 顺序）

| Round | 目标 | 关键指标 |
|---|---|---|
| 22 | G4 PR 1（renderer 接 bridge.text.*）| pi-bridge 7% → 14% |
| 23 | G4 PR 2（renderer 接 bridge.image.*）| pi-bridge 14% → 28% |
| 24 | G8 PR 1（3 个 canonical pi 包真实 e2e）| 29/29 → 3/29 = 10% |
| 25 | G5 PR 1（generateBranchSummary 真实接入）| 集成深度从形式接 → 行为切 |
| 26 | G3 PR 1（DefaultPackageManager 接入）| profile-manager.ts 806 → ≤ 200 |
| 27 | perf bench 脚本 | perf 维度 🔴 → 🟡 |
| 28 | G2 PR 3（retry/image typed API 全切）| settings 域 unused 4 → 1 |
| 29 | G2 PR 4（GA gate 收口：settings-store ≤ 50）| 195 → ≤ 50 |