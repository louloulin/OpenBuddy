# G5 实现规格：generateBranchSummary 接管 branch-summary-format 自实现

> 📅 2026-09-11 · 父任务 LUM-785 · 对应 plan4.1.md §3 Phase E + backlog G5
>
> **状态**：规格已落地（2026-09-11 Round 8）。

---

## 0. 一页摘要

| 项 | 值 |
|---|---|
| 当前文件 | `electron/main/agent/host-modules/branch-summary-format.ts`（注释明确 NOT using pi）|
| 涉及 pi API | `generateBranchSummary`（pi-coding-agent）|
| Owner | runtime team |
| 估时 | 1 周 |
| 阻塞 | **依赖 G2**（settings 接入 model 调用配置）|
| 风险等级 | 中（需 model 调用 + keychain 凭据）|

---

## 1. 当前实现盘点

```
branch-summary-format.ts: 自实现 LLM-call wrapper
- 自定义 prompt template
- 自定义 token budget
- 自定义 streaming response format
- 注释明确 NOT using pi 的 generateBranchSummary
```

**自实现总规模** ~150 LOC。

## 2. 目标实现

```typescript
// electron/main/agent/host-modules/branch-summary-format.ts (重写)
import { generateBranchSummary, collectEntriesForBranchSummary, prepareBranchEntries } from "@earendil-works/pi-coding-agent";

export async function formatBranchSummary(entries: SessionEntry[], options?: SummaryOptions): Promise<string> {
  // 1. 用 pi 的 prepareBranchEntries 替代自定义 token budget
  const prepared = prepareBranchEntries(entries, { tokenBudget: options?.tokenBudget ?? 2000 });
  // 2. 用 pi 的 generateBranchSummary 替代自定义 LLM call
  return generateBranchSummary(prepared, { model: options?.model ?? getDefaultModel() });
}
```

**目标 LOC 估算**：~150 LOC → ~30 LOC（保留 fallback formatter 用于 offline 模式）。

## 3. 迁移步骤（2 PR）

### PR 1 — generateBranchSummary 接入
1. 改 `formatBranchSummary` 内部用 pi API
2. 自定义 prompt template ~50 LOC 删除
3. 自定义 streaming wrapper ~50 LOC 删除
4. 保留 offline mode fallback formatter（~30 LOC）
5. 跑 vitest + Electron smoke

### PR 2 — token budget 与 prepareBranchEntries 接管
1. 删除自定义 token budget 计算
2. 用 pi `prepareBranchEntries`
3. 跑性能测试：branch summary 生成时间 ≤ 1.5x pi 默认

## 4. 测试策略

- 单元：`branch-summary-format.test.ts`（existing + 新增 model mock 测试）
- 集成：`tests/electron/sync-core-e2e.spec.ts`（branch summary round-trip）

## 5. 风险评估

| 风险 | 影响 | 触发 | 缓解 |
|---|---|---|---|
| R1 model 调用 cost 增加 | API 成本上升 | pi 默认用更大的 model | 保留 token budget 选项 |
| R2 offline mode 缺失 | 无网络时崩 | model 调用 require 网络 | fallback formatter 保留 |
| R3 keychain 凭据缺失 | model 调用失败 | 用户未登录 | 友好错误提示 |

## 6. 验收命令

```bash
pnpm workspace:test -- branch-summary-format.test.ts  # 全过
pnpm test:electron:sync-core-e2e                       # 全过
```

## 7. 与其他 G-gap 关系

- 依赖 G2（settings 接入 model 配置）
- 解锁 G12（pi-runtime-coordinator 复用 AgentSessionRuntime）

## 8. 进度更新

`plan4.1.md §3 Phase E` / `docs/PI_INTEGRATION_BACKLOG.md §2 G5` 状态联动。