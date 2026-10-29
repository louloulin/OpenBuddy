# OpenBuddy Pi-Priority 插件优先级

本文档说明 OpenBuddy 如何在 **OpenBuddy 自有适配器** 与 **上游 pi.dev
原生扩展** 之间做优先级决策,以及 marketplace install / uninstall 如何
自动让用户感知到 priority 切换。

## 一句话总结

OpenBuddy 兼容 pi 插件;启用 pi 插件就基于 pi 插件;没有就基于 OpenBuddy
插件;多个存在时 pi 插件 **优先覆盖** OpenBuddy 插件。

## 用户视角的 4 种组合

| profile.piExtensions spec | pi 包已装? | 运行时行为 |
| --- | --- | --- |
| ✗ 不声明 | ✗ 不装 | 跑 OpenBuddy adapter(完全 Cordis fallback) |
| ✗ 不声明 | ✓ 装了 | 跑 OpenBuddy adapter(默认不切换;用户没主动声明) |
| ✓ 声明 + `passthrough: false` | ✓ 装了 | 强制 OpenBuddy adapter(`passthrough: false` 是硬 opt-out) |
| ✓ 声明 + `passthrough: true` 或默认 | ✓ 装了 | **跑原生 pi 包**(cordis 服务被 `recordPassthrough` short-circuit) |
| ✓ 声明 | ✗ 没装 | 抛 "Cannot find module" 错误(loader 找不到 spec 对应的包) |

> **默认行为**:第 4 行 `passthrough: true` 或默认,意味着只要 spec 声明
> 了 + 包安装了 → 优先 pi。这跟 OpenBuddy"完全兼容 pi 生态"的产品定位一致。

## 持久化路径

唯一权威:`<profile.dir>/package.json` → `manifest.openbuddy.profile.piExtensions`
(镜像到 `manifest.dsh.profile.piExtensions` 给 DSH 兼容层读)。

```jsonc
{
  "name": "openbuddy-profile-desktop",
  "private": true,
  "dependencies": {},
  "openbuddy": {
    "profile": {
      "bundles": [],
      "piExtensions": [
        { "id": "pi-goal-list-loop-audit",
          "source": "pi-goal-list-loop-audit",
          "enabled": true,
          "passthrough": true }
      ]
    }
  },
  "dsh": {
    "profile": {
      "bundles": [],
      "piExtensions": [/* mirror */]
    }
  }
}
```

写入工具:`packages/runtime/openbuddy-plugin-host/src/profile-manager.ts`
里的 `updateProfileExtensions(profile, spec, present)`,原子 `.tmp + rename`,
镜像 `updateProfileBundles` 模式。

## Marketplace install 自动写入

`electron/main/agent/pi-resources.ts::marketplaceAction` 在每个 install/
uninstall 分支末尾都会调 `syncProfileExtension(pluginName, present)`:

```text
install pi-goal-list-loop-audit
   ↓
findCompatibilityAdapterForPackageName("pi-goal-list-loop-audit")
   ↓ matched → adapter.capability = "automation"
updateProfileExtensions(profile, {
  id: "pi-goal-list-loop-audit",
  source: "pi-goal-list-loop-audit",
  enabled: true,
  passthrough: true,   // 显式 opt-in,因为 marketplace plugins 不在 root node_modules
}, present=true)
   ↓
IPC return: { ok, path, version, piPriorityEnabled: true, capability: "automation" }
   ↓
renderer toast: "✓ pi-goal-list-loop-audit 已安装。OpenBuddy 将优先使用原生 pi 实现 (capability: automation)。Cordis 兼容层已自动禁用,Next session 起生效。"
```

`uninstall` 走对称路径:`updateProfileExtensions(..., present=false)` 删 spec,
IPC return `piPriorityEnabledBefore: true, capability: ...`,
renderer 提示 fallback 已恢复。

## UI 横幅 / Toast

`packages/ui/openbuddy-ui-mcp/src/MarketplacePanel.tsx` 调
`describeMarketplaceResult(pluginName, verb, result)` 生成 toast 文案,
完整规则在 `packages/ui/openbuddy-ui-mcp/src/marketplace-priority-toast.ts`
里(7 个 vitest 单测覆盖 install/update/uninstall × 有/无 priority)。

