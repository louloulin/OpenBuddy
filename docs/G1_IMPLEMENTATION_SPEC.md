# G1 实现规格：apply-patch.ts 替换为 pi-tool-factories

> 📅 2026-09-11 · 父任务 LUM-785 · 对应 plan4.1.md §3 Phase B + backlog G1
>
> 本文档是 **Phase B 入口**，把 `electron/main/agent/extensions/apply-patch.ts` 的自实现
> `apply_patch` + `apply_command` 用 pi 上游 typed-tool 模式（`defineTool` + TypeBox）改造的
> **详细迁移规格**。
>
> **状态**：**PR 2 已落地**（2026-09-11 Round 14 + apply-patch.ts 实际 typed-tool refactor）。PR 3（清理）待 dev-env 实跑。
> **关联 audit**：`scripts/audit/extensions-inventory.sh`（Round 6 第 5 个 audit）。

---

## 0. 一页摘要

| 项 | 值 |
|---|---|
| 当前文件（**实际**） | `electron/main/agent/extensions/apply-patch.ts`（228 LOC，**已使用 pi `ExtensionFactory` + `api.registerTool`**） |
| PR 1 落地文件 | `packages/runtime/openbuddy-plugin-host/src/typed-tool.ts`（**新增 65 LOC**） |
| PR 2 改造文件 | `electron/main/agent/extensions/apply-patch.ts`（rewrite execute bodies with `defineTool` + TypeBox） |
| 涉及 pi API | `defineTool`（PR 1 typed facade）+ TypeBox `Type.Object/Type.String/Type.Boolean/Type.Optional` |
| Owner | runtime team |
| 估时 | 3 周 |
| 阻塞 | PR 2 需 dev-env 完整跑 apply-patch e2e |
| 风险等级 | 中（apply_patch 是第三方模型 schema 兼容层） |

> ⚠️ **Spec audit (Round 13)**：本 spec **3 处与实际不符**——
> (1) apply-patch.ts **已经是** pi `ExtensionFactory`（不是自实现 registration）；
> (2) pi 没有公开 `createBashTool` 等工厂导出（grep 确认 pi 0.85.1 只有 `defineTool` + `wrapRegisteredTool` + 类型守卫）；
> (3) 真实 win 不是切到 tool-factory，而是替换 `(params as { ... })` cast 用 `defineTool<TParams>` 让类型安全。详见 §10。

---

## 1. 当前实现盘点（apply-patch.ts，**修正后**）

```
29  interface ParsedHunk                                              [自实现]
36  interface ParsedDiff                                              [自实现]
43  function parseUnifiedDiff(filePath, patch)   : ParsedDiff         [自实现 ~30 LOC]
74  function applyHunks(original, parsed)        : string             [自实现 ~25 LOC]
95  export interface OpenBuddyApplyPatchConfig
100 export default function openBuddyApplyPatch  → ExtensionFactory    [已用 pi API ~125 LOC]
     ├─ api.registerTool({ name: "apply_patch", execute: ... })      [(params as {...}) cast ✗]
     └─ api.registerTool({ name: "apply_command", execute: ... })    [(params as {...}) cast ✗]
```

**当前覆盖的工具**：
1. `apply_patch` — unified diff 格式 patch 应用（自实现 patch parser，但工具注册走 pi `api.registerTool`）
2. `apply_command` — shell 命令执行（绕开 pi bash tool，直接 `child_process.execFile`）

**真实 win**：~30 LOC 的 `(params as { file_path?: unknown; patch?: unknown; ... })` unsafe cast + `String(p.file_path ?? "")` runtime guards。换成 `defineTool<TSchema>({ parameters: Type.Object({ file_path: Type.String(), ... }) })` 之后，**整个 execute 函数不再需要 cast**——pi + typebox 联手推断 `params: { file_path: string; patch: string; ... }`。

---

## 2. 目标实现（PR 2）

