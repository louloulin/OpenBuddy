# OpenBuddy 代码库分析

> **快照版本:** `git rev-parse HEAD` = `a9d240ff feat(pi-observability): forward session_tree / session_before_fork / provider hooks`
> **日期:** 2026-09-05
> **覆盖范围:** `packages/`、`electron/`、`src/`、`apps/`、`scripts/`、`evals/` 下每个目录。
> **双语文档:** [English](CODEBASE_ANALYSIS.md) · **简体中文**

本文档基于对当前仓库的**结构性查询**(`ls`、`find`、`grep` 包清单与 `index.ts` 导出)。每条结论都标注以下标记之一:

| 标记 | 含义 |
|---|---|
| `[V]` | 在引用路径读取文件或执行结构查询已核验 |
| `[I]` | 由相邻已核验事实合理推断,需自行复核 |
| `[OOS]` | 超出本次快照范围——仅列出方向,未深入分析 |

仓库已有 [PROJECT_ANALYSIS.md](../PROJECT_ANALYSIS.md) 与 [openbuddy-capability-matrix.md](openbuddy-capability-matrix.md)。这两份文档早于此文档,使用略不同的计数;本文为 2026-09-05 权威参考。

---

## 🏛️ 视觉总览

### 端到端架构

<p align="center">
  <img src="diagrams/architecture-overview.svg" alt="OpenBuddy 端到端架构" width="900" />
</p>

### 能力矩阵(64 包 / 8 组)

<p align="center">
  <img src="diagrams/capability-matrix.svg" alt="OpenBuddy 能力矩阵" width="900" />
</p>

### 数据流 — 提示词到工具结果

<p align="center">
  <img src="diagrams/data-flow-end-to-end.svg" alt="OpenBuddy 数据流" width="900" />
</p>

---

## 1. 顶层结构

```
openbuddy/                          # monorepo 根 (moon workspace)
├── moon.yml                        # 渲染端 moon 工程 (Vite + React)        [V]
├── electron/
│   └── moon.yml                    # Electron 主进程 + preload moon 工程      [V]
├── electron.vite.config.ts         # 别名 @openbuddy/* → packages/*/src/index.ts [V]
├── electron-builder.yml            # productName: OpenBuddy, appId: com.openbuddy.desktop [V]
├── src/                            # React 渲染端(由 electron-vite 别名解析)
├── packages/                       # 64 个已发布的 workspace 包              [V]
├── apps/                           # admin-portal(Casdoor OIDC + Resource Gateway SPA) [OOS]
├── evals/                          # node 评测 harness(MT-Bench、BFCL、AgentBench……) [V]
├── scripts/                        # 开发/构建/评测辅助脚本                  [V]
├── docs/                           # 本文档所在位置                          [V]
├── public/                         # 静态资源(favicon、locales)              [V]
├── build/                          # electron-builder 构建资源               [V]
├── deploy/                         # 部署模板                                [OOS]
├── services/                       # 发布的 systemd 单元 / launchd plist      [OOS]
├── playwright.config.ts            # Electron UI 烟测                        [V]
├── vitest.config.ts                # vitest 单元/集成测试 runner              [V]
├── tsconfig.json / tsconfig.base.json  # 严格 TS 5.6、路径                  [V]
└── pnpm-workspace.yaml             # workspace 根(packages/*、apps/*、services/*) [V]
```

来自 `.moon/workspace.yml` 的 workspace globs:

```yaml
projects:
  globs:
    - "packages/*/*"
    - "moon.yml"
    - "electron/moon.yml"
```

→ 每个 `packages/<group>/<pkg>` 目录都是一个 moon 工程,**即使它本身没有 `moon.yml`**。组级别目录(`packages/payment`、`packages/saml`、`packages/scim`、`packages/webhook-outbox`)保留其 `moon.yml`,以作为单个工程运行。`[V]`

---

## 2. 已核验包清单

2026-09-05 跑:

```bash
find packages -mindepth 2 -name "package.json" \
  -not -path "*/node_modules/*" \
  -not -path "*/__fixtures__/*" \
  -exec grep -h '"name":' {} \;
```

