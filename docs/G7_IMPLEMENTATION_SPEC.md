# G7 实现规格：shell helper 用 pi bash-executor + PowerShell config

> 📅 2026-09-11 · 父任务 LUM-785 · 对应 plan4.1.md §3 Phase F + backlog G7
>
> **状态**：规格已落地（2026-09-11 Round 8）。

---

## 0. 一页摘要

| 项 | 值 |
|---|---|
| 当前实现 | `electron/main/agent/extensions/apply-patch.ts:39-40` 直接用 `node:child_process.execFile` |
| 自实现规模 | ~30 LOC（shell exec wrapper）|
| 涉及 pi API | `getShellConfig / getPowerShellConfig / bash-executor` |
| Owner | runtime team |
| 估时 | 1 周 |
| 阻塞 | **依赖 G1**（bash tool 由 G1 落地）|
| 风险等级 | 低（shell config 是 typed adapter）|

---

## 1. 当前实现盘点

```
electron/main/agent/extensions/apply-patch.ts:39-40
- import { execFile } from "node:child_process"
- 直接 await execFile(cmd, args)
- 无 shell config 校验（不区分 bash / PowerShell / zsh）
- 无 audit log
```

## 2. 目标实现

```typescript
// electron/main/agent/extensions/apply-patch.ts (内部重构)
import { getShellConfig, getPowerShellConfig } from "@earendil-works/pi-coding-agent";

async function runShell(cmd: string, args: string[], options: ShellOptions): Promise<ShellResult> {
  // 1. 用 pi 的 getShellConfig 替代自实现 platform 判断
  const config = process.platform === "win32"
    ? getPowerShellConfig()
    : getShellConfig(process.env.SHELL ?? "/bin/bash");

  // 2. 通过 G1 落地的 bash tool 调用（typed facade）
  return bashExecutor(config, cmd, args, options);
}
```

**目标 LOC 估算**：~30 LOC → ~15 LOC（typed adapter + G1 bash tool delegate）。

## 3. 迁移步骤（1 PR）

### PR 1 — shell config 切换 + bash tool delegate
1. 删 `node:child_process.execFile` 直接 import
2. 用 pi `getShellConfig` / `getPowerShellConfig`
3. shell 调用 delegate 给 G1 bash tool
4. 跑 vitest + Electron smoke

## 4. 测试策略

- 单元：`apply-patch.test.ts`（existing）+ shell config mock
- 跨平台：`tests/electron/*-e2e.spec.ts`（Windows / macOS / Linux 各跑 1 次）

## 5. 风险评估

| 风险 | 影响 | 触发 | 缓解 |
|---|---|---|---|
| R1 Windows PowerShell 行为差异 | shell 调用失败 | PowerShell vs bash 语法 | getPowerShellConfig typed |
| R2 现有 audit log 格式变化 | 监控告警 | audit format 不同 | adapter 层保留字段 |
| R3 shell 调用权限 | sandbox 失效 | 未接 folderTrust | G1 bash tool 已含 |

## 6. 验收命令

```bash
pnpm workspace:test -- apply-patch.test.ts  # 全过
pnpm test:electron:agent-workbench-core     # 全过
```

## 7. 与其他 G-gap 关系

- 依赖 G1（bash tool 由 G1 提供）

## 8. 进度更新

`plan4.1.md §3 Phase F` / `docs/PI_INTEGRATION_BACKLOG.md §2 G7` 状态联动。