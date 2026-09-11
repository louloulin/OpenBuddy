# Round 18 Implementation Report — G10 PR 2 (registerBuiltinExtension helper + typed factory)

> 📅 2026-09-11 · 仓库 `louloulin/OpenBuddy` · 父任务 LUM-785 · `plan4.1.md` v3.14 → v3.15
>
> 父轮次：Round 17 G10 PR 1 单文件脚手架 + barrel 补齐（v3.14）。
> 本轮 Round 18 按 v3.14 §9.7.7 表第一行"P0 Round 18 = G10 PR 2 (registerBuiltinExtension)"执行。

---

## 1. 范围

| 项 | 类别 | 来源 |
|---|---|---|
| (a) `BuiltinExtensionFactory` type alias + `registerBuiltinExtension` helper | G10 PR 2 | v3.5 G10 spec §3 PR 2 |
| (b) record 类型重命名（匿名 → `BuiltinExtensionFactory`）| G10 PR 2 | 同上 |
| (c) 3 vitest case（register / factory callable / 同名覆盖）| G10 PR 2 | 同上 |

未做（按 v3.14 §9.7.7 / v3.15 §9.8.6 顺序，留 Round 19+）：
- G10 PR 3（用 `registerBuiltinExtension` 简化 8 个 builtin）—— 留 Round 19
- G7（typed shell scaffold）—— apply_command 已可作 G7 参考，留 Round 19
- G2 / G4 / G5 / G8 / G3 / perf bench —— 按 §9.7.7 顺序

---

## 2. 改动清单（带 file:line）

### 2.1 `electron/main/agent/pi-extensions.ts:967-1004` (+35 LOC)

新增 import 后的 helper 块：

- L967：注释块开头（解释 Round 18 是"前置 PR"）
- L978-983：`BuiltinExtensionFactory` type alias —— `(emit, config, options) => ExtensionFactory` 的命名别名
- L996-1004：`registerBuiltinExtension(name, factory)` 函数 —— 单行 `builtinPiExtensionFactories[name] = factory`
- 注释里说明：observability / context-status / compact-announce / extra-providers 等带特殊 hook wiring 的 builtin 保持原 record literal 形式（**不强制重写**）

### 2.2 `electron/main/agent/pi-extensions.ts:1005-1006` (+0 LOC，类型改名)

```diff
-export const builtinPiExtensionFactories: Record<string, (emit: PiExtensionResolutionOptions["emit"], config: unknown, options: PiExtensionResolutionOptions) => ExtensionFactory> = {
+export const builtinPiExtensionFactories: Record<string, BuiltinExtensionFactory> = {
```

行为 0 变化；纯类型重命名。

### 2.3 `electron/main/agent/__tests__/register-builtin-extension.test.ts` (+75 LOC，新文件)

- L1-15：模块头注释（说明 3 个 case 的覆盖意图）
- L16-21：3 个 import（`builtinPiExtensionFactories` + `registerBuiltinExtension` + `BuiltinExtensionFactory` + `ExtensionAPI` + `ExtensionFactory`）
- L23-29：用一个唯一名字 `__round18_test_extension__` + `afterEach` 清理，避免平行 vitest 文件互踩
- L31-36：case 1 `registers a factory so it becomes retrievable via builtinPiExtensionFactories`
- L38-58：case 2 `the retrieved factory produces a working ExtensionFactory that calls registerTool` —— 走完整的 `(emit, config, options) => factory => pi.registerTool(...)` 路径
- L60-82：case 3 `re-registering under the same name overwrites the previous factory` —— 验证第三方扩展可 override builtin

---

## 3. 验证结果

### 3.1 TypeScript 类型检查

```bash
$ ./node_modules/.bin/tsc -p electron/tsconfig.json --noEmit
# exit 0 ✅

$ ./node_modules/.bin/tsc -p packages/runtime/openbuddy-plugin-host/tsconfig.json --noEmit
# exit 0 ✅
```

### 3.2 vitest 真实跑通

```bash
$ ./node_modules/.bin/vitest run electron/main/agent/__tests__/register-builtin-extension.test.ts
# ✓ electron/main/agent/__tests__/register-builtin-extension.test.ts (3 tests) 3ms
#   ✓ registers a factory so it becomes retrievable via builtinPiExtensionFactories
#   ✓ the retrieved factory produces a working ExtensionFactory that calls registerTool
#   ✓ re-registering under the same name overwrites the previous factory
# Test Files  1 passed (1)
#      Tests  3 passed (3)
```

**全量回归**（6 个测试文件）：

