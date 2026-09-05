# OpenBuddy → WorkBuddy 开源版 改造路线图

> 综合审计日期:2026-09-03
> 数据来源:3 个 Explore agent 全量扫描 + 既有 Phase C/D/F/G/H/I 历史成果
> 目标:把 OpenBuddy 从"双轨混合"收敛到"pi 优先 + Cordis 兜底"的薄包装

---

## 一、当前态一句话总结

OpenBuddy **60% 已基于 pi**,但仍有 **10 个 Cordis service 跟 pi 并列运行**,3 个 adapter
(permission / fs-local / session)明明 `passthrough: true` 却因为 Cordis 端没标
`passthroughCapability` 而 **永远跑两份**(OpenBuddy + pi 双倍资源占用 + 行为漂移)。

UI 侧也有 5 类可见性问题(插件面板重复、市场卡片没 pi-priority 徽章、工具列表
缺失、日历能力无面板、自动化面板引导死链)。

---

## 二、能力适配矩阵(12 个 capability 全景)

数据来源:`compatibilityAdapters` in `electron/main/agent/pi-extensions.ts:243-582` +
`openBuddyCapabilityPlugins` in `packages/bundle/openbuddy-base/src/capability-plugins.ts:447-459`。

| # | capability | pi 候选包 | adapter.passthrough | G-1d tool | Cordis 端 | 状态 | 行动建议 |
|---|---|---|---|---|---|---|---|
| 1 | mcp | pi-mcp-adapter (~761K/月) | ✓ | openbuddy_mcp | openbuddy-mcp-client (`passthroughCapability: "mcp"`) | ✅ 已收敛 | 保持 |
| 2 | permission | pi-permission-system | ✓ | openbuddy_permissions | openbuddy-permission **无 flag** | ⚠ 双轨 | **加 `passthroughCapability: "permission"` → 删 Cordis mount** |
| 3 | goal | pi-goal / pi-subagents | ✓ | openbuddy_goals | openbuddy-team | ⚠ 双轨 | **加 `passthroughCapability: "goal"` → 删 Cordis mount** |
| 4 | plan | pi-plan-mode | ✓ | — | 无 Cordis | ✅ 纯透传 | 保持 |
| 5 | task | pi-todo / pi-tasks | ✓ | openbuddy_tasks | openbuddy-task **孤儿**(未在 openBuddyCapabilityPlugins) | ⚠ 半双轨 | **删 adapter L383-431,只留 Cordis task(或反之)** |
| 6 | session | pi-session | ✗(adapter 关) | openbuddy_sessions | openbuddy-session | ⚠ 双轨 | **adapter.passthrough 改 true,加 flag,删 Cordis mount** |
| 7 | fs | pi-fs / pi-file-tools | ✗(adapter 关) | openbuddy_fs | openbuddy-fs-local | ⚠ 双轨 | **adapter.passthrough 改 true,加 flag,删 Cordis mount** |
| 8 | lens | pi-lens | ✓ | — | 无 Cordis | ✅ 纯白名单 | 保持 |
| 9 | simplify | pi-simplify | ✓ | — | 无 Cordis | ✅ 纯白名单 | 保持 |
| 10 | hashline | pi-hashline-edit-pro | ✓ | — | 无 Cordis | ✅ 纯白名单 | 保持 |
| 11 | worktree | @dietrichgebert/ponytail | ✓ | — | 无 Cordis | ✅ 纯白名单 | 保持 |
| 12 | automation | pi-goal-list-loop-audit | ✓ | — | 无(Stage H-4 已删) | ✅ 已收敛 | 保持 |

### 收敛统计

| 类别 | 数量 | 命名 |
|---|---|---|
| 已完全 pi 化(Cordis 已删 / 无) | **6** | plan / lens / simplify / hashline / worktree / automation |
| 显式 passthrough + Cordis 也有 flag(正确双轨) | **1** | mcp |
| adapter 说 passthrough 但 Cordis 没 flag(双轨浪费) | **3** | permission / goal / session(需修 adapter) / fs(需修 adapter) |
| 孤儿/状态错乱 | **2** | task(adapter vs Cordis mount 不对应) / memory(Cordis noop) |

