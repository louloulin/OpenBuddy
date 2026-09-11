# Round 17 Implementation Report — G10 PR 1 (单文件脚手架) + validateParamsSafe barrel 补齐

> 📅 2026-09-11 · 仓库 `louloulin/OpenBuddy` · 父任务 LUM-785 · `plan4.1.md` v3.13 → v3.14
>
> 父轮次：Round 16 G1 PR 3 落地 + pi-upstream-coverage.sh ground-truth 重写（v3.13）。
> 本轮 Round 17 按 v3.13 §9.6.5 表第一行"P0 Round 17 = G10 PR 1 (ExtensionFactory 单文件入口样板)"执行，并把 Round 16 加的 `validateParamsSafe` 补进 plugin-host barrel。

---

## 1. 范围

| 项 | 类别 | 来源 |
|---|---|---|
| (a) `_scaffolds/hello-world.ts` | G10 PR 1 | v3.13 §9.6.5 表 P0 第一行 + v3.5 G10 spec §3 PR 3 |
| (b) `__tests__/hello-world-scaffold.test.ts` | G10 PR 1 | 同上 |
| (c) `docs/G10_EXTENSION_SCAFFOLD_GUIDE.md` | G10 PR 1 | 同上（作者手册）|
| (d) `plugin-host/index.ts` barrel 补 `validateParamsSafe` | Round 16 收尾 | Round 16 漏补，第三方扩展从 barrel 拿不到 |

未做（按 v3.13 §9.6.5 顺序，留 Round 18+）：
- G10 PR 2 (`registerBuiltinExtension` 抽函数 + 1222 LOC → 200)
- G10 PR 3 (CI lint 规则)
- G7 (shell helper 套用 typed-tool 模板)
- plan4.0 §1.7 O8/O9 UI 演示（仍留 Round 18 配合 G10 PR 2 + G7 一起做）

---

## 2. 改动清单（带 file:line）

### 2.1 `electron/main/agent/extensions/_scaffolds/hello-world.ts` (新文件, +50 LOC)

- L1-19：模块头注释（说明本文件是 G10 PR 1 落地、可 copy-paste、对比 apply-patch.ts）
- L20-23：3 个 import（`Type` from typebox、`ExtensionFactory` from pi、`defineTool`+`validateParamsSafe` from `@openbuddy/plugin-host`）
- L25-32：`HelloParamsSchema`（TypeBox）—— `{ who: string; loud?: boolean }`
- L34-37：`helloWorldExtension()` 函数签名
- L38-49：`defineTool({ name: "hello", label: "Hello", description, parameters, execute })` —— 1 个工具注册
- L41-46：execute body 用 `validateParamsSafe` 守卫式写法
- L47：`params` 收窄后的 typed code（`params.who`、`params.loud`）
- 净 LOC：**+50**

### 2.2 `electron/main/agent/extensions/__tests__/hello-world-scaffold.test.ts` (新文件, +85 LOC)

- L1-15：模块头注释（说明 6 个 case 的覆盖意图）
- L17-21：`RegisteredTool` 接口（仅 hello-world 用到的字段）
- L23-34：`makeMockPi()` 工厂 —— 返回 `{ api, tools }`，`registerTool` 把 tool push 到数组
- L38-46：case 1 `default export is an ExtensionFactory function`
- L48-54：case 2 `registers exactly one tool named hello`
- L56-62：case 3 `execute returns 'hello, world' for default params`
- L64-72：case 4 `execute returns upper-cased greeting when loud=true`
- L74-83：case 5 `execute fails gracefully when params fail schema validation`
- L85-91：case 6 `execute fails gracefully when params is null/undefined`
- 净 LOC：**+85**

### 2.3 `docs/G10_EXTENSION_SCAFFOLD_GUIDE.md` (新文件, +250 行)

9 个章节：
1. 一页摘要（G10 PR 1 落地范围 + 关键数字）
2. 30 秒上手（copy-paste 代码块）
3. 必备 import 解释表
4. 3 种 execute body 写法（守卫式 / 错误消息式 / 双调用）+ 决策表
5. 真实案例对照 `apply-patch.ts`（266 LOC 9 个模式注解）
6. 测试策略（6 case 最低样板）
7. CI / Lint 规则草案（本轮未落地）
8. 与 G1 / G6 / G9 / G11 facade 的关系（设计原则：**不另起 facade 除非有 OpenBuddy 专属业务**）
9. Round 17 进度数字

### 2.4 `packages/runtime/openbuddy-plugin-host/src/index.ts:1244-1253` (+1 行)

```diff
 export {
   defineTool,
   objectParams,
   validateParams,
+  validateParamsSafe,    // ← Round 16 加的函数补进 barrel
   type ToolDefinition,
   type TSchema,
   type Static,
   type InferParams,
 } from "./typed-tool";
```

