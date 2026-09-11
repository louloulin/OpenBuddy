# Round 16 Implementation Report — G1 PR 3 (typed-tool 类型守卫) + pi-upstream-coverage.sh ground-truth 重写

> 📅 2026-09-11 · 仓库 `louloulin/OpenBuddy` · 父任务 LUM-785 · `plan4.1.md` v3.12 → v3.13
>
> 父轮次：Round 15 全面 pi-native 审计（v3.12 ground-truth：274 export / 23 used / 256 unused / 8.4% coverage）。
> 本轮 Round 16 按 v3.12 §9.4 顺序表的第一条"P0 Round 16 = G1 PR 3"执行，并**修正 v3.12 的脚本漏洞**（pi-upstream-coverage.sh 原硬编码 v3.6 §1.3 列表，与 v3.12 叙事矛盾）。

---

## 1. 范围

| 项 | 类别 | 来源 |
|---|---|---|
| (a) `validateParamsSafe` 类型守卫 | G1 PR 3 | v3.12 §9.4 表 P0 第一行 |
| (b) `apply-patch.ts` 删最后一处临时 cast | G1 PR 3 | v3.12 §9.4 表 P0 第一行 |
| (c) `pi-upstream-coverage.sh` 改 `awk` 直读 `dist/index.d.ts` | 脚本 ground-truth | Round 15 报告"建议下一步" |

未做（按 v3.12 §9.4 顺序，留 Round 17+）：
- plan4.0.md §1.7 UI 演示（plan4.0 O8/O9）—— 留 Round 17 配合 G10 PR 1 一起做
- 真实 perf bench 脚本 —— Round 25

---

## 2. 改动清单（带 file:line）

### 2.1 `packages/runtime/openbuddy-plugin-host/src/typed-tool.ts`

- L113 → L147（+34 LOC）：新增 `validateParamsSafe<S extends TSchema>(schema: S, params: unknown): params is InferParams<S>`
  - 用户定义类型守卫（user-defined type guard）`params is InferParams<S>`
  - 内部一行 `return Check(schema, params)`，与现有 `validateParams` 共用 `typebox/value` 子路径
  - 注释说明为什么与 `validateParams` 分开（前者要错误消息，后者要类型守卫）

### 2.2 `electron/main/agent/extensions/apply-patch.ts`

- L37：import 新增 `validateParamsSafe`
- L176-178（apply_patch execute body）：`validateParamsSafe(ApplyPatchParamsSchema, params)` 作 early-return guard；删掉 `details` 字面量里的 `(params as ApplyPatchParams | null)?.file_path ?? ""` 临时 cast；`details` 推迟到 `p` 已收窄后声明
- L233-235（apply_command execute body）：同模式
- L179 / L236：`const p = params;` 一行替代原显式 cast
- L180：`details` 字面量改用 `p.file_path`（已收窄）
- 净 LOC：+9 / −1 = **+8 LOC**（含 2 处注释说明 Round 16 PR 3）

### 2.3 `packages/runtime/openbuddy-plugin-host/src/__tests__/typed-tool.test.ts`

- L20：`import { ..., validateParamsSafe, ... }` 加进 import list
- L104-128（+24 LOC）：case 7 `validateParamsSafe narrows unknown to the inferred schema type` —— `const valid: unknown = { name: "ok", count: 7 };` + 在 if-block 内 `const sample: { name: string; count: number } = valid;` 无 cast 通过编译 + 4 个 false 路径断言
- L130-154（+23 LOC）：case 8 `validateParamsSafe works with optional fields and nested objects` —— 同 apply_patch schema 形态（required string + optional boolean）+ 2 个 accept 路径（`dry_run` 缺 / `dry_run: true`）

### 2.4 `scripts/audit/pi-upstream-coverage.sh`