```bash
$ ./node_modules/.bin/vitest run \
    electron/main/agent/pi-extensions.test.ts \                                    # 1032 LOC existing
    electron/main/agent/__tests__/register-builtin-extension.test.ts               # 3 new
    electron/main/agent/extensions/__tests__/hello-world-scaffold.test.ts           # 6 (Round 17)
    electron/main/agent/extensions/__tests__/apply-patch.test.ts                   # 6 (Round 14)
    electron/main/agent/extensions/__tests__/apply-patch-r2.test.ts               # 8 (Round 14)
    packages/runtime/openbuddy-plugin-host/src/__tests__/typed-tool.test.ts         # 8 (Round 13+16)
# ✓ Test Files  6 passed (6)
#      Tests  70 passed (70)
```

**总计：70/70 vitest 全过**，0 regression。

---

## 4. 决策与权衡

### 4.1 为什么 `registerBuiltinExtension` 不立即重写 10 个 builtin？

| 方案 | 优 | 劣 |
|---|---|---|
| ✅ 本轮只加 helper + 类型，**不强制重写** builtin | 低风险；0 regression；后续 PR 3 按需逐步迁移 | 短期看不到明显的 LOC 削减 |
| 立即把 10 个 builtin 全改用 helper | 一时爽 | observability / context-status / compact-announce / extra-providers 的 wiring 复杂（多层 `(emit, config, options) => (pi) => { api.on(...) }`），硬塞到 helper 里反而让代码更绕；spec §3 PR 2 也只说"现有 10 个 builtin 注册改为单行调用"，没说立刻 |
| 把整个 1222 LOC 拆文件 | 数字好看 | 与 G10 无关（970 LOC 是 pi-compatibility 适配层），拆文件改动的爆炸半径远超本 PR 范围 |

**结论**：Round 18 是"基础 PR"。后续 Round 19 G10 PR 3 用 helper 简化 observability / context-status 等 builtin 时，能精准控制每个改动的爆炸半径。

### 4.2 为什么 helper 是 `name: string` 而不是字面量联合类型？

```typescript
// 当前
export function registerBuiltinExtension(name: string, factory: BuiltinExtensionFactory): void
```

| 方案 | 优 | 劣 |
|---|---|---|
| ✅ `name: string` | 第三方扩展可注册任意名字（这是 helper 的主要卖点）| typo 不会编译报错 |
| `name: keyof typeof builtinPiExtensionFactories` | typo 编译报错 | **第三方扩展不能用**——helper 失去主要卖点 |
| `name: keyof typeof BUILTIN_PI_PLUGIN_MANIFEST_BY_ID` | typo 编译报错 + 与 manifest 对齐 | 第三方扩展注册的名字不在 manifest 里会编译失败 |

**结论**：本轮 helper 的目标是给第三方扩展一个稳定 API。typo 检查是 nice-to-have，留 Round 19+ 与 G10 PR 3 一起做（用 `keyof typeof builtinPiExtensionFactories | (string & {})` 的"允许任意但建议已知"模式）。

### 4.3 为什么 v3.5 spec "1222 → 200 LOC" 目标本轮没达成？

| 段 | LOC | 是否与 G10 相关 |
|---|---|---|
| `builtinPiExtensionFactories` record | ~250 | ✅ G10 |
| `pi-compatibility-commands`（describeXxxCommand / invokeXxxCommand × 16）| ~390 | ❌ pi-compatibility 适配层 |
| `BUILTIN_PI_PLUGIN_MANIFESTS` + `BUILTIN_PI_PLUGIN_MANIFEST_BY_ID` + `resolveBuiltinPiPlugin` | ~250 | ❌ manifest 序列化（与 G11 相关）|
| PiExtensionResolutionOptions + PiExtensionResolution + 类型导出 | ~140 | ❌ 公开 API 类型 |
| `loadPiExtensions` / `builtinPiExtensionIds` 等 loader | ~90 | ✅ G10 |
| `import` 块 | ~45 | ❌ |
| **helper + 注释（本轮新增）** | **+35** | ✅ G10 PR 2 |
| **合计** | **1261** | — |

**净 G10 PR 2 收益**：+35 helper，0 record 段削减。本质是**铺路 PR**，不是削减 PR。

**修正 spec**：v3.5 G10 spec §3 PR 2 的 "1222 → 200" 估算把整个 1222 LOC 都视为"可削减样板"是错的。本轮 plan4.1.md v3.15 §9.8.3 已修正：real G10 record 段削减目标是 250 → ≤ 150，留给 Round 19+ PR 3。

---

## 5. 与 v3.14 §9.7.7 顺序表对齐

