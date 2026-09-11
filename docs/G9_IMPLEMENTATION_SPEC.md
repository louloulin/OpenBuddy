# G9 实现规格：loadProjectContextFiles 接管 include.ts

> 📅 2026-09-11 · 父任务 LUM-785 · 对应 plan4.1.md §3 Phase E + backlog G9
>
> **状态**：规格已落地（2026-09-11 Round 8）。

---

## 0. 一页摘要

| 项 | 值 |
|---|---|
| 当前文件 | `packages/runtime/openbuddy-plugin-host/src/include.ts`（350 LOC）|
| 涉及 pi API | `loadProjectContextFiles` |
| Owner | runtime team |
| 估时 | 1 周 |
| 阻塞 | 独立任务（typed facade 模式）|
| 风险等级 | 低（context file 加载是 read-only 路径）|

---

## 1. 当前实现盘点

```
include.ts: 自实现 context file 加载
- glob 模式解析（~50 LOC）
- 文件过滤（gitignore / 隐藏文件 / 二进制）（~80 LOC）
- 文件内容聚合 + token 预算（~120 LOC）
- 错误处理（~50 LOC）
- 类型导出（~50 LOC）
```

**自实现总规模** ~350 LOC。

## 2. 目标实现

```typescript
// packages/runtime/openbuddy-plugin-host/src/include.ts (重写)
import { loadProjectContextFiles } from "@earendil-works/pi-coding-agent";

export async function loadContext(
  projectRoot: string,
  patterns: string[],
  options?: ContextOptions
): Promise<ContextFile[]> {
  // 1. 用 pi 的 loadProjectContextFiles 替代自实现
  return loadProjectContextFiles(projectRoot, {
    patterns,
    respectGitignore: options?.respectGitignore ?? true,
    tokenBudget: options?.tokenBudget ?? 50_000,
    onError: options?.onError ?? ((err) => console.warn(err)),
  });
}
```

**目标 LOC 估算**：~350 LOC → ~50 LOC（typed wrapper）。

## 3. 迁移步骤（2 PR）

### PR 1 — loadProjectContextFiles 接入
1. 改 `loadContext` 内部用 pi API
2. 自实现 glob / gitignore / token budget 全部删除（~300 LOC）
3. 跑 vitest：context 加载路径全过

### PR 2 — 错误处理 + 类型导出
1. 保留 typed facade（ContextFile / ContextOptions）
2. 跑 e2e：plugin 安装后自动加载 project context

## 4. 测试策略

- 单元：`include.test.ts`（existing + 新增 pi 适配层）
- 集成：`tests/electron/plugin-hot-reload-e2e.spec.ts`

## 5. 风险评估

| 风险 | 影响 | 触发 | 缓解 |
|---|---|---|---|
| R1 pi 默认 gitignore 规则与 OpenBuddy 不同 | 漏文件 | .openbuddyignore 未识别 | typed option `additionalIgnore: [".openbuddyignore"]` |
| R2 token budget 算法差异 | 超预算 | pi 默认按 word count | 显式传 `tokenBudget` |
| R3 二进制文件过滤缺失 | 渲染崩溃 | pi 默认仅按扩展名 | adapter 层做 mime check |

## 6. 验收命令

```bash
pnpm workspace:test -- include.test.ts                    # 全过
pnpm test:electron:plugin-hot-reload-e2e                  # 全过
bash scripts/audit/pi-upstream-coverage.sh --json | jq '.unusedByDomain.resource'   # 3 → 1
```

## 7. 与其他 G-gap 关系

- 依赖 G3（profile-manager 落地，include.ts 是其下游）
- 解锁 G8（29 canonical e2e 验证 context 加载）

## 8. 进度更新

`plan4.1.md §3 Phase E` / `docs/PI_INTEGRATION_BACKLOG.md §2 G9` 状态联动；`pi-upstream-coverage.sh` unusedByDomain.resource 自动反映。