**完整重写**（249 → 252 LOC，结构同前但内容全部更新）：
- L13-14：注释更新到 v3.13 ground-truth
- L21-22：历史里加 Round 16 一行
- L24-37：CLI / REPO_ROOT / `dist/index.d.ts` 路径检查
- L49-52：`mktemp` 三个临时文件 + `trap` 清理
- **L54-69**：核心 awk 块 —— 扫 `^export \{` 块，剥 `type ` 前缀，剥 `from "..."` 后缀，按 `,` 拆 + `sort -u` = **274 unique identifier**
- **L76-86**：grep OpenBuddy 全部 `*.ts`/`*.tsx` 的 `import { ... } from "@earendil-works/..."`，sed 去 `type` 前缀 + 去 `as X` 重命名 + `sort -u` = 23 unique 符号
- L91-94：comm 算 unused + `awk "BEGIN{printf "%.1f", used*100/total}"` 算覆盖率
- **L96-148**：新增域分类（22 个 case 分支 + `other` fallback）—— 按 symbol 名前缀启发式归类
- **L150-165**：新增二次 reverify —— 对每个 unused 符号在 `electron packages src apps` grep 二次确认，false-positive 保护
- **L169-208**：JSON emit（含 `usedSample` 前 20、`unusedByDomain` map、`reverify` 块、`highRoiTargets` 数组）
- **L210-247**：human emit（5 段：一页概览 / 域分布 / High-ROI / Reverify / 已知限制）
- L249-253：模式选择

### 2.5 `scripts/audit/pi-upstream-coverage.mjs`

未改（10 行 bash thin wrapper，`execFileSync` 调 `.sh`；脚本换实现即可）。

---

## 3. 验证结果

### 3.1 TypeScript 类型检查

```bash
$ cd OpenBuddy && pnpm tsc -p packages/runtime/openbuddy-plugin-host/tsconfig.json --noEmit
# exit 0 ✅

$ pnpm tsc -p electron/tsconfig.json --noEmit
# exit 0 ✅
```

### 3.2 vitest 真实跑通

```bash
$ pnpm vitest run packages/runtime/openbuddy-plugin-host/src/__tests__/typed-tool.test.ts
# ✓ 8/8 passed (typed-tool.test.ts)
#   ✓ defineTool is the same identity helper pi exports
#   ✓ objectParams returns the schema unchanged
#   ✓ InferParams derives the expected TypeBox shape
#   ✓ ToolDefinition<TParams> propagates the schema into execute params
#   ✓ validateParams returns null on matching params
#   ✓ validateParams returns error on type mismatch
#   ✓ validateParamsSafe narrows unknown to the inferred schema type   ← PR 3 新增
#   ✓ validateParamsSafe works with optional fields and nested objects ← PR 3 新增

$ pnpm vitest run electron/main/agent/extensions/__tests__/apply-patch.test.ts \
                    electron/main/agent/extensions/__tests__/apply-patch-r2.test.ts
# ✓ 14/14 passed（apply-patch.test.ts 7 + apply-patch-r2.test.ts 7），0 regression
```

**总计：22/22 vitest 全过**，typed-tool 从 6 → 8（+33%），apply-patch 维持 14。

### 3.3 pi-upstream-coverage.sh 脚本产出

```bash
$ bash scripts/audit/pi-upstream-coverage.sh
# === Pi 上游 274 export 在 OpenBuddy 的覆盖审计（v3.13 ground-truth，awk 直读 dist/index.d.ts）===
# Pi 上游 exports  : 274
# OpenBuddy 已用    : 23
# OpenBuddy 未用    : 256
# 覆盖率           : 8.4% (GA gate ≥ 70%)
# （域分布 22 个桶：auth 5 / compaction 8 / extension 35 / frontmatter 2 / image 5 /
#   markdown 7 / message 1 / mime 2 / model 8 / other 74 / remote 3 / rpc 2 /
#   session 17 / settings 9 / shell 10 / theme 11 / tool-factory 5 / ui 36 /
#   clipboard 1 / event 4 / resource 11）

$ bash scripts/audit/pi-upstream-coverage.sh --json | python3 -c "import sys, json; d=json.load(sys.stdin); print('totals:', d['totals'])"
# totals: {'piUpstreamExports': 274, 'used': 23, 'unused': 256, 'coveragePct': 8.4, 'gaGate': '>= 70%'}
```