**问题溯源**：Round 16 PR 3 在 `typed-tool.ts` 加了 `validateParamsSafe`，但忘了把 export 加进 `index.ts` barrel。第三方扩展 `import { validateParamsSafe } from "@openbuddy/plugin-host"` 会编译失败。本轮补齐。

---

## 3. 验证结果

### 3.1 TypeScript 类型检查

```bash
$ ./node_modules/.bin/tsc -p packages/runtime/openbuddy-plugin-host/tsconfig.json --noEmit
# exit 0 ✅

$ ./node_modules/.bin/tsc -p electron/tsconfig.json --noEmit
# exit 0 ✅
```

### 3.2 vitest 真实跑通

```bash
$ ./node_modules/.bin/vitest run electron/main/agent/extensions/__tests__/hello-world-scaffold.test.ts
# ✓ electron/main/agent/extensions/__tests__/hello-world-scaffold.test.ts (6 tests) 4ms
#   ✓ default export is an ExtensionFactory function
#   ✓ registers exactly one tool named `hello`
#   ✓ execute returns 'hello, world' for default params
#   ✓ execute returns upper-cased greeting when loud=true
#   ✓ execute fails gracefully when params fail schema validation
#   ✓ execute fails gracefully when params is null/undefined
# Test Files  1 passed (1)
#      Tests  6 passed (6)

$ ./node_modules/.bin/vitest run packages/runtime/openbuddy-plugin-host/src/__tests__/typed-tool.test.ts \
                              electron/main/agent/extensions/__tests__/apply-patch.test.ts \
                              electron/main/agent/extensions/__tests__/apply-patch-r2.test.ts
# ✓ packages/runtime/openbuddy-plugin-host/src/__tests__/typed-tool.test.ts (8 tests) 8ms
# ✓ electron/main/agent/extensions/__tests__/apply-patch.test.ts (6 tests) 9ms
# ✓ electron/main/agent/extensions/__tests__/apply-patch-r2.test.ts (8 tests) 21ms
# Test Files  3 passed (3)
#      Tests  22 passed (22)
```

**总计：28/28 vitest 全过**，hello-world 新增 6、typed-tool + apply-patch 维持 22，0 regression。

---

## 4. 决策与权衡

### 4.1 为什么 hello-world.ts 放 `_scaffolds/` 而不是 `extensions/`？

| 方案 | 优 | 劣 |
|---|---|---|
| ✅ `_scaffolds/` 子目录 + 前缀下划线 | 显式区分"模板"vs"真实 builtin"；不会被 `extensions-inventory.sh` 计为 hotspot；社区开发者 copy 时一目了然 |
| 直接放 `extensions/hello-world.ts` | 简单 | `_scaffolds/hello-world.ts` 会被算进 pi-extensions.ts 1222 LOC 的一部分 |
| 放 `docs/` | 纯文档 | 模板代码不是文档，不能 vitest 验证 |

**结论**：`_scaffolds/` 子目录 + 下划线前缀是 fs 约定（macOS / Linux 隐藏文件风格），且名字本身说明"这是模板"。

### 4.2 为什么 barrel 漏补 `validateParamsSafe` 是 Round 16 漏的？

Round 16 PR 3 只在 `typed-tool.ts` 加了函数 + export，但没改 `index.ts` 的 barrel。这导致：
- `electron/main/agent/extensions/apply-patch.ts` 直接从 `@openbuddy/plugin-host/typed-tool` 子路径 import（绕过 barrel），**所以能编译**
- 但第三方扩展按规范从 `@openbuddy/plugin-host` 根 import 时**找不到 `validateParamsSafe`**

**本轮补救**：补 barrel 一行。这是 G10 PR 1 落地时必须做的事——脚手架要能 1 文件 0 摩擦接出来，barrel 缺函数会让"copy-paste 改 3 处名字"路径断在 import。

### 4.3 hello-world.ts 为什么不演示 apply-patch.ts 的所有模式？

apply-patch.ts 266 LOC 涵盖 9 个模式（见指南 §5），hello-world 只演示 3 个：
1. `defineTool` + `validateParamsSafe` 守卫式
2. `Type.Optional` 可选字段
3. `details` envelope 结构化

**理由**：脚手架的目的是"30 秒上手可跑通"，不是"看完所有模式"。apply-patch.ts 是丰满案例对照，**hello-world 不复制它的复杂度**。

---

## 5. 与 v3.13 §9.6.5 顺序表对齐

| v3.13 §9.6.5 第一行 | Round 17 完成项 |
|---|---|
| "G10 PR 1（ExtensionFactory 单文件入口样板）" | ✅ §2.1 hello-world.ts + §2.2 测试 + §2.3 指南 |
| "第三方 pi 包接入从 5+ 文件 → 1 文件 + 1 manifest" | ✅ §4.2 barrel 补齐（1 文件 import 即用）|