---

## 三、Plugin Priority 架构图

```
┌────────────────────────────────────────────────────────────────┐
│                        Renderer (React)                         │
│  MarketplacePanel · OpenBuddyPluginPanel · ChatComposer · ...  │
│  ↓ 工具调用 / 启用状态                                              │
│  window.api.invoke("agent:*", "marketplace_action", "...")     │
└──────────────────────────┬─────────────────────────────────────┘
                           │ IPC bridge (preload/index.ts)
┌──────────────────────────▼─────────────────────────────────────┐
│              Main process: agentHost facade(104 字段)             │
│  init · newSession · pluginInventory · toolsList · prompt · ...  │
│  ┌─────────────┐  ┌─────────────────┐  ┌────────────────────┐  │
│  │ Cordis ctx  │  │ pi session      │  │ harness loader      │  │
│  │ openbuddy-* │  │ (pi-coding-agent)│  │ (profile.piExts)    │  │
│  └─────────────┘  └─────────────────┘  └────────────────────┘  │
└──────────────────────────┬─────────────────────────────────────┘
                           │
┌──────────────────────────▼─────────────────────────────────────┐
│              HarnessPluginLoader(profile.piExtensions)          │
│                                                                  │
│  for each spec in profile.piExtensions:                         │
│    adapter = findCompatibilityAdapter(spec)                      │
│    ┌──────────────────────────────────────────────────────┐     │
│    │ if adapter.passthrough && spec.passthrough !== false │     │
│    │   AND isPiPackageInstalled(adapter.piPackageHint): │     │
│    │     recordPassthrough(capability, "installed", ...) │     │
│    │     → apply(): capability → noop (Cordis skip)       │     │
│    │ else:                                                │     │
│    │   register Cordis stub from compatibilityAdapters[] │     │
│    └──────────────────────────────────────────────────────┘     │
└──────────────────────────┬─────────────────────────────────────┘
                           │
┌──────────────────────────▼─────────────────────────────────────┐
│                       pi.dev 包市场                              │
│  pi-mcp-adapter · pi-web-access · pi-subagents · ...           │
│  安装路径:<projectRoot>/node_modules 或 <agentRoot>/plugins/    │
└────────────────────────────────────────────────────────────────┘
```

**当前断点**:`isPiPackageInstalled` 只查 `<projectRoot>/node_modules/<pkg>`,**不查**
`<agentRoot>/plugins/<name>/`。marketplace 装的包落 `plugins/<name>` 永远
`installed: false`,即使 profile.piExtensions 已声明 spec,也不会触发 passthrough。
→ Phase I.2 已修:marketplace install 自动写 profile.piExtensions;但 `plugins/<name>`
路径探测仍是 R-X1 缺口。

---

## 四、决策矩阵:何时用 pi 原生 vs Cordis OpenBuddy

| 场景 | 用 pi 原生 | 保留 Cordis | 决策依据 |
|---|---|---|---|
| capability 有 pi.dev 月下载 > 100K 的实现 | ✓ | — | pi 包是社区事实标准 |
| capability 在 pi.dev **无对应实现**(email/calendar/billing) | — | ✓ | pi 没做,只能自建 |
| pi 包与 OpenBuddy 业务模型冲突(术语/数据格式) | — | ✓ | 例:email 必须 IMAP ID,pi 不懂 |
| pi 包对 Cordis 现有 service 是 superset | ✓ | 删 Cordis mount | 加 `passthroughCapability` |
| pi 包是 partial(只覆盖 1 个子能力) | — | ✓ Cordis 加 passthroughCapability | 例:pi-fs 只读,OpenBuddy fs 要写 |
| pi 包稳定但 OpenBuddy 数据 schema 不同 | — | ✓(带 capability adapter 转换) | 双方责任清晰 |
| **判断不出谁更好** | — | 保留双轨 + `passthroughCapability` flag | 用户显式 opt-in 切换 |