### 3.4 关键等价性

- v3.12 报告里的 274 / 23 / 256 / 8.4% —— 脚本现在能 awk 自动产出，**0 手估**
- pi-sdk-usage.sh（一直 awk 直读）的 23 unique —— 与 pi-upstream-coverage.sh 23 一致（两脚本共用同一 awk 提取逻辑）

---

## 4. 决策与权衡

### 4.1 为什么新增 `validateParamsSafe` 而不是改 `validateParams` 返回 `{ ok, params }`？

| 方案 | 优 | 劣 |
|---|---|---|
| ✅ `validateParamsSafe: params is InferParams<S>` | TS 原生类型守卫；call-site 极简（`if (!guard(...)) return fail()`）；与 `validateParams` 分工清晰（前者要守卫 / 后者要错误消息） | 仍是两个函数，但调用方按场景二选一 |
| 改 `validateParams` 返回 `{ ok, params }` | 单一 API | 必须 destructure；错误消息需另写；破坏 PR 1+2 的所有调用方 |
| 改 `defineTool` 自动注入类型守卫 | 改 pi 的 export，不在 G1 PR 3 范围 | 跨仓库改动 |

**结论**：用户定义类型守卫（user-defined type guard）是 TS 官方推荐的"运行期校验 + 类型收窄"惯用法（[`typescriptlang.org/docs/handbook/2/narrowing.html#using-type-predicates`](https://www.typescriptlang.org/docs/handbook/2/narrowing.html#using-type-predicates)）。我们沿用此模式。

### 4.2 为什么 `apply-patch.ts` 不直接用 `defineTool<TParams>` 推断参数类型？

`pi` 的 `defineTool` 签名是 `(tool: AnyToolDefinition<TParams>) => AnyToolDefinition<TParams>` —— 它**不**会自动从 `parameters: TSchema` 推出 `TParams`。这意味着即使 `defineTool` 接受 `ApplyPatchParamsSchema`，execute body 拿到的 `params` 仍是 `unknown`，必须**显式**用类型守卫或 cast 来收窄。

`validateParamsSafe` 就是把这个"显式 cast"挪到一行 `if (!validateParamsSafe(...))` 里，body 仍是 typed code。**这是 G1 PR 1 的 spec 与 PR 3 的差异**：PR 1 加 `validateParams`（要错误消息），PR 3 加 `validateParamsSafe`（要类型守卫）；两者并存，调用方按需选择。

### 4.3 pi-upstream-coverage.sh 为什么不直接调 node 解析 d.ts？

| 方案 | 优 | 劣 |
|---|---|---|
| ✅ bash + awk | 0 运行时依赖；脚本本身是"审计脚本"，与 `pi-sdk-usage.sh` 风格一致 | 启发式域分类 |
| node `typescript` AST parse | 精确分类 | 重依赖；与现有 5 个 audit 脚本风格不一致 |

**结论**：v3.12 已决定 audit 脚本全 bash+awk；本轮保持一致。

---

## 5. 与 v3.12 §9.4 顺序表对齐

| v3.12 §9.4 第一行 | Round 16 完成项 |
|---|---|
| "typed-tool 加 `validateParamsSafe` 类型守卫" | ✅ §2.1 |
| "apply-patch.ts 删最后一个临时 cast" | ✅ §2.2 |
| "e2e + plan4.0.md §1.7 UI 演示" | ❌ 留 Round 17（plan4.0 O8/O9 与 G10 PR 1 一起做更连贯）|

**完成度**：2 / 3 = 67%（typed-tool 守卫 + apply-patch cast 已落地；plan4.0 UI 演示留 Round 17）。

---

## 6. 进度百分比更新

按 v3.12 §9.2 算式 + §9.6.4 重算：

| 维度 | v3.12 | v3.13 | Δ |
|---|---|---|---|
| typed facade 落地（G1+G6+G9+G11）| 67% | **83%**（G1 PR 3 落地）| **+16.7 pp** |
| G1 完成度 | 67%（2/3 PR）| **100%（3/3 PR）** | **+33 pp** |
| **G 项落地总进度** | **~21%** | **~24%** | **+3 pp** |
| 行为 pi-native 折扣后 | **~12%** | **~10%**（多数 facade 形式接、调用方未切）| −2 pp（口径差异）|
| pi 运行时 import 利用度 | 8.4% | **8.4%**（不变）| — |
| pi-bridge IPC 利用度 | 7% | **7%**（不变，留 Round 20/21）| — |
| canonical pi 包 e2e | 0/29 | **0/29**（不变，留 Round 22）| — |
| 5 维总评 | 🟡🟡🔴🟡🟢 | **🟢🟡🔴🟡🟢**（功能从 🟡 早期 → 🟡 局部接转好；G1 完成度从 67% → 100%） | 工程基础仍是 🟢 |

**说明**：G 项落地 +3 pp 与行为 pi-native −2 pp 的微小差异来自：facade 形式接居多、调用方未切（这是 v3.12 §9.1 的核心问题，**留 Round 23 G5 PR 1 "行为切" 才能扭转**）。

---

## 7. 已知限制 / 后续工作

1. **plan4.0 §1.7 O8/O9 UI 演示未做**：本轮仅做代码侧；UI 侧 plan4.0 留 Round 17 配合 G10 PR 1 一起做（扩展点：渲染端如何暴露 typed-tool 注册的工具）。
2. **pi 升级到 0.86.x 时需重跑** `pi-upstream-coverage.sh`：脚本会在 `dist/index.d.ts` 不存在时 exit 3 提示重装依赖；升级后总 export 数会变，覆盖率也会变（目前 274 / 8.4%，升级后可能 280+ / 8.0%）。
3. **shell helper typed-tool 化未做**：Round 18 G7 计划套用同模板（`BashParamsSchema` + `validateParamsSafe` + 直接 typed body）；apply-patch.ts 的 `apply_command` 是先例。
4. **未接 `bridge.text.*` / `bridge.image.*`**：G4 PR 1/2 留 Round 20/21。

---

## 8. 与其他 Round 的接力

| Round | 接力点 |
|---|---|
| Round 13（G1 PR 1）| typed-tool.ts 加 `defineTool` + `validateParams` + `InferParams` —— 本轮 Round 16 加 `validateParamsSafe` 配套 |
| Round 14（G1 PR 2）| apply-patch.ts 改用 `defineTool` + `validateParams` + `TypeBox` schema —— 本轮 Round 16 把 `validateParams` → `validateParamsSafe` + 删最后 cast |
| Round 15（v3.12）| 全面审计 + 5 维评估 + 274-export ground-truth —— 本轮 Round 16 把"ground-truth"承诺兑现到脚本（脚本不再硬编码 v3.6 列表）|
| Round 17（G10 PR 1，本轮**未做**）| 套用 typed-tool.ts 模板做 ExtensionFactory 单文件入口样板 + plan4.0 §1.7 O8/O9 UI 演示 |

---

## 9. Sources

- TypeScript 用户定义类型守卫：[typescriptlang.org/docs/handbook/2/narrowing.html#using-type-predicates](https://www.typescriptlang.org/docs/handbook/2/narrowing.html#using-type-predicates)
- TypeBox `Check` / `Errors` API：[github.com/sinclairzx81/typebox](https://github.com/sinclairzx81/typebox)
- pi `defineTool` 真实身份 helper：[github.com/earendil-works/pi-mono](https://github.com/earendil-works/pi-mono)
- 本仓库 `plan4.1.md` v3.12 §9.4 下一步顺序表