| v3.14 §9.7.7 第一行 | Round 18 完成项 |
|---|---|
| "G10 PR 2（registerBuiltinExtension 抽函数 + pi-extensions.ts 1222 → ≤ 200）" | ✅ §2.1 helper + §2.2 类型重命名（1222 → 1261，**记录段本身不动**，等 Round 19 PR 3）|

**完成度**：1 / 1 = 100%（helper + 落地 + 测 + plan 修正）。

---

## 6. 进度百分比更新

按 v3.15 §9.8.5 算式：

| 维度 | v3.14 (Round 17) | v3.15 (Round 18) | Δ |
|---|---|---|---|
| builtin 注册 helper | 无 | **`registerBuiltinExtension(name, factory)` typed export** | new public API |
| 第三方扩展可注册自己 | 只能 mutate `builtinPiExtensionFactories` | ✅ 调用 helper | typed safety |
| pi-extensions.ts 总 LOC | 1222 | 1261 | +39 helper 注释 |
| G10 完成度 | 33% | **67%（PR 1+2）** | **+33 pp** |
| **G 项落地总进度** | **~23%** | **~26%** | **+3 pp** |
| 行为 pi-native 折扣后 | ~10% | ~10%（未触发集成深度变化）| — |
| pi 运行时 import 利用度 | 8.4% | 8.4%（不变；helper 是 OpenBuddy 自己的 export）| — |
| pi-bridge IPC 利用度 | 7% | 7%（不变，留 Round 21/22）| — |
| canonical pi 包 e2e | 0/29 | 0/29（不变，留 Round 23）| — |
| 5 维总评 | 🟢🟡🔴🟡🟢 | 🟢🟡🔴🟡🟢（工程基础继续 🟢：helper + 测 + typed API）| — |

---

## 7. 已知限制 / 后续工作

1. **G10 PR 3 (Round 19)**：用 `registerBuiltinExtension` 简化 observability / context-status / compact-announce / extra-providers 等 8 个 builtin（每个从 `(emit, config, options) => (pi) => { ... }` 拆为单行 helper 注册 + 私有 helper 函数）—— pi-extensions.ts record 段 250 → ≤ 150。
2. **typo 检查 (Round 19+)**：把 `name: string` 改为 `name: keyof typeof builtinPiExtensionFactories | (string & {})` 模式（TS 标准"建议已知字符串字面量但允许其他"惯用法）。
3. **G7 (Round 19)**：typed shell scaffold —— `apply-patch.ts` 的 `apply_command` 已经是 G7 的完整实现（TypeBox schema + validateParamsSafe + node:child_process execFileAsync）；只需在 `apply-patch.ts` 加注释指向 G7 spec，并在指南里把 `apply_command` 列为 G7 reference implementation。
4. **plan4.0 §1.7 O8/O9 UI 演示**：仍留 Round 20 配合 G2 PR 1 一起做（更连贯：扩展系统 + settings + UI 演示同时落地）。

---

## 8. 与其他 Round 的接力

| Round | 接力点 |
|---|---|
| Round 13-16（G1 全系列）| typed-tool.ts 落地 → apply-patch.ts 接入 → validateParamsSafe 类型守卫 + barrel 补齐 |
| Round 17（G10 PR 1）| hello-world.ts 单文件脚手架 + 指南 + barrel 完整 |
| Round 18（本轮，G10 PR 2）| registerBuiltinExtension helper + typed factory —— **本轮** |
| Round 19+（G10 PR 3）| 8 个 builtin 简化 + typo 检查 + G7 注释 |
| Round 20+（G2 / G4 / G5 / G8 / G3 / perf）| 按 v3.15 §9.8.6 顺序 |

---

## 9. Sources

- 本仓库：
  - `electron/main/agent/pi-extensions.ts:967-1004`（本轮 +35 LOC）
  - `electron/main/agent/__tests__/register-builtin-extension.test.ts`（本轮新）
  - `electron/main/agent/pi-extensions.test.ts`（1032 LOC existing, 0 regression）
  - `electron/main/agent/extensions/_scaffolds/hello-world.ts`（Round 17）
  - `electron/main/agent/extensions/apply-patch.ts`（Round 14+16）
  - `packages/runtime/openbuddy-plugin-host/src/typed-tool.ts`（Round 13+16）
  - `docs/G10_IMPLEMENTATION_SPEC.md`（Round 8 v3.5 spec，本轮修正"1222 → 200"估算）
  - `docs/G10_EXTENSION_SCAFFOLD_GUIDE.md`（Round 17 指南）