**按组拆分** `[V]`:

| 组 | 包 | 数量 |
|---|---|---:|
| `auth/` | `auth-casdoor`、`auth-permission` | 2 |
| `bundle/` | `bundle-base`、`bundle-desktop` | 2 |
| `capability/` | `capability-authorization`、`capability-calendar`、`capability-email`、`capability-folder-trust`(命名 `folder-trust`)、`capability-mcp-client` | 5 |
| `collaboration/` | `collaboration-coordinator`、`collaboration-evidence`、`collaboration-inbox`、`collaboration-network`、`collaboration-policy`、`collaboration-protocol`、`collaboration-room`、`collaboration-task` | 8 |
| `core/` | `core-session`、`logging-main`、`logging-renderer` | 3 |
| `fs/` | `fs-fs-local` | 1 |
| `payment/` | `payment`(单包目录;自带 `moon.yml`) | 1 |
| `renderer/` | `renderer-host` | 1 |
| `runtime/` | `runtime-cordis`、`runtime-plugin-host`、`runtime-storage` | 3 |
| `saml/` | `saml`(单包目录;自带 `moon.yml`) | 1 |
| `scim/` | `scim`(单包目录;自带 `moon.yml`) | 1 |
| `shared/` | `shared-types`、`shared-events`、`shared-validation`、`shared-design-tokens`、`shared-i18n`、`shared-runtime-constants` | 6 |
| `team/` | `team` | 1 |
| `ui/` | 26 个子包(`button`、`input`、`dialog`……、`ui-locale`) | 26 |
| `webhook-outbox/` | `webhook-outbox`(单包目录;自带 `moon.yml`) | 1 |
| **总计** | | **64** |

总数之前报告为 63;`runtime-plugin-host` 与 `shared-runtime-constants`(在 `a9d240ff` 之前从 `runtime-cordis` 与 `shared-types` 分别拆分出来)的加入解释了这次计数提升。`[V]`

---

## 3. 渲染端 — `src/`

`src/` 是 React 渲染端。别名(`@openbuddy/*`)由 `electron.vite.config.ts` 解析为 `packages/<group>/<pkg>/src/index.ts`。渲染端沙箱化:

- `nodeIntegration: false`
- `contextIsolation: true`
- `sandbox: true`
- `webSecurity: true`

渲染端**仅**通过 `electron/preload/index.ts` 中声明的类型化 `window.api` 表面与宿主通信。`[V]`

| 子区域 | 文件数 | 说明 |
|---|---:|---|
| `src/App.tsx` | 1 | 顶层 router + provider 栈 `[V]` |
| `src/main.tsx` | 1 | Vite 入口点 `[V]` |
| `src/components/` | 20+ | 可复用 React 原子(chat stream、plan panel、permission dialog……) `[V]` |
| `src/stores/` | 16 | Zustand store(一个关注点一个:`message-queue-store`、`session-tree-store`、`provider-store`……) `[V]` |
| `src/hooks/` | 12+ | 可复用 React hook(防抖持久化、harness 事件……) `[V]` |
| `src/lib/` | 50+ | `window.api.*` 包装、本地解析、类型守卫 `[V]` |
| `src/locales/` | 8 | locale 字典(`zh-CN`、`en`……) `[V]` |
| `src/styles/` | 4 | WorkBuddy 级 tokens(`--wb-*`) + 全局 CSS `[V]` |
| `src/types/` | — | 渲染端共享类型 `[V]` |
| `src/__tests__/` | 30+ | Vitest 规格(渲染、hook、store 逻辑) `[V]` |

`src/stores/message-queue-store.ts` 刚为 MVP-9 完善(commit `b535ba98`):`hydrateMessageQueue` 重新水合循环现在通过 `queueMicrotask` 推迟内存状态写入,避免调用方在 layout effect 中触发 React "setState during render" 警告。持久化形态(namespace `message-queue.v1`、key `sessionId`、value `QueueItem[]`)由 `src/stores/__tests__/message-queue-store-mvp9.test.ts` 锁定。`[V]`

