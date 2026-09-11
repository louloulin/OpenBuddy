# G10 实现规格：ExtensionFactory 注册简化（单文件入口）

> 📅 2026-09-11 · 父任务 LUM-785 · 对应 plan4.1.md §3 Phase F + backlog G10
>
> **状态**：规格已落地（2026-09-11 Round 8）。

---

## 0. 一页摘要

| 项 | 值 |
|---|---|
| 当前文件 | `electron/main/agent/pi-extensions.ts`（1222 LOC）|
| 涉及 pi API | `ExtensionFactory` |
| Owner | runtime team |
| 估时 | 2 周 |
| 阻塞 | **依赖 G1**（pi-tool-factories 是新 builtin）|
| 风险等级 | 中（扩展系统是 OpenBuddy 核心入口）|

---

## 1. 当前实现盘点

```
pi-extensions.ts: 1222 LOC
- builtinPiExtensionFactories record（10 个 builtin）
- 每个 builtin 单独的工厂函数 + 模板代码
- module loader / discovery
- 内部 helper 函数 ~400 LOC
- 类型导出 ~200 LOC
```

## 2. 目标实现

```typescript
// electron/main/agent/pi-extensions.ts (重写)
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";

// 1. 单文件 registerBuiltinExtension 入口
export function registerBuiltinExtension(
  name: string,
  factory: ExtensionFactory,
  options?: { hidden?: boolean }
): void {
  builtinPiExtensionFactories[name] = factory;
  if (options?.hidden) hiddenExtensions.add(name);
}

// 2. builtin 注册改为单行调用（10 个 builtin 各 1 行）
registerBuiltinExtension("openbuddy-apply-patch", createApplyPatchExtension);
registerBuiltinExtension("openbuddy-pi-observability", createObservabilityExtension);
// ... 共 10 行

// 3. 原 1222 LOC 缩减到 ~200 LOC（typed registry + 10 个 delegate）
```

**目标 LOC 估算**：~1222 LOC → ~200 LOC（保留 typed facade）。

## 3. 迁移步骤（3 PR）

### PR 1 — registerBuiltinExtension helper
1. 抽 `registerBuiltinExtension(name, factory)` 函数
2. 现有 10 个 builtin 注册改为单行调用
3. 跑 vitest：`pi-extensions.test.ts`（1032 LOC）全过

### PR 2 — 删除模板代码
1. 删除每个 builtin 的 wrapper（~600 LOC）
2. typed facade 保留
3. 跑 `bash scripts/audit/extensions-inventory.sh --json | jq '.hotspots.piExtensions <= 200'` ✅

### PR 3 — 文档化最小模板
1. 在 `docs/` 加 `EXTENSION_AUTHORING.md`：写一个新 builtin 的最小步骤
2. CI lint：builtin extension 必须有 name + test

## 4. 测试策略

- 单元：`pi-extensions.test.ts`（1032 LOC，existing）
- 集成：`tests/electron/agent-workbench-core.spec.ts`

## 5. 风险评估

| 风险 | 影响 | 触发 | 缓解 |
|---|---|---|---|
| R1 builtin name 冲突 | 后注册覆盖先注册 | 多个 source | typed name union |
| R2 hidden extension 误暴露 | 安全风险 | hidden flag 误设 | lint rule |
| R3 模板代码删除破坏 niche use case | 边角流程失效 | 现有特殊处理 | 渐进 PR + 双轨 1 周 |

## 6. 验收命令

```bash
pnpm workspace:test -- pi-extensions.test.ts                                # 全过
bash scripts/audit/extensions-inventory.sh --json | jq '.hotspots.piExtensions <= 200'   # true
```

## 7. 与其他 G-gap 关系

- 依赖 G1（pi-tool-factories 是新 builtin）
- 解锁 G12（runtime coordinator 复用 AgentSessionRuntime）

## 8. 进度更新

`plan4.1.md §3 Phase F` / `docs/PI_INTEGRATION_BACKLOG.md §2 G10` 状态联动；`extensions-inventory.sh` 的 piExtensions 字段自动反映。