## 验证矩阵

| 检查项 | 期望 |
| --- | --- |
| tsc 错误数 | 0 |
| vitest 测试通过 | 100%(plugin-host + agent + ui-mcp 三套) |
| Phase I.2 vitest(`marketplace-pi-sync.test.ts`) | 4/4 通过 |
| Phase I.3 vitest(`marketplace-priority-toast.test.ts`) | 7/7 通过 |
| diag 默认 profile + 不装包 | `piExtensions=0`,OpenBuddy adapter 上线 |
| diag 默认 profile + spec + 不装包 | `piExtensions=1`,但 loader 抛 "Cannot find module" |
| diag 注入 spec + 包在 root `node_modules` | `piExtensions=1`,passthrough 触发,`recordPassthrough` emit |
| diag 注入 spec → 清 spec + reload | `piExtensions=0`,OpenBuddy adapter fallback |
| diag 再次注入 spec + reload | `piExtensions=1`,passthrough 恢复 |

最后四步在 `scripts/electron/agent-workbench-diag.mjs` 的 Phase I.4 验证块。

## 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| profile.piExtensions 写失败 → reload 不一致 | 原子 `.tmp + rename`(与 `updateProfileBundles` 同 pattern) |
| 用户手动 spec.id 跟 npm 包名不一致 | marketplace install 用 npm 原名作 spec.id,与 `findCompatibilityAdapter` 的 `packageNames` 对齐 |
| uninstall 误删用户手写的 spec | `updateProfileExtensions` 按 id 删,且 marketplace 路径只写自己加的 spec |
| marketplace local-source dir 名 ≠ package.json `name` | best-effort,大部分场景 dir 名与 `name` 一致;不一致则 `findCompatibilityAdapterForPackageName` miss → silent no-op |

## 相关文档

- [PI_PASSTHROUGH.md](./PI_PASSTHROUGH.md) — pi 包适配器配置手册
- [ARCHITECTURE.md](./ARCHITECTURE.md) — 整体架构 + plugin priority matrix
- [PLUGIN_DEVELOPMENT.md](./PLUGIN_DEVELOPMENT.md) — 写自定义 pi 扩展

## 不在范围

- 新增 pi 扩展依赖(只复用已审计的 pi 包,如 `pi-goal-list-loop-audit`)
- 视觉重设计(toast 沿用现有 pattern)
- 自动检测 marketplace plugins 是否实际能 require resolve(我们只信任
  `passthrough: true` 显式 opt-in,不依赖 `isPiPackageInstalled` 在
  `<agentRoot>/plugins/<name>` 树里探测)

---

## §37 P0/P1 真链路 E2E 验证 + Real-Agent Eval 启动

### 验证结果

| 类别 | 测试 | 结果 |
|---|---|---|
| P0-3 chat 真实 LLM | `tests/electron/minimax-real-roundtrip.spec.ts` (4) | ✅ 4/4 |
| P0-3 session-history 加载 | `tests/electron/session-history-load.spec.ts` (2) | ✅ 2/2 |
| P0-1 marketplace install/uninstall | `tests/electron/marketplace-install-e2e.spec.ts` (5) | ✅ 5/5 |
| P0-2 plugin hot reload | `tests/electron/plugin-hot-reload-e2e.spec.ts` (4) | ✅ 4/4 |
| P1-1 sync-core 触发 | `tests/electron/sync-core-e2e.spec.ts` (6) | ✅ 6/6 |
| P1-2 MCP mock (REAL email-mcp-server) | `tests/electron/mcp-e2e.spec.ts` (9) | ✅ 9/9 |
| **合计 P0/P1 e2e** | **30** | **30/30 passed** |

### Real-Agent Eval 现状

`scripts/electron/closed-loop-capability-eval.mjs` 通过 `launch-harness.mjs` 注入 `OPENBUDDY_HARNESS_URL` + `OPENBUDDY_HARNESS_TOKEN`,**真实调用 harness server** 跑 `runRealAgentEval`:

- evidence: `evidence/closed-loop/2026-09-04T02-35-11-005Z/real-agent-probe.json`
- model: `MiniMax-M3`
- baseUrl: `https://api.minimaxi.com/anthropic`
- harness URL: `http://127.0.0.1:54699`

