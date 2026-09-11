# G10 扩展脚手架指南 — OpenBuddy pi 扩展 1-文件 + 1-manifest 接入

> 📅 2026-09-11 · 父任务 LUM-785 · 对应 plan4.1.md §9.6.5 P0 Round 17 = G10 PR 1
>
> **本指南是 G10 PR 1 的交付**：把 v3.5 G10 spec §3 PR 3 "文档化最小模板" 落地为一份完整扩展作者手册 + 一个可直接 copy-paste 的 50 LOC 行 hello-world 示例。

## 0. 一页摘要

| 项 | 值 |
|---|---|
| 目标 | 第三方 pi 包接入从 5+ 文件 → 1 文件 + 1 manifest |
| 最小可行扩展 | `_scaffolds/hello-world.ts` (~50 LOC) |
| 真实示例 | `extensions/apply-patch.ts` (266 LOC, 2 个 tool: `apply_patch` + `apply_command`) |
| 必备 import | `@openbuddy/plugin-host` 提供 `defineTool` + `validateParams` + `validateParamsSafe` + `InferParams`（Round 13+16 落地）|
| 不再需要 | 手写 `(params as FooParams)` cast / `String(p.x ?? "")` 防御 / 模块加载样板 / extension registry 样板 |
| vitest 验证 | `__tests__/hello-world-scaffold.test.ts` 6/6 ✅ |

---

## 1. 30 秒上手

**复制下面这段代码，存为 `my-tool.ts`，改 3 处名字，注册。完。**

```ts
import { Type } from "typebox";
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { defineTool, validateParamsSafe } from "@openbuddy/plugin-host";

const ParamsSchema = Type.Object({
  who: Type.String({ description: "Whom to greet" }),
  loud: Type.Optional(Type.Boolean({ description: "Upper-case the greeting" })),
});

export default function myToolExtension(): ExtensionFactory {
  return (pi) => {
    if (typeof pi.registerTool !== "function") return;
    pi.registerTool(defineTool({
      name: "my_tool",                  // ← 改这里
      label: "My tool",                  // ← 改这里
      description: "Returns a greeting", // ← 改这里
      parameters: ParamsSchema,
      execute: async (_id, params) => {
        if (!validateParamsSafe(ParamsSchema, params)) {
          return { content: [{ type: "text", text: "invalid params" }] };
        }
        // params 现在是 { who: string; loud?: boolean }，无 cast
        const greet = (params.loud ? "HELLO" : "hello") + ", " + params.who;
        return { content: [{ type: "text", text: greet }] };
      },
    }));
  };
}
```

**修改清单**：
1. 文件名 `my-tool.ts`（与 OpenBuddy builtin 约定一致：`kebab-case`）
2. tool `name` / `label` / `description`（3 处字符串）
3. `ParamsSchema` 字段（按业务需求）

**注册**：在 `electron/main/agent/pi-extensions.ts` 的 `builtinPiExtensionFactories` record 里加一行；或通过 `registerBuiltinExtension("my_tool", myToolExtension)`（G10 PR 2 计划做）。

---

## 2. 必备 import

| import | 来源 | 何时用 |
|---|---|---|
| `Type` | `typebox` | 写 `ParamsSchema` |
| `ExtensionFactory` | `@earendil-works/pi-coding-agent` | default export 返回类型 |
| `defineTool` | `@openbuddy/plugin-host`（= pi 的 identity helper） | 包装 `parameters` + `execute`，无运行时作用 |
| `validateParams` | `@openbuddy/plugin-host` | 想在失败时拿到 `/path: expected number` 风格错误消息 |
| `validateParamsSafe` | `@openbuddy/plugin-host`（Round 16 新增） | 想在 if-block 内让 `params` 自动收窄成推断类型（**推荐**）|
| `InferParams` (type) | `@openbuddy/plugin-host` | 当你想在 schema 之外也持有 params 类型时 |

> **可选 import**：`ExtensionAPI` 类型（如果要在 `registerTool` 之外的 pi hook 上挂回调，如 `onSessionStart` / `sendMessage`）。hello-world 不需要。

---

## 3. 三种 execute body 写法（按需选）

### 3.1 推荐：守卫式（type guard，无 cast）

```ts
execute: async (_id, params) => {
  if (!validateParamsSafe(ParamsSchema, params)) {
    return fail("invalid params");
  }
  // params 已收窄为 { who: string; loud?: boolean }
  return { content: [{ type: "text", text: params.who }] };
}
```

**适用**：99% 场景。运行时校验 + 类型收窄都在一行完成，body 读起来是普通 typed code。

### 3.2 错误消息式（要 `/path: expected number` 诊断）

```ts
execute: async (_id, params) => {
  const err = validateParams(ParamsSchema, params);
  if (err) {
    return { content: [{ type: "text", text: err }] };  // "invalid params: /count: Expected number"
  }
  // params 仍是 unknown；要么 cast 要么再 validateParamsSafe
  const p = params as InferParams<typeof ParamsSchema>;
  return { content: [{ type: "text", text: p.who }] };
}
```

**适用**：你想在 `details` 里把校验错误暴露给上层 UI（renderer 端 ToolCallCard 可显示错误路径）。

### 3.3 双调用（既要错误消息又要类型守卫）

```ts
execute: async (_id, params) => {
  if (!validateParamsSafe(ParamsSchema, params)) {
    return fail(validateParams(ParamsSchema, params) ?? "invalid params");
    //                                        ^^^^ 拿详细错误消息
  }
  // params 已收窄
  return { content: [{ type: "text", text: params.who }] };
}
```