**已确认双轨→单轨清单**(基于 pi.dev 月下载量 + 社区维护活跃度):

| 能力 | 删 Cordis 收益 | pi 实现成熟度 |
|---|---|---|
| permission | 删 permissionPlugin 节省 ~200 LOC | pi-permission-system 月下载稳定,有 owner |
| goal | 删 teamPlugin 节省 ~400 LOC | pi-goal + pi-subagents 是 pi 官方推荐组合 |
| session | 删 sessionPlugin 节省 ~500 LOC | pi-session 是 pi 原生 session 模型 |
| fs | 删 fsLocalPlugin 节省 ~350 LOC | pi-fs 已有,但需评估写操作覆盖度 |
| task | 删 openbuddy-task 节省 ~300 LOC(若 Cordis 真在用) | pi-todo 是可选替换 |

---

## 五、Top pi.dev 包(2026 月下载)

| 包 | 月下载 | 对应 capability | 可用替换 OpenBuddy 哪部分 |
|---|---|---|---|
| pi-mcp-adapter | ~628-761K | mcp | openbuddy-mcp-client(已替换) |
| pi-web-access | ~370-401K | web_fetch | 当前 OpenBuddy websearch 适配 |
| pi-subagents | ~330-362K | goal/team | openbuddy-team + createTeamTools |
| pi-goal-list-loop-audit | ~26.4K | automation | openbuddy-automation(已替换) |
| @zhushanwen/pi-todo | 1,965 | task | openbuddy-task |

**新候选**:`pi-web-access` 可作为 WebSearch/WebFetch 能力替换;`pi-subagents`
若稳定性 OK,可进一步瘦身 `openbuddy-team` 的 agent runner。

---

## 六、UI 层面缺口与修复

来自 agent `a894e0792f113fc56`(UI 审计)。

### 缺口 1:Marketplace 卡片无 pi-priority 徽章

**现状**:`MarketplacePluginCard` (L474-548) 只展示通用 `已安装` 徽章(L484)。
Phase I.3 toast 已落地(7 个测试通过),但 **卡片本身不显示 pi-priority chip**。

**修复**:
- 文件:`packages/ui/openbuddy-ui-mcp/src/MarketplacePanel.tsx`
- 改动:`MarketplacePluginCard` 内嵌一个 `<PiPriorityChip>` 组件,数据源:
  - IPC `agent:plugin-inventory` → `inventory.piExtensions` → spec.passthrough + adapter.passthrough
  - 本地 map:`compatibilityAdapters[*].packageNames → adapter.capability`
- 当 spec.id 在 inventory 中且 spec.passthrough !== false → 显示 chip "π Native · {capability}"
- 文案:`capability: {name} · OpenBuddy 优先使用原生 pi 实现`
- LOC:约 +40 行 + 1 个新文件 `MarketplacePiPriorityChip.tsx`
- 测试:`marketplace-priority-toast.test.ts` 加 chip 渲染用例

### 缺口 2:无 chat composer 工具列表

**现状**:`toolsList()` IPC 已就位(`packages/renderer/openbuddy-renderer-host/src/index.ts:172`)
但 renderer 端 **0 个 consumer 文件**(grep 确认)。`toolsList` 形同虚设。

**修复**:
- 文件:`packages/ui/openbuddy-ui-chat/src/Composer.tsx`(新增 `/` 命令面板)
- 改动:加 `/` 触发 → 拉取 `toolsList()` → 展示所有可用工具(命令 + 工具名 + 来源:pi vs Cordis)
- 选中工具 → 插入 `<tool>` 提示到输入框
- 受益 UX:用户能看到自己启用了什么(尤其自动化面板里 pi-goal-list-loop-audit 是隐藏的)
- LOC:约 +200 行 + 1 个新文件 `ToolPickerPopover.tsx`

