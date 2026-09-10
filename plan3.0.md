# OpenBuddy Pi-Native Consolidation Plan (Plan 3.0)

> 版本：plan3.0 · 日期：2026-09-10 · 适用仓库：`louloulin/OpenBuddy`
>
> 本计划位于 **plan2.0.md（战略）** 与 **plan4.md（执行）** 之间，是 v7/v8 路线的当前可执行整合：把已落地的 K.2 / L.1–L.4 与下阶段 B.2 / B.3 / C / D / E / F / H / I / L.5 收敛成一份"今天可以开工、明天可以验收"的执行清单，并固化"Pi-native 增量"的可验证证据。
>
> 范围：仅覆盖本轮 LUM-687（openbuddy 7期完善）实际可触达的工作；不复制 plan4.md 中需要 ≥2 轮才能完成的深度拆分。
>
> 实施原则：
> - 每个动作都给出"已具备 vs 目标"的可验证证据；
> - 每轮结束必跑 `pnpm typecheck` + 至少一条新单测；
> - 不重写 Pi 内部循环（loop/compaction/provider/JSONL）；
> - 不在 manifest/事件/log 里塞 secret。

---

## 1. 执行摘要

OpenBuddy 当前状态（基线 `agent/devbox2/0032d1a590ea`）：

- Pi Agent Kernel：`@earendil-works/pi-coding-agent@0.85.x` + `pi-agent-core` + `pi-ai`，已经在 Electron Main 进程内以 `AgentSession` 形式运行。
- 微内核：`agent-host.ts` 约 1526 LOC + `pi-extensions.ts` 1222 LOC + 25 个 host-module，仍有进一步收紧空间。
- 已完成 v8 路线：Phase A.1（IPC 桥）、Phase B.1 round 1–5（ipc/agent.ts 1090 → 141 LOC）、Phase K.2（manifest SDK 化）、Phase L.1–L.4（DSH 退役累计 ≈ -8200 LOC）。
- 已注册的 builtin ExtensionFactory：**10 个**（`openbuddy-apply-patch`、`openbuddy-pi-observability`、`openbuddy-pi-context-status`、`openbuddy-pi-context-guard`、`openbuddy-pi-telemetry-bridge`、`openbuddy-pi-compact-announce`、`openbuddy-extra-providers`、`openbuddy-pi-session-metadata`、`openbuddy-pi-model-bridge`、`openbuddy-pi-calendar`）。

pi.dev / pi-coding-agent 提供的、当前 OpenBuddy **尚未充分利用** 的能力（基于 `@earendil-works/pi-coding-agent@0.85.1` d.ts 盘点）：

| Pi 能力 | 现有用法 | 本轮目标 |
|---|---|---|
| `registerTool` | 适配器 + calendar + apply_patch | 保持 |
| `registerCommand` | 适配器 + plan + 兼容层 | 保持 |
| `registerShortcut` | **未用** | **新增** `openbuddy-pi-flag-shortcut` 演示 |
| `registerFlag` | **未用** | **新增** `openbuddy-pi-flag-shortcut` 演示 |
| `registerMessageRenderer` / `registerMarkdownTransformer` / `registerEntryRenderer` | 未在 builtin 中用 | 记录为 Phase E.2 候选 |
| `sendMessage` / `sendUserMessage` | `compact-announce` 已用 sendUserMessage | 保持 |
| `appendEntry` | 仅在 cordis runtime 间接使用 | 记录为 Phase D.3 候选 |
| `getFlag` | 未用 | 与 `registerFlag` 配套使用 |
| `resources_discover` | 未在 builtin 中订阅 | 记录为 Phase B.3 候选 |

pi.dev/packages 上可消费的能力：

- `pi-web-access` / `pi-web-search` / `pi-web-suite` —— web 抓取/检索；
- `pi-clinepass-provider` / `pi-free` / `pi-models-access` —— 增量 provider；
- `pi-marathon-theme` / `@ineersa/my-pi-themes` —— 主题；
- `principal-pi-skills` / `macos-dev-code` —— 技能包；
- `trimegisto` / `wj-pi-subagents` —— 多 agent 编排。

OpenBuddy 当前已注册的 builtin provider：`ollama`（默认）、`corp-proxy`（`OPENBUDDY_PROXY_*`）、`orcarouter`（`ORCAROUTER_API_KEY`）。**尚未注册** `clinepass` / `pi-free` / `pi-models-access` 等第三方聚合 provider。

---

## 2. 本轮（Phase M）路线图

把 plan4.md 的"第二轮到第十二轮"压缩为本轮可执行的 **Phase M.1 – M.3**：

### M.1 — 新增 builtin ExtensionFactory：`openbuddy-pi-flag-shortcut`

- 演示 pi 的 `registerFlag` + `registerShortcut` 全 API 路径；
- 注册 `--openbuddy-debug` CLI flag（boolean，默认 false），handler 通过 `getFlag('openbuddy-debug')` 读取；
- 注册 `ctrl+shift+o` 快捷键，handler 调用 `ctx.shutdown()` 优雅关闭当前 session；
- 不引入新依赖；
- 新增 ≥ 2 个单测（vitest）。

**已具备**：10 个 builtin 已在线运行；`BUILTIN_PI_PLUGIN_MANIFESTS` 表格化登记；resolver `resolveBuiltinPiPlugin` 已统一入口。

**目标**：

- `builtinPiExtensionFactories["openbuddy-pi-flag-shortcut"]` 可调用；
- `builtinPiExtensionIds()` 返回 11 项；
- 1 个测试断言 `registerFlag` 与 `registerShortcut` 均被调用且参数合规；
- 1 个测试断言 `getFlag` 路径可读回 flag 默认值；
- `pnpm typecheck` 0 新增错误。