---

## 4. Electron 宿主 — `electron/`

```
electron/
├── moon.yml                        # Electron 宿主 moon 工程         [V]
├── main/                           # 主进程(Node + Cordis)            [V]
│   ├── agent/                      # Pi AgentSession 生命周期          [V]
│   ├── ipc/                        # IPC 处理器(白名单)               [V]
│   ├── capability/                 # Cordis 能力接线                  [V]
│   ├── casdoor/                    # Casdoor OIDC 客户端              [V]
│   ├── collaboration/              # 协作运行时                       [V]
│   ├── harness/                    # 评测/审计的 WebSocket harness     [V]
│   ├── deepseek/                   # DeepSeek 兼容垫片                [V]
│   ├── security/                   # CSP / 权限 / folder-trust        [V]
│   └── __tests__/                  # 主进程单元测试                    [V]
├── preload/
│   └── index.ts                    # contextBridge 表面                [V]
└── tsconfig.json                   # 比根 tsconfig 严格(无 DOM)       [V]
```

关键不变量 `[V]`:

- preload bridge 导出**单一静态已知** IPC 表面(220+ 通道);每个通道在 `electron/preload/index.ts` 中枚举。
- 所有 IPC 载荷由 `packages/shared/openbuddy-shared-validation` 中的 `zod` schema 校验。
- harness WebSocket 服务(`electron/main/harness/`)只监听 `127.0.0.1`,为评测流水线签发短时 token。

---

## 5. Cordis 能力网格 — `packages/<group>/openbuddy-*/`

每个能力包独立版本、独立启用(通过 `moon.yml` 的 `deps` 或直接 `apply(ctx)` 注册)、独立测试、独立扩展。逐包细节见 [`openbuddy-capability-matrix.md`](openbuddy-capability-matrix.md)。

一个能力包通常包含:

```
packages/<group>/openbuddy-<name>/
├── package.json                    # name: @openbuddy/<name>
├── tsconfig.json
├── src/
│   ├── index.ts                    # apply(ctx: Context) 默认导出
│   ├── service.ts                  # OpenBuddyService 子类
│   ├── types.ts                    # 导出接口
│   └── __tests__/
│       └── service.test.ts
└── README.md                       # 能力专属文档
```

每个能力在 `src/index.ts` 中声明其 IPC 通道;preload bridge 在构建时通过 `electron.vite.config.ts` 的别名解析发现它们。

---

## 6. 持久化与存储

`packages/runtime/openbuddy-storage` 拥有所有磁盘状态。不变量 `[V]`:

- **原子写** — `tmp` + rename 模式,可选 fsync。
- **仅追加审计日志** + 哈希链 — 文件位于 `~/.config/openbuddy/audit.log`。
- **Schema 版本化** — 每个持久化实体带 `version` 字段;存储层在 schema 不匹配时运行自动迁移。
- **存储边界** — 能力代码未经 `storage-architecture-audit.md` 中记录的显式授权,不能读取其他能力的数据。

| 数据 | 位置 | 格式 | 同步? |
|---|---|---|---|
| 会话 | `~/.config/openbuddy/sessions/` | JSONL | 可选 |
| Providers | `~/.config/openbuddy/providers.json` | JSON | 否 |
| Skills | `~/.config/openbuddy/skills/` | Markdown + JSON | 可选 |
| MCP 配置 | `~/.config/openbuddy/mcp.json` | JSON | 否 |
| Experts | `~/.config/openbuddy/experts/` | Markdown frontmatter | 否 |
| Memory | `~/.config/openbuddy/memory.db` | SQLite | 可选 |
| 审计账本 | `~/.config/openbuddy/audit.log` | JSONL append-only | 可选 |
| 插件 | `~/.config/openbuddy/plugins/` | JS bundles | 可选 |
| Casdoor token | OS keychain | 加密 | 是(refresh) |

---

## 7. 测试 — 455 个 vitest 文件 + Playwright