**适用**：apply-patch.ts 当前采用的模式（Round 16 PR 3 落地）；`fail` 走 validateParams 拿诊断字符串，正文走类型守卫。

---

## 4. 真实示例：apply-patch.ts（266 LOC）

`electron/main/agent/extensions/apply-patch.ts` 是这个脚手架的**最完整**例子，演示：

| 模式 | 文件位置 |
|---|---|
| 2 个 tool 共享同一个 `ExtensionFactory` | L138-266（`apply_patch` + `apply_command`）|
| `trustedCwd` 通过闭包注入到 execute body | L141-153 |
| `isPathTrusted` 私有 helper | L146-153 |
| 失败路径 `fail(msg)` 工厂返回标准 `content` + `details` envelope | L172-175 / L229-232 |
| TypeBox schema with `Type.Optional(...)` | L113-131 |
| 错误细节含 `applied: false` / `exit_code: 1` 等结构化字段 | L174 / L231 |
| `execFileAsync` 走 pi 沙箱（这里用 `node:child_process`，等 Round 18 G7 切到 pi bash-executor） | L242-242 |
| 原子写入（temp + rename）| L195-207 |

**学习路径**：把 `hello-world.ts`（50 LOC）→ `apply-patch.ts`（266 LOC）当 2 个 case study 对照着看。hello-world 是骨架，apply-patch 是真实业务的丰满版。

---

## 5. 测试策略

每个 builtin extension 都必须有 `__tests__/<name>.test.ts`，最低 6 个：

1. default export is a function
2. registers exactly N tool(s) with correct names
3. execute happy path 1
4. execute happy path 2 (optional 字段覆盖)
5. execute fails on missing required field
6. execute fails on null/undefined params

`hello-world-scaffold.test.ts` 是这个最小模板的实现，可作 boilerplate。

---

## 6. CI / Lint 规则（建议，本轮未落地）

```yaml
# .github/extensions-ci.yml (建议草案，本轮不做)
- name: extensions lint
  run: |
    # 1. 每个 builtin 必须有 name + test
    for ext in electron/main/agent/extensions/*.ts; do
      [ -f "${ext%.ts}.test.ts" ] || echo "MISSING TEST: $ext"
    done
    # 2. 禁止 (params as FooParams) cast（typed-tool 已让 cast 不必要）
    ! grep -rEn '\(params as [A-Z][A-Za-z]+\)' electron/main/agent/extensions/ \
      || echo "FOUND UNSAFE CAST"
    # 3. schema 字段必须有 description（LLM 调工具时需要）
    ! grep -rEn 'Type\.(String|Number|Boolean)\(\)' electron/main/agent/extensions/ \
      || echo "MISSING description"
```

---

## 7. 与 G1 / G6 / G9 / G11 facade 的关系

| Facade | 来源 | 在扩展里何时用 |
|---|---|---|
| `defineTool` + `validateParamsSafe` | G1（Round 13+16）| **每次写 tool 都用** —— 这是 typed tool 注册入口 |
| `getMarkdownTheme` / `initTheme` | G6（Round 11）| 扩展需要渲染 markdown 主题时 |
| `loadProjectContextFiles` | G9（Round 12）| 扩展需要在 prompt 注入项目资源时 |
| `parsePluginManifestFromString` | G11（Round 10）| 扩展要解析 plugin manifest 时 |
| `pi` 的 `ExtensionAPI.registerTool` / `onSessionStart` 等 | pi native | 全部 hook 都从 pi 来；不另起 facade |

**设计原则**：除非有 pi native API 之外的 OpenBuddy 专属业务，否则**不另起 facade**。`apply-patch.ts` 就是这条原则的例子 —— 它的 `isPathTrusted` + `trustedCwd` 是 OpenBuddy 安全模型（不是 pi 的事），所以留本地；其他都走 pi / facade。

---

## 8. Round 17 进度

| 项 | Round 16 | Round 17 |
|---|---|---|
| 1 文件扩展可写 | 否（apply-patch.ts 是唯一例子）| ✅ hello-world.ts (50 LOC) |
| 测试样板 | 无 | ✅ hello-world-scaffold.test.ts (6/6) |
| 文档 | 无 | ✅ 本指南 |
| barrel export 完整性 | 缺 `validateParamsSafe` | ✅ 已补（plugin-host/index.ts L1244-1253）|
| G10 完成度 | 0% | **PR 1 完成（3/3 PR 中第 1 个）** |

**G10 PR 2/3 留 Round 18+**：
- PR 2: `registerBuiltinExtension(name, factory)` 抽函数 + 1222 LOC → 200 LOC（见 G10 spec §3 PR 2）
- PR 3: CI lint 规则（见本指南 §6）

---

## 9. Sources

- pi `defineTool` / `ExtensionFactory`：[github.com/earendil-works/pi-mono](https://github.com/earendil-works/pi-mono)
- TS user-defined type guards：[typescriptlang.org/docs/handbook/2/narrowing.html#using-type-predicates](https://www.typescriptlang.org/docs/handbook/2/narrowing.html#using-type-predicates)
- TypeBox `Type.Object` / `Type.Optional`：[github.com/sinclairzx81/typebox](https://github.com/sinclairzx81/typebox)
- 本仓库：
  - `_scaffolds/hello-world.ts`
  - `extensions/apply-patch.ts` (Round 14+16 完整 typed-tool 重写)
  - `packages/runtime/openbuddy-plugin-host/src/typed-tool.ts`
  - `docs/G10_IMPLEMENTATION_SPEC.md`（Round 8 v3.5 spec，本指南是其 §3 PR 3 落地）