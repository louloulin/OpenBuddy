# OpenBuddy 插件体系（PLUGIN_SYSTEM）

> 从 pi 差距到整体插件体系：pi 提供 agent 能力 + Cordis 提供服务骨架 +
> 统一 6-surface 事务。本文描述架构、能力归属解析、事务协调器，以及如何写一个跨 surface 插件。

---

## 1. 6-surface 架构

每个插件包通过 `UnifiedPluginManifest` 声明它贡献哪些 surface：

```
UnifiedPluginManifest.surfaces = bundle | pi | renderer | remote | typert | cordis
```

| surface | 职责 | 运行时 | 关键文件 |
|---|---|---|---|
| `bundle` | Cordis bundle（服务/插件打包） | Main | `plugin-manifest.ts` |
| `pi` | agent 扩展（tools/hooks/commands/skills/prompts/themes） | Pi AgentSession | `pi-extensions.ts` |
| `renderer` | React UI 贡献 | Renderer | `openbuddy-renderer-host` |
| `remote` | 跨进程 RPC 方法 | Main↔Renderer | `remote-manifest.ts` |
| `typert` | 类型安全 remote | Main↔Renderer | `typert-manifest.ts` |
| `cordis` | 服务容器 / DI / 生命周期 | Main | `openbuddy-cordis` |

**pi 的差距 → Cordis 的补充**：

| pi 差距 | Cordis 补充 |
|---|---|
| pi 扩展仅限 agent 运行时 | 服务容器 / DI / 生命周期 |
| pi 无跨进程 RPC | remote / typert surface |
| pi 无 renderer UI 贡献 | renderer surface |
| pi 无统一事务提交点 | `PluginLifecycleQueue` 协调器 |
| pi 无能力归属解析 | `capability-ownership` 权威表 |

---

## 2. 能力归属解析（pi 原生 vs OpenBuddy）

**单一权威**：`packages/runtime/openbuddy-plugin-host/src/capability-ownership.ts`

每个能力声明 **pi 原生插件**（passthrough 时接管）与 **OpenBuddy 插件**（Cordis 兜底）双归属：

```ts
export interface CapabilityOwnership {
  capability: string;      // "mcp" | "permission" | "goal" | ...
  piPlugin: string;        // 原生 pi 包（passthrough 时接管）
  openbuddyPlugin: string; // OpenBuddy 插件（Cordis 兜底）
  serviceKey: string;      // Cordis service key
  passthrough: boolean;    // 是否 passthrough-eligible
  pluginId: string;        // passthrough 时跳过的插件 id
}
```

**解析流程**（`pi-extensions.ts:resolvePiExtensions`）：

```
spec → findCompatibilityAdapter(spec)
  ├─ 匹配 adapter 且 passthrough → recordPassthrough(capability) → 跳过 Cordis mount
  ├─ 匹配 adapter 且非 passthrough → 创建 openbuddy-adapter:<id> 工厂（投影）
  ├─ 匹配 builtin 工厂 → 创建 inline 工厂
  └─ 否则 → 解析外部 pi 原生插件 source
```

**passthrough 注册表**（`pi-passthrough.ts`）：记录"pi 已接管"的能力，Cordis 插件在
`apply()` 时读取并跳过 mount + tool 注册，避免重复。支持可注入的
`PassthroughRegistry` 类（多实例/测试隔离）。

---

## 3. 事务协调器（统一 commit marker）

**`PluginLifecycleQueue`**（`electron/main/agent/plugin-lifecycle.ts`）序列化插件变更，
覆盖全部 6 个 surface：

```
phase: prepare → cordis → artifacts → pi → mcp → renderer → remote → typert → rollback → commit
```

**receipt 机制**：
- `transaction.receipt(surface)` — 某 surface 完成准备
- `transaction.requireReceipt(surface)` — 声明提交前必须有该 surface 的 receipt
- `transaction.awaitSurfaceReceipt(surface)` — 等待某 surface 的 receipt
- 提交时校验所有 `requiredReceipts` 已到齐，否则抛 `PluginTransactionRequiredReceiptMissingError`