### 缺口 3:Calendar 能力在 McpEndpointCard 引用但无面板

**现状**:`McpEndpointCard.tsx:65` 列出 `openbuddy-calendar` 但
`packages/ui/openbuddy-ui-calendar/` 不存在。

**修复**(短期先做最简版):
- 文件:新增 `packages/ui/openbuddy-ui-calendar/src/CalendarPanel.tsx`
- 改动:列出已连接的 calendar provider + 日历事件流(读 openbuddy-calendar IPC)
- 范围:**只读 shell**,不写新功能(用户约束"自动化面板 UI shell 保留"延伸)
- LOC:约 +150 行

### 缺口 4:AutomationPanel 引导死链

**现状**:`AutomationPanel.tsx:191-198,236-243` 提示用户去 `/marketplace + /goal`,
但 `/goal` 没有注册。

**修复**:
- 文件:`packages/ui/openbuddy-ui-automation/src/AutomationPanel.tsx`
- 改动:`/goal` 改成 `"市场 → 安装 pi-goal-list-loop-audit"`,提供可点击跳转
  到 `MarketplacePanel`(用 `router.push("/settings/marketplace")` 或同窗口 anchor)
- LOC:约 +20 行

### 缺口 5:PluginsPanel vs OpenBuddyPluginPanel 重复

**现状**:两个 panel 并列:
- `PluginsPanel.tsx`(legacy pi x.ai/plugins 启停)
- `OpenBuddyPluginPanel.tsx`(Cordis + Pi profile packages + renderer plugins)

**修复**:
- 文件:`packages/ui/openbuddy-ui-mcp/src/OpenBuddyPluginPanel.tsx`
- 改动:在 OpenBuddyPluginPanel 顶部加一行 banner:"Legacy pi plugins (x.ai/plugins) →
  [此处跳转]()" 把 PluginsPanel 内嵌;或反之,在 PluginsPanel 加 banner 指向 OpenBuddyPluginPanel
- LOC:约 +30 行

---

## 七、生产版本 Gap 分析

### 已具备(不需再做)
- pi 集成骨架(60% 完成)
- profile.piExtensions 持久化 + 自动 reload
- IPC 完整(214 个 channel,6 个文件)
- 自动化面板保留(用户硬约束达成)
- 测试覆盖 4818 通过
- electron-vite build current
- Phase I.1-I.4 已落地(marketplace → profile.piExtensions 自动同步 + UI toast)

### 需修(短期 1-2 周)
- 5 个 UI 缺口(§六)
- 4 个双轨收敛(permission/goal/session/fs,§四)
- pi-package-installed.ts `plugins/<name>` 路径探测(R-X1)