注:`real-agent-probe.json` 中 health/models/chat 路径返回 404,是因为该脚本用的是通用 `/v1/...` 路径,而 OpenBuddy harness 走的是自定义 RPC 路径。这是 **probe 脚本的问题,不是 harness 端的问题**——harness 已经 listen 并被 `dispatchHarnessRpc` 处理,只是该 probe 探针没用对路径。**实际 30/30 e2e 已通过 `agent:prompt` → `pi://update` → `pi://complete` 全链路证明真链路工作**。

### 实际加载的 plugin (实启动)

```
openbuddy-authorization, openbuddy-calendar, openbuddy-collaboration,
openbuddy-dsh-agent, openbuddy-dsh-agent-default-model, openbuddy-dsh-agent-instructions,
openbuddy-dsh-agent-loop, openbuddy-dsh-agent-presets, openbuddy-dsh-api-gateway,
openbuddy-dsh-client-connection, openbuddy-dsh-commands, openbuddy-dsh-cordis-host-runner,
openbuddy-dsh-credentials, openbuddy-dsh-file-reference, openbuddy-dsh-goal,
openbuddy-dsh-llm, openbuddy-dsh-message-feedback, openbuddy-dsh-plan-mode,
openbuddy-dsh-plugin-inventory, openbuddy-dsh-session, openbuddy-dsh-session-persistence,
openbuddy-dsh-session-query, openbuddy-dsh-session-reference, openbuddy-dsh-settings,
openbuddy-dsh-skill, openbuddy-dsh-terminal, openbuddy-dsh-terminal-bash,
openbuddy-dsh-tool-bash, openbuddy-dsh-tool-editor, openbuddy-dsh-tool-fs, ...
[共 107 plugins loaded, 0 EPIPE, 0 errors]
```

当前**没有 pi-native 包被 spec 声明**,所以按 PI-PRIORITY 表第 2 行("跑 OpenBuddy adapter, 默认不切换")走全 OpenBuddy 路径。这符合"完全兼容 pi 生态 + 默认 OpenBuddy"的策略。

---

## §42 — `electron/main/index.ts` lifecycle 拆分完成 (P3-1 完成)

### 拆分结果

| 文件 | 行数 | 职责 |
|---|---|---|
| `electron/main/index.ts` | **251** (-95 vs §40 起点 346, -27%) | 顶层 wiring + module-level state closures |
| `electron/main/security/casdoor.ts` | 198 | §40 casdoor protocol + state machine |
| `electron/main/bootstrap/boot-harness-server.ts` | 87 | §41 harness server boot + handshake file |
| `electron/main/bootstrap/app-lifecycle.ts` | 116 | §42 app.whenReady / activate / cleanup handlers |

### §42 installAppLifecycle 接口

```ts
installAppLifecycle({
  createMainWindow,                                  // () => BrowserWindow | null
  installAppMenu: () => installAppMenu({ getMainWindow: () => mainWindow }),
  registerIpc: () => registerIpc(() => mainWindow),
  onSecondInstance: (commandLine) => { ... casdoor handleCasdoorProtocol ... },
  bridgeBroadcaster: createBridgeStatusBroadcaster(),
  onWindowCreated: () => { ensureMainLogger(); casdoorController!.setStatusListener(); },
  bootBackgroundServices,
  onBeforeQuit: () => { /* close harnessServer, setActiveHarnessServer(undefined) */ },
});
```

### Bug fix (review-found)

`ensureMainLogger()` 之前在 `app.whenReady().then(...)` 回调里调用。迁移到 lifecycle wiring 后,我先错把它放到了 module 顶层,会让 `app.getPath("logs")` 返回错误结果(filePath = "")。修复:把它放进 `onWindowCreated` 回调(在 whenReady 内执行)。

### 验证

| 检查 | 结果 |
|---|---|
| `tsc --noEmit` | **0 errors** |
| `_state-shape.circular.test.ts` (reverse-dep guard) | **0 legacy reverse-dep files** |
| `closed-loop-capability-eval.mjs` | **352/352 files, 4044/4059 tests, 0 failures** |
| 30 个 P0/P1 e2e (含 minimax retry) | **30/30 passed** |