**commit marker**：所有 surface 的候选状态收敛到同一 transaction coordinator，
产出共同的 `plugin/transaction-complete` 事件（含最终 receipts）。

---

## 4. 如何写一个跨 surface 插件

以"一个同时贡献 pi 工具 + renderer UI + remote RPC"的插件为例：

### 4.1 声明 manifest

```jsonc
// package.json 或 openbuddy.plugin.v1 manifest
{
  "schema": "openbuddy.plugin.v1",
  "name": "my-plugin",
  "surfaces": [
    { "kind": "pi", "namespace": "openbuddy" },
    { "kind": "renderer", "namespace": "openbuddy" },
    { "kind": "remote", "namespace": "openbuddy" }
  ]
}
```

### 4.2 pi surface（agent 工具）

```ts
// extensions/my-tool.ts
export default (pi) => {
  pi.tools.register("my_tool", { description: "..." }, async (args) => { ... });
};
```

### 4.3 renderer surface（UI 贡献）

```tsx
// client.tsx
export default function MyWidget() { return <div>...</div>; }
```

### 4.4 remote surface（跨进程 RPC）

```ts
// remote.ts
export const methods = {
  myMethod: async (args) => { ... },
};
```

### 4.5 事务内装配

```ts
queue.enqueue("plugin-reload", "my-plugin", async (transaction) => {
  transaction.phase("pi", "pi");
  await loadPiSurface();
  transaction.receipt("pi");

  transaction.phase("renderer", "renderer");
  await loadRendererSurface();
  transaction.receipt("renderer");

  transaction.phase("remote", "remote");
  await loadRemoteSurface();
  transaction.receipt("remote");
});
```

---

## 5. 能力归属决策速查

| 能力 | pi 原生 | OpenBuddy | passthrough |
|---|---|---|---|
| mcp | pi-mcp-adapter | openbuddy-mcp-client | ✓ |
| permission | pi-permission-system | openbuddy-authorization | ✓ |
| goal | pi-goal | openbuddy-team | ✓ |
| plan | pi-plan-mode | pi-plan-mode | ✓ |
| task | @juicesharp/rpiv-todo | openbuddy-task | ✓ |
| session | pi-session | openbuddy-session | ✓ |
| fs | pi-fs | openbuddy-fs-local | ✓ |
| lens | pi-lens | pi-lens | ✓ |
| simplify | pi-simplify | pi-simplify | ✓ |
| hashline | pi-hashline-edit-pro | pi-hashline-edit-pro | ✓ |
| worktree | @dietrichgebert/ponytail | @dietrichgebert/ponytail | ✓ |
| automation | pi-goal-list-loop-audit | pi-goal-list-loop-audit | ✓ |
| team | pi-goal | openbuddy-team | ✗（Cordis 持有） |
| team-subagent | pi-subagents | pi-subagents | ✓ |
| team-goal | pi-goal | pi-goal | ✓ |
| web | pi-web-access | pi-web-access | ✓ |

---

## 6. 相关文件索引

| 文件 | 职责 |
|---|---|
| `packages/runtime/openbuddy-plugin-host/src/capability-ownership.ts` | 能力归属权威表 |
| `packages/runtime/openbuddy-plugin-host/src/pi-passthrough.ts` | passthrough 注册表（可注入） |
| `packages/runtime/openbuddy-plugin-host/src/plugin-manifest.ts` | UnifiedPluginManifest |
| `packages/runtime/openbuddy-plugin-host/src/plugin-snapshot.ts` | 运行时快照 |
| `packages/runtime/openbuddy-plugin-host/src/readiness.ts` | 就绪状态 |
| `packages/runtime/openbuddy-plugin-host/src/profile-manager.ts` | 插件 profile |
| `packages/runtime/openbuddy-cordis/src/index.ts` | @cordisjs/core 薄包装 |
| `packages/renderer/openbuddy-renderer-host/src/` | renderer 客户端模块系统 |
| `electron/main/agent/pi-extensions.ts` | pi 扩展解析 + adapter |
| `electron/main/agent/plugin-lifecycle.ts` | 事务协调器（6-surface） |
| `electron/main/agent/openbuddy-core-plugin.ts` | Cordis 核心插件 |