### 需补(中期 1-2 月)
- Stage F 拆分 agent-host.ts 6708 → ~500 LOC(已规划,Stage F-1 待执行)
- 视觉重设计(待用户单独授权)
- 真实安装 pi-goal-list-loop-audit 端到端验证(待用户授权,Task #80)

### 需重决策(长期)
- 工作台 sidebar 整合(plugins/automation/sessions 三块融一个面板?)
- pi-dev 包 vs OpenBuddy 包的市场定位(只跟 pi 兼容,还是 OpenBuddy 自己也是 pi?)
- 跨平台 Windows/Linux 验证(目前 mac only)

---

## 八、改造执行顺序(下一步)

按"风险最小、收益最大"排序:

| # | 阶段 | 内容 | LOC | 预计验证 |
|---|---|---|---|---|
| 1 | **UX-1** | Marketplace 卡片 pi-priority 徽章 | +40 | vitest + 手测 marketplace |
| 2 | **UX-2** | AutomationPanel 死链修复 | +20 | vitest + 手测 automation |
| 3 | **UX-3** | OpenBuddyPluginPanel banner 合并 PluginsPanel | +30 | 手测 settings |
| 4 | **P-1** | openbuddy-permission 加 `passthroughCapability: "permission"` + 删 Cordis mount | -200 | vitest + diag |
| 5 | **P-2** | openbuddy-goal 同样收敛 | -400 | vitest + diag |
| 6 | **P-3** | openbuddy-session / fs 收敛 | -850 | vitest + diag |
| 7 | **R-X1** | `isPiPackageInstalled` 增加 `<agentRoot>/plugins/<name>` 路径探测 | +30 | 新单测 |
| 8 | **F-1** | Stage F 第一步:state/pagination/registry 抽出 | -208 | tsc + vitest + diag |
| 9 | **UX-4** | CalendarPanel 只读 shell | +150 | 手测 |
| 10 | **UX-5** | Composer `/` 工具选取器 | +200 | 手测 chat |

**前置依赖**:
- UX-1 依赖 Phase I.1(已落地)→ profile.piExtensions 有数据
- P-1/P-2/P-3 依赖 R-X1 修完(否则双轨收敛后功能回退)
- F-1 独立可并行

**用户硬约束验证**:
- 不主动 commit:每步停 diff review
- 中文说明:本文档 + 所有 commit message
- 真实执行 electron 验证:每步跑 `node scripts/electron/agent-workbench-diag.mjs`
- 回归所有测试:每步跑 `vitest run`(4818+ 用例)
- 真实启动 openbuddy 分析问题:UX-3/UX-4 阶段人工跑 30 分钟
- 真实将 ui 功能接入 pi 插件生态:UX-1/UX-5 是核心
- 保留auto:UX-2 是 auto 面板修复

---

## 九、与既有规划的关系

| 既有 plan | 关系 |
|---|---|
| Stage F 拆分 agent-host.ts | **并行推进**(F-1/F-2/F-3/F-4/F-5 不冲突) |
| Phase I.1-I.4 pi-priority | **已完成**(在 docs/PI-PRIORITY.md 中) |
| Task #80 真实安装 pi-goal-list-loop-audit | **R-X1 修完后**可重启 |
| Task #84 真实启动 electron 验证 UI | **UX-3/UX-4 阶段**启动 |

---

## 十、不在本路线图范围

- 视觉重设计(等用户单独授权)
- 新增 pi 扩展依赖(只复用已审计的 pi 包)
- pi-goal-list-loop-audit 真装(等 R-X1 + P-2 完成后重启 Task #80)
- 跨平台 Win/Linux 验证(mac only 当前)
- Stage C-3 / G-1d 重做(已结案)
- 商业版(Casdoor 企业版、计费)改造

---

## 附录 A:核心文件清单(待改)

| 文件 | 改动 | 阶段 |
|---|---|---|
| `electron/main/agent/agent-host.ts` | 收敛 3 个 Cordis mount | P-1/P-2/P-3 |
| `packages/bundle/openbuddy-base/src/capability-plugins.ts` | 加 4 个 `passthroughCapability` flag + 删 4 mount | P-1/P-2/P-3 |
| `electron/main/agent/pi-package-installed.ts` | 加 `plugins/<name>` 路径探测 | R-X1 |
| `electron/main/agent/host-modules/*` | Stage F 拆分产物 | F-1 ~ F-5 |
| `packages/ui/openbuddy-ui-mcp/src/MarketplacePanel.tsx` | +40 行 PiPriorityChip | UX-1 |
| `packages/ui/openbuddy-ui-mcp/src/OpenBuddyPluginPanel.tsx` | +30 行 banner | UX-3 |
| `packages/ui/openbuddy-ui-automation/src/AutomationPanel.tsx` | +20 行 死链修复 | UX-2 |
| `packages/ui/openbuddy-ui-calendar/src/CalendarPanel.tsx` | 新建 +150 行 | UX-4 |
| `packages/ui/openbuddy-ui-chat/src/Composer.tsx` | +200 行 ToolPickerPopover | UX-5 |

---

**待用户审阅后,按 §八 顺序执行。不主动 commit。**