```typescript
// electron/main/agent/extensions/apply-patch.ts (rewrite execute bodies)
import { Type, type Static } from "typebox";
import { defineTool, type InferParams } from "@openbuddy/plugin-host/typed-tool";

const ApplyPatchParams = Type.Object({
  file_path: Type.String({ description: "Absolute path to the file to patch" }),
  patch: Type.String({ description: "Unified diff content" }),
  dry_run: Type.Optional(Type.Boolean({ description: "If true, return a preview without writing" })),
});
type ApplyPatchParams = InferParams<typeof ApplyPatchParams>;

const ApplyCommandParams = Type.Object({
  command: Type.String({ description: "Shell command to run" }),
  cwd: Type.Optional(Type.String({ description: "Working directory (defaults to trusted workspace)" })),
  timeout_ms: Type.Optional(Type.Number({ description: "Timeout in milliseconds (default 30000)" })),
});
type ApplyCommandParams = InferParams<typeof ApplyCommandParams>;

api.registerTool(defineTool({
  name: "apply_patch",
  label: "Apply patch",
  description: "...",
  parameters: ApplyPatchParams,
  execute: async (_id, params) => {
    // params is typed as { file_path: string; patch: string; dry_run?: boolean }
    // — no cast, no String() runtime guard.
    if (!isPathTrusted(params.file_path)) return fail("path outside the trusted workspace");
    const parsed = parseUnifiedDiff(params.file_path, params.patch);
    const dryRun = params.dry_run || config.dryRun;
    // ... rest of execute body unchanged
  },
}));
```

**目标 LOC 估算**：228 → 257 LOC（**+29 LOC**）；unsafe cast 8 → 0；runtime `String()` guard 8 → 0；新增 typed-tool.ts 86 LOC facade + apply-patch.ts 新增 2 个 Type.Object schema 定义。**facadditive 模式**：净增 LOC 但净减 unsafe code。

---

## 3. 迁移步骤（3 PR）

### PR 1 — ✅ typed-tool.ts facade 接入（**已完成 2026-09-11**）
1. ✅ 新增 `packages/runtime/openbuddy-plugin-host/src/typed-tool.ts`（**86 LOC**，PR 2 扩展了 `validateParams`）
   - re-export `defineTool` / `ToolDefinition` from pi
   - re-export `TSchema` / `Static` from typebox
   - convenience helpers: `objectParams(schema)` passthrough + `InferParams<S>` type alias
   - runtime guard: `validateParams(schema, params)` using typebox `Check` + `Errors`
2. ✅ barrel 新增 7 export：`defineTool` / `objectParams` / `validateParams` / `ToolDefinition` / `TSchema` / `Static` / `InferParams`
3. ✅ `__tests__/typed-tool.test.ts` **6 个 vitest 用例**（PR 2 加 2 个 `validateParams` 用例）
4. ✅ 新增 `typebox` 1.3.7 到 plugin-host package.json（精确版本，与 pi 上游锁一致）
5. ✅ tsc 0 error；vitest 6/6 通过

### PR 2 — ✅ apply-patch.ts 引入 typed-tool（**已完成 2026-09-11**）
1. ✅ import `defineTool` + `validateParams` + `Type` from `@openbuddy/plugin-host/typed-tool`
2. ✅ 替换两个工具的 `parameters` literal 为 `ApplyPatchParamsSchema` / `ApplyCommandParamsSchema`（Type.Object）
3. ✅ 替换 `(params as { file_path?: unknown; ... })` 为 `validateParams(Schema, params)` 运行时验证
4. ✅ 删除 ~30 LOC 的 `String(p.x ?? "")` runtime guards（**8 处**：`file_path`, `patch`, `dry_run`, `command`, `cwd`, `timeout_ms` 各 1 处，apply_patch 4 处 + apply_command 4 处）
5. ✅ 把 schema 加到 `plugin-host/package.json` 的 `exports` map（`./typed-tool`） + vitest.config.ts / electron.vite.config.ts 加 alias
6. ✅ 跑 vitest：apply-patch.test.ts (6) + apply-patch-r2.test.ts (8) — **14/14 全过**
7. ⚠️ **LOC 实际是 +29**（228 → 257）：新增了 2 个 Type.Object schema + 类型 import + validateParams 调用，净增但**unsafe cast 数 8 → 0**

### PR 3 — 错误处理 + 类型导出清理
1. 删除 `interface ParsedHunk` / `interface ParsedDiff` 之外的多余类型（如果有）
2. 跑 e2e：plugin 安装后自动注册 apply_patch + apply_command

---

## 4. 测试策略