### M.2 — `scripts/verify-plan.mjs` 支持 plan3.0.md 静态门

- 当前脚本仅识别 `plan2.0.md` / `plan4.md` 的巨型文件阈值与 capability ownership 表；
- 本轮扩展脚本：
  - 增加 `plan3.0.md` 作为合法 plan 文件；
  - 把 `BUILTIN_PI_PLUGIN_MANIFESTS` 长度加入 "Pi 覆盖" 健康度计数；
  - 暴露一条 `--plan3-only` 模式供本轮增量验收。

**已具备**：`scripts/verify-plan.mjs` 已有巨型文件 + capability 派生两阶段静态门。

**目标**：跑 `node scripts/verify-plan.mjs --limit=3000` 返回 0，且新增条目出现在输出中。

### M.3 — 文档：plan3.0.md 与本轮进度标记

- 本文件（plan3.0.md）即产物；
- 在每个动作完成后回填 ✅ / 🔄 / ⚪ 状态；
- 在 `docs/OPENBUDDY_PI_NATIVE_PLAN.md` §11.5 追加本轮 v9 段落引用 plan3.0.md。

---

## 3. 非目标（明确不做）

- 不重写 Pi AgentSession 内部循环、compaction、JSONL session tree；
- 不动 Cordis 服务的现有 owner 表（保留双轨到 Phase D.1/D.2 决策）；
- 不在 main 进程里新增 WebView / BrowserWindow；
- 不引入新顶层 npm 依赖；所有改动使用现有 `@earendil-works/pi-coding-agent` 类型；
- 不动 `electron-builder.yml` / 安装产物；
- 不替 agent-host.ts 拆 4 文件（属于 plan4 Phase B.2，超出本轮范围）。

---

## 4. 验证矩阵

```bash
# M.1 验证
pnpm typecheck
pnpm exec vitest run electron/main/agent/pi-extensions.test.ts

# M.2 验证
node scripts/verify-plan.mjs --limit=3000

# M.3 验证
grep -n "Phase M" docs/OPENBUDDY_PI_NATIVE_PLAN.md
```

退出码 0 即视为通过。

---

## 5. 风险与回滚

| 风险 | 概率 | 防护 |
|---|---|---|
| `registerShortcut` 在某些 Pi 版本不可用 | 低 | 类型守卫 `typeof api.registerShortcut === "function"`，缺失时 no-op |
| `registerFlag` 参数 shape 不匹配 d.ts | 低 | 使用 d.ts 中 `boolean` / `string` 联合字面量，不新增未声明字段 |
| 新增 builtin 触发其它 resolver 用例失败 | 低 | 仅在 `builtinPiExtensionFactories` 末尾追加；不动既有顺序 |
| verify-plan 改动误伤 plan4 既有阈值 | 低 | 仅追加 plan3.0.md 识别 + 一条新计数，不改 `LIMIT_DEFAULT` |

回滚：本轮的所有改动只新增 1 个 builtin 工厂 + 1 个测试 + verify-plan 增量 + 文档，独立 commit，任意一个失败都可单 commit revert。

---

## 6. 后续（不在本轮）

- Phase B.2：agent-host.ts 拆 4 文件（plan4 §7 第二轮）；
- Phase B.3：`discoverAndLoadExtensions` 接入 builtin 与 profile 目录；
- Phase C.1–C.3：tools 工厂化（createBashTool / createReadTool / …）；
- Phase D.1–D.3：SettingsManager / ProjectTrustStore / Skills 复用 PI；
- Phase E.1–E.3：UI 槽位 + ExtensionUIContext 对齐；
- Phase H.1：email capability 3510 LOC → 5 文件拆解；
- Phase I.1–I.3：capability 收敛（task / memory / folder-trust / calendar-web-search-inspiration-notification）；
- Phase L.5：bundle-manifest SDK 化。

---

## 7. 进度

| Phase | 状态 | 备注 |
|---|---|---|
| M.1 `openbuddy-pi-flag-shortcut` builtin | ✅ 已完成 | `electron/main/agent/extensions/flag-shortcut-bridge.ts` (99 LOC) + test (129 LOC, 7 tests pass) + 接入 `builtinPiExtensionFactories` + `BUILTIN_PI_PLUGIN_MANIFESTS` |
| M.2 verify-plan 支持 plan3.0.md | ✅ 已完成 | `scripts/verify-plan.mjs` 新增 `pi-builtin-coverage` + `plan3-flag-shortcut` 两条静态门；`--plan3-only` 过滤模式 |
| M.3 plan3.0.md + OPENBUDDY_PI_NATIVE_PLAN.md v9 段落 | ✅ 已完成 | 本文件 + `docs/OPENBUDDY_PI_NATIVE_PLAN.md` §11.6 v9 段落 |

**验证结果**：

- `pnpm typecheck` 0 新增错误
- `pnpm exec vitest run electron/main/agent/extensions/flag-shortcut-bridge.test.ts` → 7 passed
- `pnpm exec vitest run electron/main/agent/pi-extensions.test.ts` → 39 passed（已同步更新 `builtinPiExtensionIds()` 期望表，加入第 11 项）
- `node scripts/verify-plan.mjs` → 4/4 gates passed（giant-file-limit / capability-ownership-single-source / pi-builtin-coverage / plan3-flag-shortcut）

> 状态图例：⚪ 未开始 · 🔄 进行中 · ✅ 已完成 · ⛔ 阻塞