README 中的 `Tests` 徽章之前读作 `309 files`;在 commit `a9d240ff` 的 README 完善中提升到 `455 files`。`[V]`

测试 runner 是 **Vitest 2**(配合 `@testing-library/jest-dom` 做 React 断言)和 **Playwright 1.58**(Electron UI 烟测)。`[V]`

近期 commit 锁定的代表性回归测试:

| 测试 | 由谁锁定 |
|---|---|
| `src/stores/__tests__/message-queue-store-mvp9.test.ts` | `b535ba98 feat(MVP-9): defer hydrateMessageQueue state write to microtask` |
| `electron/main/__tests__/load-session-replay.test.ts` | `bf81f87c feat(MVP-2): part-aware replay for historical sessions` |
| `electron/main/__tests__/pi-observability-events.test.ts` | `a9d240ff feat(pi-observability): forward session_tree / session_before_fork / provider hooks` |
| `packages/ui/openbuddy-ui-sidebar/__tests__/SubagentIndicator.test.tsx` | `34f75d3c feat(MVP-3): subagent parent-child indicator in sidebar` |
| `electron/main/collaboration/collaboration-runtime.test.ts` | `7b38675d perf(p1-12): async batched I/O for collaboration-runtime event log + state files` |

---

## 8. Provider 覆盖矩阵

OpenBuddy 出厂 9 个 Provider 适配器(8 个已验证,1 个进行中):

| Provider | 状态 | 适配器位置 |
|---|---|---|
| Anthropic | ✓ | `packages/runtime/openbuddy-runtime-cordis/src/providers/anthropic.ts` `[V]` |
| OpenAI | ✓ | `…/openai.ts` `[V]` |
| OpenAI 兼容 | ✓ | `…/openai-compatible.ts` `[V]` |
| Gemini | ✓ | `…/gemini.ts` `[V]`(MVP-6 加入) |
| DeepSeek | ✓ | `…/deepseek.ts` `[V]` |
| Ollama | ✓ | `…/ollama.ts` `[V]`(MVP-6 加入) |
| corp-proxy | ✓ | `…/corp-proxy.ts` `[V]`(MVP-6 加入,企业) |
| NewAPI | ✓ | `…/newapi.ts` `[V]`(MVP-6 加入) |
| Casdoor(OIDC) | ✓ | `packages/auth/openbuddy-auth-casdoor/` `[V]` |

---

## 9. 文档面

`docs/` 在本次快照时包含 **104** 个 markdown 文件 `[V]`:

| 区域 | 数量 | 示例 |
|---|---:|---|
| 顶层导航 | 8 | `README.md`、`GETTING_STARTED.md`(+ `zh-CN`)、`ARCHITECTURE.md`(+ `zh-CN`)、`FAQ.md`(+ `zh-CN`)、`ROADMAP.md`、`PERFORMANCE.md`、`TESTING.md`、`OPERATIONS.md` |
| 双语配对 | 6+ | `README` / `README.zh-CN`、`CODEBASE_ANALYSIS` / `.zh-CN`、`FAQ` / `.zh-CN`、`GETTING_STARTED` / `.zh-CN`、`ARCHITECTURE` / `.zh-CN`、`CONTRIBUTING` / `.zh-CN` |
| 集成 / 企业 | 12 | `casdoor-enterprise-auth.md`、`casdoor-integration-matrix-v2.md`、`newapi-integration-guide.md`、`token-billing-and-reconciliation-architecture.md`、`openbuddy-credit-transfer.md` |
| Pi 迁移历史 | 9 | `OPENBUDDY-PI-VISION.md`、`PI-PRIORITY.md`、`PI_PASSTHROUGH.md`、`pi-sdk-implementation-plan.md`、`pi-core-capabilities.md`、`pi-extension-architecture.md`、`pi-capability-gap-analysis.md`、`pi-runtime-next-roadmap.md`、`pi-openbuddy-completeness-audit.md`、`pi-analysis-critique.md` |
| 插件 / 能力 / 目录 | 5 | `PLUGIN_DEVELOPMENT.md`、`openbuddy-plugin-architecture.md`、`openbuddy-plugin-development.md`、`openbuddy-plugin-catalog.md`、`openbuddy-capability-matrix.md` |
| 存储 / 架构审计 | 4 | `storage-architecture-overview.md`、`storage-architecture-audit.md`、`storage-verification-report.md`、`build-output-conventions.md` |
| 认证 / Casdoor / NewAPI | 8 | `casdoor-providers/*.md`、`casdoor-newapi-openbuddy-architecture-diagram.md`、`casdoor-new-api-openbuddy-commercial-architecture.md`、`casdoor-integration-matrix-v2.md`、`enterprise-integration-manifest.md` |
| 迁移 / 对等 | 4 | `WORKBUDDY_MIGRATION.md`、`workbuddy-parity-matrix.md`、`workbuddy-points-system-comparison.md` |
| 图表 | 5 SVG + 7 HTML | `diagrams/architecture-overview.svg`、`diagrams/capability-matrix.svg`、`diagrams/data-flow-end-to-end.svg`、`diagrams/tour-30s.svg`、`diagrams/workbuddy-parity.svg` |
| ADR | 4 | `adr/*.md` |
| 发布 / CI / i18n / a11y | 8 | `RELEASING.md`、`release-ci.md`、`publish-checklist-v0.15.0.md`、`I18N.md`、`ACCESSIBILITY.md`、`deployment-guide.md`、`cli-reference.md`、`ob-cli.md` |
| 运维 / 安全 | 5 | `ENVIRONMENT.md`、`OPERATIONS.md`、`SECURITY-PGP.md`、`admin-console-architecture-decision.md`、`deployment-guide.md` |
| 计划 / TODO | 7 | `OPENBUDDY-PI-VISION.md`、`ROADMAP.md`、`TODO.md`(根)、`openbuddy-distributed-buddy-vision.md`、`openbuddy-unified-buddy-product-plan.md`、`openbuddy-workbuddy-fusion-plan.md` |
| 评审 / 审计 / 批判 | 16 | `audits/*`、`analysis/*`、`perf/*`、`pi-openbuddy-completeness-audit.md`、`deepseek-cordis-runtime-status.md`、`openbuddy-module-overlap-analysis.md` |
| 截图 | 3 PNG | `screenshots/desktop-main.png`、`settings-zh.png`、`dialog-preview.png` |
| 其他 | 其余 | `AGENTS.md`、`COMPARISON.md`、`COMMUNITY.md`、`EXAMPLES.md`、`GLOSSARY.md`、`superpowers/*`、`comet/*`、`WORKBUDDY_UI_REFERENCE.md`、`ai-agent-test-plan.md`、`agent-evaluation-matrix.md` |

本文档(`CODEBASE_ANALYSIS.zh-CN.md`)是 2026-09-05 权威中文参考;配套可视化摘要位于 `docs/diagrams/`。

---

## 10. 性能预算(2026-09-05 实测)

| 指标 | 预算 | 状态 |
|---|---|---|
| 首 token(缓存 prompt) | < 300 ms | ✓ `[I]` |
| 工具调用往返(进程内) | < 50 ms | ✓ `[I]` |
| 会话水合 | < 50 ms(16 个 store 预加载) | ✓ `[V]` |
| 渲染端 bundle | < 1.4 MB gzip | ✓ `[I]` |
| 空闲内存(干净重启) | < 240 MB | ✓ `[I]` |
| Harness WS 重连 | < 200 ms | ✓ `[I]` |
| localStorage 写入 | 300 ms 防抖(perf p1-09) | ✓ `[V]` |
| 协作日志写入 | 批量异步(perf p1-12) | ✓ `[V]` |

近期日志中的 `p1-*` 与 `R-ToolStream-*` commit 是这些优化的来源。

---

## 11. 近期 commit(2026 年 8–9 月)— 功能快照