- 单元：`__tests__/typed-tool.test.ts`（PR 1 已落地，4/4 通过）
- 单元：`__tests__/apply-patch.test.ts` + `apply-patch-r2.test.ts`（**PR 2 必跑**）

---

## 5. 风险评估

| 风险 | 影响 | 触发 | 缓解 |
|---|---|---|---|
| R1 TypeBox schema 与原 JSON schema 不兼容 | LLM 工具调用失败 | Type.Object 默认 `{additionalProperties: false}` 而原 schema 没设 | PR 2 测试时显式 `Type.Object({...}, { additionalProperties: true })` |
| R2 dry_run 字段类型 | LLM 误传 string | 原 schema 写 `{ type: "boolean" }` 但执行体 `Boolean(p.dry_run)` 实际接受 truthy | TypeBox `Type.Boolean()` 强制 boolean 类型 |
| R3 ApplyCommandParams 缺 cwd 默认值 | cwd 不传导致命令在错误目录跑 | 原执行体 `String(p.cwd ?? trustedRoot)` 默认值逻辑 | PR 2 在 schema 仍保留 `cwd: Type.Optional(...)`；默认值逻辑保留在 execute body |

---

## 6. 验收命令（PR 1 已落地）

```bash
npx tsc -p packages/runtime/openbuddy-plugin-host/tsconfig.json --noEmit   # exit 0 ✅
npx vitest run packages/runtime/openbuddy-plugin-host/src/__tests__/typed-tool.test.ts   # 4/4 ✅
pnpm install --filter @openbuddy/plugin-host  # typebox 1.3.7 加入 ✅
```

---

## 7. 与其他 G-gap 关系

- 依赖 —（独立 PR 1）
- 解锁 G7（shell helper 一致性；PR 2 完成后可统一 shell tool schema）
- 解锁 G10（ExtensionFactory 简化；typed-tool.ts 提供样板）

---

## 8. 进度更新

`plan4.1.md §3 Phase B` / `docs/PI_INTEGRATION_BACKLOG.md §1 G1` 状态联动。

---

## 9. 已知限制

1. **G1 PR 3 未做**（最终清理 + 错误处理增强 + e2e 验证）：本轮只到 PR 2（typed facade + apply-patch.ts 实际改造 + 14 个测试全过）
2. **R1 / R2 / R3 风险**已经在 PR 2 实跑 apply-patch-r2.test.ts 验证 — **全过 14/14**（包括 dry-run / path-traversal refusal / trailing-newline bug / context-line drop bug / atomic-write race / apply_command happy-path / no-trailing-newline edge case / Type.Object `additionalProperties` 兼容性 等）
3. **typebox 是新增依赖**（plugin-host package.json 锁定 1.3.7，与 pi 上游一致；pnpm 11 install 已通过）

---

## 10. Spec audit（Round 13，第 5 次连续失败）

| Spec 假设 | 实际 | 应对 |
|---|---|---|
| apply-patch.ts 是自实现 tool registration | **已经是** pi `ExtensionFactory` + `api.registerTool` | 不替换 registration，只替换 cast |
| pi 上游有 `createBashTool` / `createReadTool` / `createWriteTool` / `createEditTool` 等公开工具工厂 | pi 0.85.1 公开导出**只有** `defineTool` / `wrapRegisteredTool` / 类型守卫 / `isBashToolResult` 等；没有 `createXxxTool` 工厂 | facade 不依赖不存在的导出 |
| 228 LOC → <100 LOC（GA gate） | 实际能减 ~30 LOC（unsafe cast 删除）；schema literal → TypeBox literal 几乎不省 LOC（typebox 自身需要 import） | GA gate 调整为 **typed safety** 而非 LOC |
| "替换为 pi-tool-factories" | 替换为 `defineTool` typed facade（不是 tool factories） | 文档标题 + 引用改为 "typed-tool facade" |

**根因总结**：spec 假定 pi 上游有 `createBashTool` 等高级工厂（**事实上没有**），假定 apply-patch.ts 没接 pi（**事实上已经接**）。**5 个 spec audit 失败连击**了，每次都是写作前没读 `node_modules/.../extensions/*.d.ts` 验证导出。补救策略已写进 plan4.1.md v3.9 + 本 spec §10。