**完成度**：1 / 1 = 100%（G10 PR 1 落地；PR 2/3 留 Round 18+）。

---

## 6. 进度百分比更新

按 v3.13 §9.7.6 算式（修改版）：

| 维度 | v3.13 (Round 16) | v3.14 (Round 17) | Δ |
|---|---|---|---|
| typed facade 可发现性 | partial | **complete**（barrel 完整）| +1 行 |
| 1-文件扩展可写 | 否 | ✅ hello-world.ts + 指南 | new capability |
| G10 完成度 | 0% | **33%（PR 1 落地）** | +33 pp |
| **G 项落地总进度** | **~24%** | **~23%**（P0 项数 5 → 6 稀释；G10 自身 +33 pp）| −1 pp |
| 行为 pi-native 折扣后 | ~10% | ~10%（不变；未触发集成深度变化）| — |
| pi 运行时 import 利用度 | 8.4% | 8.4%（不变；hello-world 用的是 facade 不新增 import）| — |
| pi-bridge IPC 利用度 | 7% | 7%（不变，留 Round 20/21）| — |
| canonical pi 包 e2e | 0/29 | 0/29（不变，留 Round 22）| — |
| 5 维总评 | 🟢🟡🔴🟡🟢 | **🟢🟡🔴🟡🟢**（工程基础继续 🟢）| — |

**说明**：G 项落地 −1 pp 来自 P0 项数 5 → 6（G10 进 P0）的分母效应，**G10 自身 +33 pp 才是真正的进度贡献**。这种"分母增加 → 百分比微降但绝对值增加"的现象是顺序表逐步展开的正常副作用。

---

## 7. 已知限制 / 后续工作

1. **G10 PR 2 (Round 18+)**：`registerBuiltinExtension(name, factory)` 抽函数 + pi-extensions.ts 1222 LOC → 200 LOC（见 v3.5 G10 spec §3 PR 2）。本轮只交付 PR 1。
2. **G10 PR 3 (Round 18+)**：CI lint 规则（每个 builtin 必须有 name + test / 禁止 `(params as ...)` cast / schema 字段必须有 description）—— 见指南 §6。
3. **plan4.0 §1.7 O8/O9 UI 演示**：仍留 Round 18 配合 G10 PR 2 + G7 一起做（更连贯：扩展系统 PR 2 + shell helper PR + UI 演示同时落地）。
5. **第三方扩展还没接**：hello-world.ts 是模板，待第三方 package 实际落地验证（留 Round 22 G8 PR 1 一起做）。

---

## 8. 与其他 Round 的接力

| Round | 接力点 |
|---|---|
| Round 13（G1 PR 1）| typed-tool.ts 加 `defineTool` + `validateParams` + `InferParams` |
| Round 14（G1 PR 2）| apply-patch.ts 改用 typed-tool facade |
| Round 16（G1 PR 3）| typed-tool.ts 加 `validateParamsSafe` 类型守卫（本轮 barrel 补齐收尾）|
| Round 8（G10 spec）| v3.5 §3 PR 3 "文档化最小模板" —— 本轮 Round 17 落地 |
| Round 18+（G10 PR 2/3）| `registerBuiltinExtension` 抽函数 + CI lint；按指南 §6 草案 |
| Round 18（G7）| shell helper 套用 typed-tool 模板（参考 hello-world.ts + apply-patch.ts 的 `apply_command`）|

---

## 9. Sources

- pi `defineTool` / `ExtensionFactory`：[github.com/earendil-works/pi-mono](https://github.com/earendil-works/pi-mono)
- TS user-defined type guards：[typescriptlang.org/docs/handbook/2/narrowing.html#using-type-predicates](https://www.typescriptlang.org/docs/handbook/2/narrowing.html#using-type-predicates)
- TypeBox `Type.Object` / `Type.Optional`：[github.com/sinclairzx81/typebox](https://github.com/sinclairzx81/typebox)
- 本仓库：
  - `electron/main/agent/extensions/_scaffolds/hello-world.ts`（本轮新）
  - `electron/main/agent/extensions/apply-patch.ts`（Round 14+16 完整 typed-tool 重写）
  - `electron/main/agent/extensions/__tests__/hello-world-scaffold.test.ts`（本轮新）
  - `docs/G10_EXTENSION_SCAFFOLD_GUIDE.md`（本轮新）
  - `docs/G10_IMPLEMENTATION_SPEC.md`（Round 8 v3.5 spec）
  - `packages/runtime/openbuddy-plugin-host/src/typed-tool.ts`（Round 13+16）
  - `packages/runtime/openbuddy-plugin-host/src/index.ts:1244-1253`（本轮补 barrel）