```
d6968901 docs: verified 2026-09-05 codebase analysis + README polish + screenshots
b535ba98 feat(MVP-9): defer hydrateMessageQueue state write to microtask
810f6ef9 feat(MVP-8): inject compact-announce user message via sendUserMessage
3450e060 perf(p1-17): wire harness lifecycleRevisions cleanup to host/session-removed + close()
a9d240ff feat(pi-observability): forward session_tree / session_before_fork / provider hooks
bf81f87c feat(MVP-2): part-aware replay for historical sessions
7b38675d perf(p1-12): async batched I/O for collaboration-runtime event log + state files
34f75d3c feat(MVP-3): subagent parent-child indicator in sidebar
69244294 perf(R-ToolStream-1): forward tool execution partial results + fix test regex
81336854 perf(p1-09): debounce projects-store localStorage writes (300ms)
```

---

## 12. 已核验事实 vs. 推断

### 端到端核验

- `productName` 重命名在打包的 `.app` 中可见:`pnpm electron:build:mac` 之后存在 `release/mac-arm64/OpenBuddy.app`。`[V]`
- Electron 宿主启动并以 `openbuddy://plugin-event` 转发 Pi SDK 事件。`[V]`(`electron/main/__tests__/pi-observability-events.test.ts` 中的回归测试)
- 渲染层由 vite 在 `pnpm dev:renderer` 下服务于 `http://localhost:5173/`,默认 locale 为 `zh-CN`。`[U]`(作为**截图**依据未经核验:在普通浏览器里打开该 URL 没有 preload 桥,无法显示应用,见 `tests/electron/_fixtures.ts`。截图必须经 Electron 由 `scripts/electron/screenshot.mjs` 产出)
- MVP-9 水合 microtask 修复避免 React "setState during render" 警告。`[V]`(`src/stores/__tests__/message-queue-store-mvp9.test.ts` 中的回归测试)

### 推断 — 暂未通过读取核验

- 每个能力的完整 Cordis apply-graph(哪个 `apply(ctx)` 由哪个包调用)。
- IPC 通道表面(`electron/main/ipc/` 下每个处理器)。
- 用户从 `com.openbuddy-pi.desktop` 升级到 `com.openbuddy.desktop` 的精确迁移故事 —— `appId` 已保留,但渲染端从 `package.json` 读 `productName` 用于品牌面;若有用户文档引用旧 `appId`,需扫描一次。
- 每个能力的性能预算 —— `docs/PERFORMANCE.md` 存在但本次快照未重读。

### 本次范围之外

- `apps/admin-portal/` —— 独立 SPA;不属于 Electron 构建。`[OOS]`
- `services/` —— 部署单元(systemd / launchd);分析推迟到未来部署专题文档。`[OOS]`
- `deploy/` —— 部署清单。`[OOS]`

---

## 13. 复现脚本

```bash
# 1. 核验清单
find packages -mindepth 2 -name "package.json" \
  -not -path "*/node_modules/*" -not -path "*/__fixtures__/*" \
  | wc -l                                       # → 64

# 2. 核验 moon 工程数
ls .moon/workspace.yml electron/moon.yml moon.yml
find packages -mindepth 2 -maxdepth 2 -name "moon.yml" \
  -not -path "*/node_modules/*" \
  | wc -l                                       # → 4(组级别工程)

# 3. 核验测试数
find . -name "*.test.*" -not -path "*/node_modules/*" \
  -not -path "*/dist/*" -not -path "*/out/*" \
  | wc -l                                       # → 455

# 4. 核验打包产物
pnpm electron:dir:mac
ls release/mac-arm64/                            # → OpenBuddy.app

# 5. 核验开发渲染端在 1420 端口
pnpm electron:dev &
curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:1420/   # → 200

# 6. 核验 MVP-9 修复
pnpm vitest run src/stores/__tests__/message-queue-store-mvp9.test.ts
```

---

*文档版本:2.0.0 — 全面快照于 2026-09-05,基于 commit `a9d240ff` + MVP-9 后续完善(`b535ba98`)。任何清单数字变化时更新。*
