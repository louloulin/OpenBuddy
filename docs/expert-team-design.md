# OpenBuddy 专家团设计与 WorkBuddy 对标

> 状态：v1，2026-08-29，Comet change `expert-team-workbuddy-analysis`。
> 范围：OpenBuddy 当前 `experts-panel`（专家 / 技能 / 连接器）、`@openbuddy/team-team`、`@openbuddy/team-subagent`、`agents/*.md` prompt 协议、`featuredScenes.json` 与 `WORKBUDDY_UI_REFERENCE.md` 的可观察对标；同时包含本地 WorkBuddy 导入 service、IPC 和导入预览 UI。云端能力、凭据和授权迁移不在范围内。
> 关联文档：`docs/workbuddy-parity-matrix.md`、`docs/openbuddy-plugin-architecture.md`、`docs/pi-core-capabilities.md`、`WORKBUDDY_UI_REFERENCE.md`。

## 1. 当前实现概览

### 1.1 顶层入口：ExpertsPanel（专家·技能·连接器一体化市场）

入口组件在 `src/components/experts-panel/index.tsx`（30 行）。它把三个 tab 收口到同一个壳层，统一一个 dark pill 头 `src/components/experts-panel/MarketHeader.tsx`，分别渲染：

| 组件真实路径 | 行数 | 关键 props / state | 主要职责 | WorkBuddy 对应 |
| --- | ---: | --- | --- | --- |
| `src/components/experts-panel/index.tsx` | 30 | `onGoHome`、`onToast`；`tab: MarketTab` | 专家 / 技能 / 连接器 tab 壳层和 `MarketPills` | `wb-market` / `headerLeft` |
| `src/components/experts-panel/experts/ExpertsTab.tsx` | 516 | `pills`、`onGoHome`、`onToast`；`view`、`listTab`、`sort`、`cat`、`search`、`modalExpert`、`catalog`、`locals` | 中心市场、我的专家、精选场景、搜索/排序、召唤、创建专家 | Expert Center / `conversation-list` 的发现入口 |
| `src/components/experts-panel/experts/ExpertCard.tsx` | 62 | `expert`、`onClick`、`onSummon`；无持久 state | 头像、职业、ribbon、描述、tags 和悬浮召唤按钮 | Expert card / Team card |
| `src/components/experts-panel/experts/ExpertDetailModal.tsx` | 113 | `expert`、`root`、`onClose`、`onSummon`；prompt loading state/ref | 能力详情、quick prompts、头像和召唤确认 | `TeamDetailModal` |
| `src/components/experts-panel/experts/FeaturedScenes.tsx` | 113 | `scenes`、`expertById`、`onSelect`；banner `src/broken` state | 横向精选场景和 banner 回退 | `SceneTabs` / `PracticeCases` 的局部实现 |
| `src/components/experts-panel/skills/SkillsTab.tsx` | 337 | `pills`、`onToast`；`view`、`cat`、`search`、`modalSkill`、`locals` | SkillHub、推荐 skill、已安装 skill 和导入 | `skill-recommend-bar` / Skill marketplace |
| `src/components/experts-panel/connectors/ConnectorsTab.tsx` | 599 | `pills`、`onToast`；`catalog`、`search`、`cat`、授权/编辑 modal state | MCP connector 目录、配置编辑、CLI/OAuth/QR 授权 | Connector marketplace / connector install card |
| `src/components/SubagentPanel.tsx` | 165 | `messages`；`liveSubagents`、transcript fallback、`liveIds` | 子代理实时事件和 transcript 回退的抽屉面板 | `team-runtime` / `session:getSubagentList` |
| `src/components/TeamStatusView.tsx` | 72 | `messages`；`teams`、`stats` | 从 transcript 派生 Team 状态和统计 | `getTeamRuntime` / colleagues runtime |

专家 tab 的关键 IPC 是 `expertsDefaultRoot` / `expertsLoad` / `expertsReadAgentPrompt` / `expertsLinkAgents` / `agentsList` / `agentsSave` / `agentsDelete` / `agentsTemplate`；技能 tab 使用 `skillsList` / `skillsRemove` / `skillsToggle` / `skillsCatalogDefaultRoot` / `skillsCatalogLoad`；连接器 tab 使用 `connectorsDefaultRoot` / `connectorsLoad` / `connectorsReadMcpConfig` / `connectorsCliAuth*` / `mcpAuth*`。

每个 tab 都把 `pills` 透传到自己的 `um-topbar-left` 槽位，与 WorkBuddy `wb-market` 的 `headerLeft` 同构（见 `WORKBUDDY_UI_REFERENCE.md` §4.1）。

### 1.2 专家数据模型与展示

`src/lib/types.ts`（888–940 行）定义 `ExpertItem`：

| 字段 | 用途 | WorkBuddy 对应 |
| --- | --- | --- |
| `id` / `cat` / `name` / `nameEn` | 标识与类目 | `expertId` / `category` / `name` |
| `title` / `titleEn` | 职称（粗体卡标题） | `profession` |
| `desc` / `tags[]` | 描述与擅长领域 chip | `description` / `tags` |
| `type: "agent" \| "team"` | 区分单专家 / 团队；team 卡显示 `author` 副标题 | `colleagues-panel` 多成员概念 |
| `author?` / `ribbon?` / `init?` | 作者归属 / 「特邀专家」角标 / 默认开场 prompt | author badge / featured ribbon / greeting |
| `opc?` / `pos?` / `updated?` | 「OPC 一人公司」类目归并、置顶排序、最近更新 | "OPC" 类目 / displayPosition / recent |
| `avatarLocal?` / `avatarUrl?` | 头像本地 + COS 兜底（与 `expertsThumbnail` / `expertsImageBytes` 协同） | avatar (local + remote) |
| `plugin?` / `agentName?` / `quickPrompts[]` | 用于 `expertsReadAgentPrompt` + 「试试这样问我」按钮 | skill-shortcut / starter prompts |

`ExpertCard`（62 行）按 WorkBuddy 截图 1 实现：方头像、职称、可选 ribbon、author 副标题、2 行描述、≤3 个 tag chip、悬浮召唤按钮。`ExpertDetailModal`（113 行）扩展为头像 + 职称 + 类目、能力介绍、擅长领域、快速 prompt 与底部「召唤 XXX」按钮，对齐 WorkBuddy `TeamDetailModal`。

### 1.3 「召唤」与团队成员链接

`ExpertsTab.handleSummonFromModal`（213–270 行）实现专家召唤全链路：

1. 调用 `expertsReadAgentPrompt(root, plugin, agentName)` 读取 `agents/<agentName>.md`，剥离 frontmatter 取正文；
2. 若 `type === "team"`，先 `await expertsLinkAgents(root, plugin)`，把团队成员的 agent 文件软链接到 `~/.pi/agents/`，让 Pi `Task` 工具按短名派生（**关键**：必须 await；pi 在 session start 扫描 `~/.pi/agents/`，未完成则子代理不可发现）；
3. 写入 `usePendingExpertStore`（`src/stores/pending-expert-store.ts`，59 行），跳转 home；
4. 后续对话里 Pi session 启动时按 expert 名走 `pi_set_session_expert`，把 persona 持久化到 session metadata（`electron/main/agent-host.ts:3162` 的 `setSessionExpert`）。

### 1.4 精选场景（FeaturedScenes）

- 本地兜底在 `data/featured-scenes.ts`：9 个场景（内容创作 / 投资分析 / 法律咨询 / 小微企业 / 电商运营 / 数据分析 / 专业文档 / 产品设计 / 工程开发），每场景 ≤3 名专家，配渐变 banner。
- 远程配置走 `featuredScenes.json`（`https://acc-1258344699.cos.accelerate.myqcloud.com/workbuddy/expert-marketplace/featuredScenes.json`），本地 banner 缺失时回落到主题渐变。
- `FeaturedScenes.tsx`（113 行）使用 `ScrollRow` 横向滚动行 + banner 缓存（`bannerCache` / `bannerInflight`）。

### 1.5 本机 WorkBuddy 实际配置证据

本节只记录本机可读取的配置、缓存和专家包，不把 WorkBuddy 私有后端或商业服务实现当作事实。主要证据目录为 `~/.workbuddy/plugins`、`~/.workbuddy/app/cache/experts`、`~/.workbuddy/connectors-marketplace` 和 `~/.workbuddy/.workbuddy-sqlite-migrations`。

#### 1.5.1 Expert / Team manifest 契约

WorkBuddy 内置 `skill-expert-manager` 的 `plugin-json-spec.md` 将专家包定义为“资源声明 + 运行时类型 + 展示元数据”的组合：

| 层次 | 关键字段 | 对 OpenBuddy 的启示 |
| --- | --- | --- |
| 包身份 | `name`、`version`、`description`、`author` | Expert 不应只有 UI 卡片，必须有可升级、可追踪的包身份 |
| 资源 | `agents[]`、`skills[]` | Agent prompt 与 Skill 依赖由 manifest 一起声明，避免运行时猜路径 |
| 类型 | `expertType: agent \| team`、`agentName` | 单专家和专家团共享市场模型，但运行时入口明确区分 |
| Team 关系 | `teamInfo.leadAgent`、`teamInfo.memberAgents[]`、`members[]` | 运行时 Agent ID、展示成员和主理人关系都可被解析 |
| 展示 | `displayName`、`profession`、`displayDescription`、`avatar`、`categoryId`、`plugin` | 专家市场数据不应依赖硬编码 `ExpertItem` 列表 |
| 激活 | `defaultInitPrompt`、`quickPrompts[]`、`tags[]` | 卡片可以直接生成首轮任务和推荐问题 |

规范要求 `tags` 和 `quickPrompts` 各 3 个，且第一条 quick prompt 等于 `defaultInitPrompt`；Team 主理人必须出现在 `members[]` 且 `role: "lead"`，`teamInfo.memberAgents` 则只列成员。真实样本 `citongshuopro/plugin.json` 还展示了更有价值的模式：团队描述是“投资社群嘉宾团”，lead 是社群管理员，成员分别承担价值、趋势、短线和宏观职责，说明 Team manifest 不应退化成固定的 planner/explorer/tester 角色数组。

本机专家规范还要求 Agent ID 等于 `agents/*.md` 文件名 stem，Team 主理人文件名具有业务语义（例如 `citongshuopro-team-lead.md`），而不是通用的 `team-lead.md`。这正好可以作为 OpenBuddy 从 `role` 迁移到 `agentRef` 的命名和校验规则。

#### 1.5.2 Agent prompt 的协作协议

`agent-md-spec.md` 对 Team 成员 prompt 的要求不是简单 persona：必须包含角色定义、3–5 个具体能力、分析框架、数据获取方式、结构化输出模板和 `SendMessage` 回传要求。主理人 prompt 则要求显式执行 `TeamCreate → 调度成员 → 成员回传 → 汇总`，并禁止主理人代写成员产出、成员互相直连或跳过 TeamCreate。

这与 Pi 的 `AgentSession` / `ExtensionAPI` 可以直接对接：主理人作为根 session 的专家 persona，成员作为隔离的 `AgentSession`；`SendMessage` 可映射到 Team service 的 mailbox API，成员完成事件映射为 `subagent/end` + `team/member-updated`。因此，OpenBuddy 下一步应把成员 prompt 作为运行时契约校验，而不只是 `expertsReadAgentPrompt` 读取出的长文本。

#### 1.5.3 场景不是 banner，而是路由配置

本机 `cb_teams_marketplace/scenes.json` 共 23 个场景，`unified_id` 大致覆盖 100–122，按 `working`、`coding`、`design` 三种 mode 组织。每个场景包含 `name`、`icon`、`plugins[]`、3–6 个示例 `prompts[]`、`promptTitles[]` 和 `target`；插件项又包含 `name` 与 `marketplaceName`。

例如“金融服务”会路由到 `financial-analysis`、`investment-banking`、`equity-research`、`private-equity`、`wealth-management`、`lseg`、`spglobal`；“数据分析及可视化”会组合 `data` 和 `sheetagent`；“文档处理”会选择 `tencent-docx`。这表明场景是“意图 → 插件/技能 → 示例 prompt → 执行模式”的配置层，而不是 OpenBuddy 当前 9 个 `FeaturedScenes` banner 的静态展示层。

#### 1.5.4 专家、技能、连接器和缓存分层

WorkBuddy 本机目录可以抽象为四层：

```text
~/.workbuddy/
├── plugins/cache/                 # 内置插件与版本化 skill/plugin 包
├── plugins/marketplaces/          # marketplace 专家包、Team manifest、agents、skills、avatars
├── connectors-marketplace/        # 每个 connector 独立的 MCP、skill、token schema、CLI 配置
├── app/cache/experts/             # manifest.json、metadata.json、version.txt 等可重建缓存
├── experts/custom/                # 用户已选择/自定义专家索引
├── extensions/                    # 扩展注册索引
└── .workbuddy-sqlite-migrations/  # session 与专家选择的持久化 schema 变更
```

`app/cache/experts/metadata.json` 使用 `version`、`cachedAt`、`sourceSignature`、`manifestHash`、`cacheFormatVersion` 描述缓存；`version.txt` 当前为 `1.0.0`。这为 OpenBuddy 的 marketplace adapter 提供了最低契约：读取远程 manifest 时必须保留来源签名、版本和 hash，并在缓存不可用时区分“没有安装”和“缓存过期”。不要读取或复制 credentials、master key、token、trace/session 等敏感文件。

#### 1.5.5 意图推荐和激活流程

WorkBuddy 内置 `skill-recommend-experts` 的公开流程是：会话尚未选择 Expert 时，以用户意图调用 `search_plugins(type="expert")`，最多保留 3 个 Agent/Team 候选，再调用一次 `suggest_plugin_install` 渲染卡片；用户只能启用一个专家或专家团，已有 Expert、无结果、跳过或超时都不能重复推荐。`skill-recommend-connectors` 使用同样的流程，但 `type="connector"`，并明确禁止自动安装或授权。

因此两者的产品差异是：OpenBuddy 当前是“打开市场 → 浏览卡片 → 点击召唤”，WorkBuddy 是“识别任务意图 → 搜索候选 → 用户确认卡片 → 激活 Expert/Connector”。对 OpenBuddy 而言，推荐层应只负责候选和确认，不能静默修改当前 session；真正激活仍沿用现有 `pending-expert-store` → `pi_set_session_expert` 链路。

#### 1.5.6 Welcome mode 与会话选择持久化

`welcomemode-work/code/design` 的 `settings.json` 以 `agent` 选择模式，`prompt.tpl` 按 `workMode` 注入 ask、plan、expert、craft interaction fragment，并在 work mode 中明确暴露“100+ domain experts”和左侧 Experts 入口。SQLite migration `0002_last_user_prompt_expert_selection.sql` 为 sessions 增加 `last_user_prompt_expert_selection` 字段，说明“用户最近一次提示触发的专家选择”是独立的会话数据，而不是只存在 UI 临时状态。

### 1.6 本机 WorkBuddy 对标项目的 Team 架构参考

`/Users/louloulin/lumosaiup/docs/architecture/agent-team.md` 是同一用户工作区中的 WorkBuddy-like 设计参考，不等同于 WorkBuddy 官方源码；它适合用来补全 OpenBuddy 当前 runtime 的工程边界：Team 是可暂停、恢复、解散的协调层，成员是具名且可复用的 session，任务用 Kanban 管理，消息通过 mailbox 双向传递。

建议的数据和事件模型如下：

| 对象 | 最小字段 / 状态 | Pi 对接 |
| --- | --- | --- |
| Team | `team_id`、lead session、`active/paused/dissolved`、config | `ExtensionAPI` service + 持久化 store |
| Member | `agent_id`、`role`、`run_id`、`session_id`、`idle/working/completed/error/killed` | `AgentSession` + `subagent/start|end` |
| Message | from/to member、content、message type、timestamp | `SUBAGENT_MAILBOX` 或 Team extension tool |
| Task | owner、priority、blocked_by、`backlog/todo/doing/review/done` | Team tool + 事件总线 |
| Event | created、member_joined、member_status、message、task_updated、paused/resumed | `ctx.emit` → Electron IPC → Zustand |

这比当前 OpenBuddy 的 `Promise.all(runMember)` 更接近 WorkBuddy 的可观察 Team：并发只是执行策略，Team 本身还需要生命周期、消息、任务、恢复和 orphan cleanup。实现时可继续复用 Pi 的 `ExtensionAPI` 注册工具、`AgentSession` 隔离上下文、`SessionManager` 持久化 session，以及 `subagent/start` / `subagent/end` hook；建议引入 `skip_parent_injection` 等价语义，避免成员重复继承根 session 的无关上下文。

### 1.7 Pi 生态：team runtime

> 入口：`@openbuddy/team-team`（`packages/team/openbuddy-team/src/index.ts`，206 行）。
> 协议：Pi `ExtensionAPI`（`packages/team/openbuddy-team/src/pi.ts`，77 行）。
> 触发：LLM 在 `AgentSession` 循环内调用 `team_create` / `team_status` / `team_delete` 工具。
> 持久化：`~/.pi/agent/openbuddy-teams.json`，`0o600` 原子写（tmp + rename）。

#### 1.7.1 Service API 表面

| 方法 | 签名 | 持久化 | ctx 事件 |
| --- | --- | --- | --- |
| `Team.create(goal, size)` | `size ∈ {"small","medium","large"}` → 2/4/8 个 member，role 取自 `["planner","explorer","implementer","reviewer","tester"]` | 写 `openbuddy-teams.json` | `team/created { id, memberCount }` |
| `Team.execute(team)` (private) | 通过 `ctx.get("teamRunner")` 拿到 `TeamRunner`，对每个 member 调 `runMember`，`Promise.all` 并发，`AbortController` 中止 | 同上 | `team/member-updated` × N，`team/finished { id, cancelled }` |
| `Team.status(teamId)` | 读 json | — | — |
| `Team.deleteTeam(teamId)` | 标 `deleted` + 中止 controller | 同上 | `team/deleted { id }` |

`Team` 继承 `OpenBuddyService`；`ctx.effect` 注册 cleanup：触发 `team/cleanup` 并中止所有 `activeRuns`（`index.ts:94–98`）。

#### 1.7.2 Pi 协议面（`pi.ts`）

注册 3 个工具：

| 工具名 | 参数 | 返回 | 备注 |
| --- | --- | --- | --- |
| `team_create` | `{ goal: string, size?: "small" \| "medium" \| "large" }` | `{ ok, teamId, members: number }` | LLM 首选入口；默认 `medium` |
| `team_status` | `{ teamId: string }` | `{ ok, status, members: [{id,role,status,output≤500}] }` | 输出截断 500 字符 |
| `team_delete` | `{ teamId: string }` | `{ ok }` | 软删（status=deleted） |

#### 1.7.3 团队成员运行（`electron/main/agent-host.ts:2303–2400` 的 `createTeamRunner.runMember`）

`runMember(input, signal)` 实现：

1. 解析 member 模型（可选覆盖 `provider/model`，否则用当前 session 模型）；
2. 调用 `createAgentSession({ cwd, agentDir: piHome(), model, sessionManager: SessionManager.inMemory(), noTools: "all", customTools })`；
3. **`noTools: "all"`**：内置工具全部禁用，成员不能递归编辑文件 / shell / 派生团队（递归保护）；其他 Cordis 管理的工具（如 `team_status` / `team_delete`）通过 `customTools` 转发，DSH 兼容工具同样可达；
4. 通过 `state.toolRegistry.list().map(createTaskAwareTool)` 注入任务感知的工具；
5. `emitPluginEvent("subagent/start", childPayload)` → `runHookPoint("agent/start", ...)` → `session.prompt(...)` → `emitPluginEvent("subagent/end")`；
6. 监听 `AbortSignal`：取消即 `session.abort()`；
7. 通过 `session.subscribe` 收 `message_update.text_delta`，拼接为返回 output；
8. 子 session 用 `SessionManager.inMemory()`，**与根 session 不共享 transcript**（团队任务隔离）。

注意：`pi.ts:19` 注释说 `team_create`，实际注册名也是 `team_create`；但 `src/lib/team-derive.ts:60` 同时识别 `create_team` / `openbuddy__create_team`（历史 MCP 命名兼容）。`src/lib/__tests__/tool-renderers.test.ts:33–35` 把渲染器 key 固定为 `team-create` / `team-delete` / `team-status`。

### 1.8 Pi 生态：subagent 配置

> 入口：`@openbuddy/team-subagent`（`packages/team/openbuddy-subagent/src/index.ts`，96 行）。
> 存储：`~/.pi/agent/settings.json` 的 `subagents` 子键；DEFAULTS `{ maxDepth: 2, maxParallel: 4, enabled: true }`。

| 方法 | 签名 | 备注 |
| --- | --- | --- |
| `Subagent.getConfig()` | `→ SubagentsConfig` | merge DEFAULTS 兜底 |
| `Subagent.setConfig(patch)` | `Partial<SubagentsConfig>` → 写 settings.json + emit `subagent/config-set` | 原子写（tmp + rename） |

**递归保护实现**：成员 session 里 `create_team` 工具被剥掉（见 `agent-host.ts:2317–2324` 注释「Built-in tools stay disabled」）；`maxDepth` / `maxParallel` 是产品配置，尚未在 `runMember` 里做硬拦截，目前依赖工具剥离。

### 1.9 会话内视图

- **`SubagentPanel.tsx`（165 行）**：右上角抽屉，主数据源是 `useSubagentStore` 的实时 `pi://subagent` 事件（`stores/subagent-store.ts`），`deriveSubagents`（`src/lib/subagents.ts`，150 行）作为 transcript 回退；统计 running / completed / failed。`stops` 上挂在 `subagent/start` 与 `subagent/end`（见 `agent-host.ts:2354` / `2393`）。
- **`TeamStatusView.tsx`（69 行）**：右上角第二个抽屉，纯 transcript 派生（`deriveTeams`，`src/lib/team-derive.ts`，104 行）；识别 `create_team` / `team_create` / `openbuddy__create_team` 三种历史命名；`isCreateTeamTool` 还检查 `rawInput` 是否含 `team_id` + `members`。
- 两者与 WorkBuddy `team-runtime` / `getTeamRuntime` 对齐（注释里已点名）。

### 1.10 IPC 与持久化总览

| 层 | 路径 |
| --- | --- |
| Renderer API | `src/lib/agent/pi-client.ts:904–938`：`expertsDefaultRoot` / `expertsListRoots` / `expertsLoad` / `expertsThumbnail` / `expertsImageBytes` / `expertsReadAgentPrompt` / `expertsLinkAgents` |
| Preload allowlist | `electron/preload/index.ts:27`：`experts_default_root`、`experts_load`、`experts_thumbnail`、`experts_image_bytes`、`experts_read_agent_prompt`、`experts_link_agents`、`pi_set_session_expert`、`pi_clear_session_expert` |
| Main handler | `electron/main/ipc/index.ts:1255–1278`：把 IPC 路由到 `resources.expertDefaultRoot/getCwd/expertReadAgentPrompt/expertLinkAgents`，边界由 `agent-host.ts` 提供 |
| Expert metadata | `electron/main/agent-host.ts:3039–3170`：session metadata 的 `experts: Record<sessionId, { expertId, expertName, avatarLocal? }>`，`setSessionExpert` 写 |
| Team persistence | `packages/team/openbuddy-team/src/index.ts:60–80`：`openbuddy-teams.json`，`0o600` 原子写 |
| Subagent config | `packages/team/openbuddy-subagent/src/index.ts:31–55`：`~/.pi/agent/settings.json` 子键 |
| Scene remote | `data/featured-scenes.ts:30–31` 远程 COS `featuredScenes.json`（best-effort） |

## 2. WorkBuddy 对标

### 2.1 业务组件映射表

来源：`WORKBUDDY_UI_REFERENCE.md` §2.3（业务组件清单）。

| WorkBuddy 组件 | OpenBuddy 现状 | 差距 / 备注 |
| --- | --- | --- |
| `conversation-list` | `src/components/SecondarySidebar.tsx`（基于 `agentsList` 的本地专家侧栏；不完全等价于会话列表） | 部分覆盖；WorkBuddy 的「全部 / 任务 / 工作空间」分组未实现 |
| `pinned-section` | 仅 `ExpertItem.pos` 字段存在；UI 没有置顶会话按钮 | 未覆盖 |
| `chat-renderer` | `src/components/ChatView.tsx` 已有；workbuddy 的 message-timeline / 文件 / 浏览器三视图（`§4.2` + `chatview__artifacts-toggle`）已落地 | 已覆盖 |
| `colleagues-panel` | 体现在 `ExpertCard` 的 `type==="team"` 分支 + `TeamStatusView` + `SubagentPanel` | 部分覆盖；WorkBuddy 把同事面板作为独立左栏，OpenBuddy 把团队信息折叠到会话右上抽屉 |
| `automation-panel` | `src/components/AutomationPanel.tsx`（基于 `agentsList`） | 部分覆盖；UI 与 marketplace 解耦不够 |
| `knowledge-base-panel` | 未实现（WorkBuddy 引用 `_meta/_expert_center.json` 但知识库是另一概念） | 未覆盖 |
| `skill-recommend-bar` | `SkillsTab.tsx` 有，但未在首页（HomePage）以「技能推荐栏」形式常驻 | 未覆盖 |
| `scene-tabs` | `MarketPills` 在 `ExpertsPanel` 内；WorkBuddy 在 `HomePage` 用 `SceneTabs` 切场景 | 部分覆盖 |

### 2.2 设计令牌覆盖（Design Tokens）

来源：`WORKBUDDY_UI_REFERENCE.md` §3。

| Token | 现状（推断自 CSS 类名 `um-*` / `ec-*` / `wb-*`） |
| --- | --- |
| `--wb-bg-primary` … `--wb-bg-hover` | OpenBuddy CSS 体系使用 `um-bg-*` / `wb-bg-*` 双重命名（推测来源：原 WorkBuddy 设计令牌直接复制）。 |
| `--wb-border-default` … `--wb-border-focus` | `um-border-*` 同上。 |
| `--wb-color-text-primary` … `--wb-color-text-brand` | `um-color-text-*` / `wb-color-text-*` 双轨。 |
| `--wb-status-success` / `--wb-status-error` / `--wb-status-warning` | 在 `SubagentPanel` / `TeamStatusView` 中映射到 `running` / `completed` / `failed` / `cancelled` 的 CSS class（`subagent-panel__row--{status}`、`team-status-view__row--{status}`）。 |
| `--wb-radius-sm` / `--wb-radius-md` / `--wb-shadow-sm` | 已落到多数卡片 class，但缺一处统一索引（`docs/` 没有 design-token 总表）。 |

> **推测**：OpenBuddy 当前 CSS 重度依赖 WorkBuddy 原 token；如未来 WorkBuddy 改版或解耦品牌，需要一次性抽取到内部 token（`--ob-*`）。

### 2.3 推断的 WorkBuddy 设计模式（基于可观察面）

> 以下条目标注为「推测」；它们由 `WORKBUDDY_UI_REFERENCE.md` + OpenBuddy 现有代码中"对齐 WorkBuddy"的注释反推。

1. **「中心市场 + 本地」双视图**（`WORKBUDDY_UI_REFERENCE.md` §6 待完善清单中"搜索功能"补完后预期）—— OpenBuddy 在 `experts-panel/index.tsx` 已落地：顶部 pill 切换 "center / my"。WorkBuddy 推测走相同模式（`MarketHeader.tsx` 注释明示对齐 `headerLeft`）。
2. **场景驱动推荐**（`WORKBUDDY_UI_REFERENCE.md` §4.1 的 `SceneTabs` + `PracticeCases`）—— 推测每个场景 tab 内部挂一个"精选团队"卡；OpenBuddy 当前在 `ExpertsTab` 顶部用 `FeaturedScenes` 横向 scroll 实现，缺 "PracticeCases" 推荐位。
3. **「召唤」是 persona + 子代理的混合**（`stores/pending-expert-store.ts` 注释明示 "Mirrors WorkBuddy's `pendingExpertActivation` / `setPendingExpert`"）—— WorkBuddy 推测同时把 persona 写入 chat metadata，并（若 `type==="team"`）把成员 agent 注册到运行时；OpenBuddy `handleSummonFromModal` 已实现。
4. **会话内"子代理运行时" + "团队状态"分抽屉**（`SubagentPanel` + `TeamStatusView` 注释点名 "对齐 WorkBuddy `team-runtime` / `session:getSubagentList`"）—— WorkBuddy 推测使用 IPC `session:getSubagentList` / `getTeamRuntime`；OpenBuddy 用 `pi://subagent` 事件 + transcript 派生混合方案。

## 3. 差距矩阵

| # | WorkBuddy 能力（本机证据 / 对标参考） | OpenBuddy 现状 | 差距 | 建议实现 | 工作量 | 风险 |
| --- | --- | --- | --- | --- | --- | --- |
| G1 | 23 个场景配置 `mode + plugins + prompts + target`（`cb_teams_marketplace/scenes.json`） | `FeaturedScenes` 仅在 `ExpertsTab` 顶部；`HomePage` 没有场景入口 | 场景只是展示卡，没有形成插件/技能路由 | 新增 `SceneRouter`：场景匹配后解析 marketplace plugin、skill、connector 和示例 prompt；首页再接 `SceneTabs` / `PracticeCases` | M | 产品：可能稀释「最近会话」权重；技术：需处理插件未安装 |
| G2 | Welcome mode 按 `work/code/design` 注入 interaction fragment，并暴露 Experts 入口 | OpenBuddy 有 ExpertsPanel，但没有统一 mode prompt 层 | 专家发现与会话模式脱节 | 在 Pi 根 session 初始化上下文注入 mode-aware expert affordance；UI 只展示入口，不复制隐藏系统规则 | M | 产品：模式切换后一致性；技术：需避免重复注入 |
| G3 | `skill-recommend-experts` 通过 `search_plugins(type=expert)` → `suggest_plugin_install` 推荐，最多 3 个候选 | 当前是市场浏览后点击召唤 | 缺少基于用户意图的确认式激活 | 新增 `ExpertRecommendationService`，以当前 prompt 检索候选，卡片确认后复用 `pending-expert-store`；已有 Expert 时短路 | M | 产品：推荐打扰；技术：候选 ID 必须来自搜索结果 |
| G4 | `skill-recommend-connectors` 同样推荐 connector，禁止自动授权 | `ConnectorsTab` 只提供目录和授权 UI | 外部能力推荐没有和专家任务路由联动 | `SceneRouter` 输出 connector 候选，但安装/授权始终由用户卡片触发 | M | 产品：授权信任；技术：不能把 token 注入 Team prompt |
| G5 | `pinned-section` / conversation list（UI 参考） | `ExpertItem.pos` 字段存在但 UI 不暴露；session 层无 pinned metadata | 没有"工作集"概念 | 在 `SecondarySidebar` 增加置顶按钮，写 `session-store.pinned: Set<sessionId>`；渲染时按 `pinned + recent` 排序 | M | 产品：用户教育；技术：跨设备同步不在本 change |
| G6 | WorkBuddy-style 同事面板（独立左栏） | 团队信息折叠在 `TeamStatusView` 右抽屉 | 团队可发现性弱 | 把 `TeamStatusView` 提升为左侧 `ColleaguesPanel`（在 `ExpertsPanel` 之外），与 conversation list 同级 | L | 产品：占据侧栏空间；技术：会话外渲染需要新的非 chat 数据源（`agentsList` 全量 + manifest `type==="team"`） |
| G7 | Team 成员使用业务 Agent ID，prompt 强制 `SendMessage` 回传 | 当前 `TeamMember.role` 取自固定 5 元组，成员没有 manifest/prompt 绑定 | 角色不能映射到已有专家；成员返回协议不受校验 | `TeamMember` 增加 `agentRef`、`promptHash`、`goal`；启动前校验 Agent ID 与 prompt 必备章节，运行时将回传映射到 mailbox | L | 技术：需兼容 v1 `role`-only 团队；产品：UI 要展示成员头像 |
| G8 | Team 工具调用进度（live） | `TeamStatusView` 仅 transcript 派生，无 live 状态 | 用户看不到成员实时进度 | 将 `team/member-updated` 经 IPC 推送到 renderer，Team store 消费事件并展示运行中/完成/失败 | M | 技术：需要新增 `team/event` channel + Zustand store |
| G9 | `subagent.config.maxDepth` / `maxParallel` 约束 | 配置写入 `settings.json`，但运行时没有统一硬拦截 | 递归和并发上限可能形同虚设 | 在 `runMember` 入口检查 depth，在 `Team.create` 使用 semaphore 限制并发；超限返回可读工具结果 | S | 产品：截断可能影响目标完成；技术：需保证取消时释放 semaphore |
| G10 | 成员独立 session，可暂停/恢复并回看 | 团队用 `SessionManager.inMemory()`；刷新即丢 | 团队结果不可回溯，无法恢复 | `SessionManager` 使用磁盘 session，路径 `~/.pi/agent/openbuddy-teams/{teamId}/{memberId}.jsonl`；Team 状态增加 pause/resume | L | 技术：磁盘写入放大；隐私：需保留 `0o600` |
| G11 | Team preset 与 manifest 版本 / cache hash | 无 preset；`expertsLoad` 返回 root 但无版本 | 不能复用团队，升级和失效提示缺失 | 增加 `teamPresets`、`version`、`manifestHash`、`minOpenBuddyVersion`；升级前校验兼容矩阵 | M | 产品：模板治理；技术：旧 manifest 兼容 |
| G12 | Team ↔ expert 双向导航、Colleagues 面板 | `ExpertCard` 不区分 team / agent 详情页，团队状态在右抽屉 | 用户看不到团队成员身份与历史 | Team modal 展示 manifest `members[]`，成员点击进入 expert detail；P5 再提升为左栏 | M | 产品：侧栏占用空间；技术：需支持未知/已卸载成员 |
| G13 | Design token 统一索引 | 双轨命名 `um-*` / `wb-*` | 品牌解耦困难 | `docs/design-tokens.md` 列 token、CSS var、出现 class，未来迁移到 `--ob-*` | S | 产品：纯文档 |
| G14 | 专家 / 技能 / connector marketplace 分层缓存 | OpenBuddy 有本地 catalog 和远程 COS 兜底，但无统一 `sourceSignature/hash/cacheFormatVersion` | 弱网、升级、失效状态不可解释 | 新增 `MarketplaceCache`：manifest、metadata、version 三件套；connector 与 expert 分开缓存，敏感凭据不进入 cache | M | 技术：缓存迁移；安全：禁止缓存 token |

## 4. 改进建议（按优先级排序）

> 优先级 = 用户可见价值 × 实现成本倒数。条目 ≥5；每条含触发条件、依赖项、回滚策略。

### P1：团队成员语义化 + 实时进度（G5 + G6 合并）

- **触发**：用户反馈"团队创建了但看不到谁在跑什么"。
- **依赖**：G5 改 `TeamMemberInput`；G6 新增 IPC channel `team/event`（zustand store + `useEffect` 订阅）。
- **回滚**：`teamToolsHandlers` 保留 `role`-only fallback；新 IPC 仅在 `feature.teamLiveProgress = true` 时启用。
- **工作量**：L（跨 Main / Preload / Renderer 三层）；分两步：① 实时事件通路；② 成员 agent 绑定。

### P2：Subagent 配置硬拦截（G7 + G8 合并）

- **触发**：LLM 误用 `team_create` 递归造成资源风暴。
- **依赖**：`Subagent.getConfig()`（已存在）；`Team.create` 入口读取。
- **回滚**：settings.json 改回旧值即失效。
- **工作量**：S；建议先做（最低成本，最高防御价值）。

### P3：场景化首页与技能推荐栏（G1 + G2 合并）

- **触发**：市场发现效率提升（产品定位）。
- **依赖**：`FeaturedScenes` 已就位；`SKILL_LIST` `featured` 子集已存在。
- **回滚**：`HomePage` 加 feature flag `home.v2.scenes`；关闭则回到当前 home。
- **工作量**：M；先做静态展示，再接个性化（基于最近召唤的 expert 排序）。

### P4：团队回看与 preset（G9 + G10 合并）

- **触发**：用户复盘 / 复用常用团队。
- **依赖**：P1 完成后 session 持久化已就位。
- **回滚**：preset 仅在 manifest 显式启用；磁盘持久化受 feature flag `team.persistChildren` 控制。
- **工作量**：L。

### P5：同事面板提升为左栏 + WorkBuddy 风格精修（G4 + G13）

- **触发**：与 WorkBuddy 视觉一致；强化"团队是 OpenBuddy 卖点"的认知。
- **依赖**：P1 完成（成员头像 / 角色可渲染）；design-token 总表（G13）。
- **回滚**：`experts-panel/colleagues-panel/index.tsx` 作为新模块；旧 `TeamStatusView` 不删除，通过 `team.view=colleagues` 配置切换。
- **工作量**：L；品牌敏感，需设计参与。

### 4.1 推荐的 Pi 落地顺序

不要先复制 WorkBuddy 的 UI；应先把 Expert manifest、场景路由和 Team runtime 接成一条可验证的 Pi 链路：

```text
用户 prompt
  → SceneRouter / ExpertRecommendationService
  → search_plugins(type=expert|connector) 的候选结果
  → 用户确认卡片
  → pending-expert-store
  → pi_set_session_expert
  → ExtensionAPI 注册的 team_create / team_status
  → AgentSession（lead）
  → AgentSession（具名 member，prompt + agentRef）
  → subagent/start|end + team/member-updated
  → mailbox / task board / IPC event
  → TeamStatusView / ColleaguesPanel
```

实现边界建议如下：

1. **Manifest Adapter（P0）**：定义 OpenBuddy 内部 `ExpertManifest`，兼容 `agent` / `team`、`teamInfo`、`members`、`skills`、版本和 hash；保留旧 `ExpertItem` 转换器，避免一次性改 UI。
2. **Scene Router（P1）**：把 `FeaturedScenes` 升级为配置驱动的场景索引；解析插件是否已安装，未安装时只返回用户确认卡片，不直接改 session。
3. **Recommendation Extension（P1）**：在根 `AgentSession` 的 prompt 生命周期中提供推荐能力；遵守“已有 Expert 不推荐、最多 3 个候选、只能启用一个”的规则，候选 ID 不允许由模型自行构造。
4. **Team Coordinator（P1）**：在现有 `@openbuddy/team-team` 之上增加 `agentRef`、生命周期状态、事件总线、mailbox 和取消语义；保留 `role` fallback 兼容旧 `team_create` 调用。
5. **Persistent Member Session（P2）**：从 `SessionManager.inMemory()` 迁移到按 `teamId/memberId` 隔离的持久化 session，提供恢复、回看和 orphan cleanup；敏感内容继续遵循 Pi session 权限策略。
6. **Task Board / Colleagues UI（P3）**：最后再引入 Kanban、消息流、暂停/恢复和左侧同事面板；UI 只消费 Team event，不从 transcript 反推唯一真相。

关键设计原则：`ExtensionAPI` 负责协议和工具注册，`AgentSession` 负责每个角色的上下文隔离，`SessionManager` 负责可回看的生命周期，Electron IPC 只负责跨进程传递已脱敏事件，Zustand 负责渲染态；不要让 renderer 直接读取 Pi session 文件，也不要把 connector token 放入 manifest、缓存或 prompt。

## 5. 风险与限制

### 5.1 WorkBuddy 私有能力限制

以下条目一律列入"非目标"，本 change 不推断其实现细节：

- WorkBuddy 私有云同步（专家 / 技能 / 连接器云端共享）；
- WorkBuddy 商业账号 / SSO / OAuth；
- WorkBuddy Marketplace 商业交易（付费专家 / 付费 skill）；
- WorkBuddy 私有 prompt 后台 / 模型路由；
- 截图来源：仓库内仅 `WORKBUDDY_UI_REFERENCE.md` 一份文本，无视觉稿；表格 §2.3 的"推测"均基于代码注释里的"对齐 WorkBuddy"措辞与 `WORKBUDDY_UI_REFERENCE.md` 文字。

### 5.2 技术风险

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| `expertsLinkAgents` 必须 await，UI 没做兜底 | 团队首轮对话子代理不可发现 | 当前实现已是 await；新增测试覆盖（`packages/team/openbuddy-team/src/index.test.ts` 已覆盖 happy path） |
| `noTools: "all"` 关闭全部内置工具，成员不能 shell / 编辑 | 团队任务只能产出文本结果 | 在 P1 引入 `schema` 时提供「返回 JSON 结构」选项（`schemaInstruction` 已就位） |
| `SessionManager.inMemory()` 导致团队子 session 刷新即失 | 用户无法回看 | P4 通过 `team.persistChildren` 落地 |
| `featuredScenes.json` 远程依赖 COS，弱网场景降级 | 用户只看到 9 个本地兜底场景 | 当前实现已有本地 `FEATURED_SCENES` 兜底（`data/featured-scenes.ts`） |
| `subagent.config.maxDepth` 未硬拦截 | 配置形同虚设 | P2 修复 |

### 5.3 产品 / 文档风险

- 文档未脱敏：本 change 引用大量代码路径与行号；若代码迁移，行号需同步刷新。建议在 `docs/expert-team-design.md` 加 `<!-- code-refs: 2026-08-29 -->` 时间戳注释，下次重大重构后更新。
- WorkBuddy 视觉稿未对齐：本 change 不产出视觉产物；任何品牌调整需设计参与。

## 6. WorkBuddy 专家团迁移设计

### 6.1 迁移目标和事实边界

迁移目标不是把 WorkBuddy 的私有运行时复制到 OpenBuddy，而是把本机可观察的专家包资源转换为 OpenBuddy/Pi 可消费的 manifest、Agent prompt、Skill 依赖和展示元数据。导入后仍由 OpenBuddy 的 Pi `AgentSession`、`ExtensionAPI` 和 Electron IPC 执行。

本机证据源与读取策略如下：

| WorkBuddy 路径 | 读取内容 | OpenBuddy 导入结果 | 明确不读取 |
| --- | --- | --- | --- |
| `~/.workbuddy/plugins/marketplaces/*/plugins/*/plugin.json` | 包身份、版本、`expertType`、Team 关系、展示字段、资源相对路径 | `ExpertManifest`、Team 成员图、版本/hash | 作者邮箱之外的账号身份信息 |
| `.../agents/*.md` | frontmatter、角色能力、SOP、输出规范、`SendMessage` 协议 | `AgentDefinition`、lead/member prompt | prompt 中偶然出现的密钥或私有上下文 |
| `.../skills/*/SKILL.md` | Skill 名称、描述、脚本相对路径、输入输出约束 | Skill dependency descriptor；脚本进入隔离 staging | 运行脚本产生的 token、缓存和会话数据 |
| `.../avatars/*` | 相对资源路径和可选图片 | 本地头像资产或安全的占位头像 | EXIF、用户目录路径和远端私有 URL |
| `cb_teams_marketplace/scenes.json` | scene、mode、plugin 名、marketplace 名、示例 prompt | `SceneIndex` 与插件推荐关系 | 未公开的服务端路由逻辑 |
| `skill-recommend-experts/connectors` | `search_plugins`、候选上限、用户确认和禁止自动安装规则 | Recommendation policy descriptor | 私有推荐模型、账号状态、授权结果 |
| `app/cache/experts/{metadata,version}.json` | `version`、`cachedAt`、`sourceSignature`、`manifestHash`、cache format | `MarketplaceCacheMetadata` | cache 中的用户内容和任何凭据 |
| `experts/custom/*/experts.json` | 已选择专家的 ID 索引 | 可选的“已选专家”提示，仅供用户确认 | 自动切换当前 session 的行为 |
| `.workbuddy-sqlite-migrations/*.sql` | schema 变更名称和字段语义 | 设计 OpenBuddy session metadata 对应字段 | 真实数据库内容、历史 prompt 文本 |
| `.mcp.json`、connector 目录 | 仅键名、connector ID、配置 schema 形状 | connector descriptor，进入“待用户授权”状态 | token、OAuth session、密钥、私有 endpoint |

### 6.2 内部迁移模型

OpenBuddy 不应直接把 WorkBuddy `plugin.json` 当作 UI 类型；建议先归一化为版本化内部模型，再由 adapter 转换成现有 `ExpertItem`：

```ts
type ExpertManifest = {
  schemaVersion: 1;
  source: "workbuddy" | "openbuddy";
  pluginId: string;
  version: string;
  expertType: "agent" | "team";
  leadAgentId: string;
  agents: AgentDefinition[];
  skills: SkillDependency[];
  assets: AssetRef[];
  scenes: SceneRef[];
  display: ExpertDisplay;
  integrity: { manifestHash: string; sourceSignature?: string };
};
```

字段映射：

| WorkBuddy | 内部模型 | 现有 OpenBuddy / Pi 目标 |
| --- | --- | --- |
| `name` | `pluginId` | `ExpertItem.plugin`、安装目录和冲突主键 |
| `version` | `version` | marketplace cache、升级检查和 Team preset 兼容矩阵 |
| `expertType` | `expertType` | `ExpertItem.type`、Team coordinator 路由 |
| `agentName` / `teamInfo` | `leadAgentId` / `agents[]` | lead `AgentSession`、`TeamMember.agentRef` |
| `agents[]` | `AgentDefinition[]` | `expertsReadAgentPrompt`、`~/.pi/agents` 软链接或受控资源目录 |
| `skills[]` | `SkillDependency[]` | Pi ResourceLoader / skill catalog 的依赖声明 |
| `avatar` / `members[].avatar` | `AssetRef[]` | `avatarLocal`、安全的本地资源缓存 |
| `displayName` / `profession` / `tags` | `ExpertDisplay` | `ExpertItem.name/title/tags` |
| `defaultInitPrompt` / `quickPrompts` | `starterPrompts[]` | `ExpertDetailModal` 快速 prompt；不自动发送 |
| `scenes.json.plugins[]` | `SceneRef[]` | `FeaturedScenes`、SceneRouter、推荐卡片 |
| `metadata.json` | `integrity` | marketplace adapter 的来源和版本校验 |

`members[]` 是展示与身份关系的来源，`teamInfo.memberAgents[]` 是运行时路由的来源；导入器必须检查两者一致，不能只读取其中一边。connector 只导入能力描述和配置 schema，不导入授权状态，授权始终由用户在 Connector 卡片中完成。

### 6.3 导入流水线：发现 → 预览 → 确认 → 原子安装

迁移实现为独立的 `electron/main/workbuddy-import.ts`，而不是把读取逻辑塞进 `ExpertsTab`。Renderer 通过 `src/lib/agent/pi-client.ts` 调用版本化 IPC；当前没有自动激活或隐式授权：

1. **发现来源**：IPC 接受用户明确选择的本地 source root；服务兼容 `plugins/<id>/` 和 `plugins/marketplaces/<marketplace>/plugins/<id>/`，并识别 `.codebuddy-plugin/plugin.json`、`.aily-plugin/plugin.json` 与根 `plugin.json`。
2. **解析资源图**：解析 `plugin.json`，解析 `agents[]`、`skills[]`、avatar 和 scene 引用，规范化相对路径并拒绝越出 package root 的 `..` 路径。
3. **静态校验**：校验 JSON schema、语义化版本、`agentName` 与 MD stem、lead 唯一性、`teamInfo` 与 `members` 一致性、tags/quickPrompts 数量、首条 quick prompt 与 `defaultInitPrompt` 相等。
4. **Prompt 校验**：检查 frontmatter `name`、`displayName`、`profession`、`maxTurns`；Team member 检查角色定义、能力、分析流程、数据获取、结构化输出和 `SendMessage`；lead 检查 TeamCreate、调度、汇总和“不得代写成员产出”规则。校验失败的包只能进入预览，不能安装。
5. **依赖校验**：检查 Skill 目录、脚本、头像、scene plugin 引用和 category 是否存在；缺失依赖标记为 `blocked`，不以空文件静默替代。
6. **冲突计算**：以 `pluginId + agentId` 为稳定主键，比较已安装版本、manifest hash、文件 hash 和来源。输出 `new`、`same`、`upgrade`、`downgrade`、`conflict`、`missing-dependency` 六种结果。
7. **预览确认**：展示包名、版本、lead、成员、Skill、scene、文件数量、冲突和将要创建的软链接；用户确认的是“安装资源”，不是“立即启用专家”。
8. **隔离 staging**：`workbuddy-import.ts` 写入 `~/.pi/agent/openbuddy-workbuddy-imports/*.staging`，执行 realpath、文件大小、路径、源 hash 和复制后 hash 校验；所有文件完成后再原子 rename 到 `~/.pi/agent/workbuddy-experts/<pluginId>`。
9. **注册与激活分离**：导入服务写入脱敏 `plugin.json`、专家目录索引和 Pi 可发现的 `_meta/_expert_center.json`；preload allowlist 与 IPC 再次校验路径。不要在导入完成时自动改当前 session；用户随后通过 `pending-expert-store` 和 `pi_set_session_expert` 明确激活。
10. **回滚与幂等**：记录 `importId`、旧版本备份路径、目标路径和文件 hash；重复导入同 hash 返回 `already-installed`，不重复写文件。失败删除 staging 并恢复备份，显式 rollback 删除新版本并恢复旧版本。

### 6.4 冲突策略和用户可见结果

| 情况 | 默认策略 | 用户可选动作 |
| --- | --- | --- |
| 相同 `pluginId`、相同 hash | no-op | 查看差异 |
| 新版本且签名/来源允许 | 保留旧版本，安装新版本并切换 manifest 指针 | 安装、跳过 |
| 旧版本覆盖新版本 | 阻止 downgrade | 强制降级并保留备份 |
| Agent ID 已被另一包占用 | 阻止安装 | 重新命名为显式 namespace；禁止静默覆盖 |
| 成员 MD 缺失或 frontmatter 不匹配 | 阻止 Team 安装 | 仅导入为草稿，不能运行 |
| Skill 缺失 | 安装为 `degraded` | 补齐依赖、跳过该 Team |
| avatar 缺失 | 使用内置占位图 | 重新选择资产 |
| connector 未授权 | 导入 descriptor，状态 `needs-auth` | 用户手动授权；不自动连接 |

### 6.5 回滚、权限和安全最佳实践

- **最小权限**：导入器只读 WorkBuddy 允许的配置根；写入 OpenBuddy staging 时使用最小目录权限，最终资源文件保持用户私有权限。
- **路径隔离**：所有资源路径必须经过 package-root containment 检查；禁止跟随指向 home、system 或凭据目录的软链接。
- **凭据零接触**：不读取 `.credentials*`、`.master.key`、connector token、OAuth session、trace/session；对配置对象采用 allowlist 投影，而不是全量复制。
- **可审计**：每次导入生成不含内容的审计记录：来源、pluginId、版本、manifest hash、结果、冲突和回滚原因。
- **可恢复**：staging、journal、manifest pointer 更新必须有明确事务边界；应用重启后扫描未完成 journal，执行 cleanup 或 resume，而不是猜测状态。
- **可解释**：所有降级状态通过 `plugin/readiness` 或 Team event 告知 renderer，不能只在日志中报错。
- **不自动激活**：导入、安装、授权和激活是四个独立动作，尤其不能因场景推荐而静默切换 Expert。

## 7. Pi-first 专家团最佳实践

### 7.1 运行时边界

| 层 | 单一职责 | 当前 OpenBuddy 依据 / 目标 |
| --- | --- | --- |
| `ExtensionAPI` | 注册 `team_create`、`team_status`、`team_delete`、mailbox/task 工具和事件订阅 | `packages/team/openbuddy-team/src/pi.ts:27–71` |
| Team coordinator | Team 生命周期、成员图、并发 semaphore、取消、pause/resume、状态机 | `packages/team/openbuddy-team/src/index.ts:86–206` 的扩展方向 |
| lead `AgentSession` | 读取 Expert persona，决定直接回答、单成员路由或建立 Team | `electron/main/agent-host.ts:2016–2031` |
| member `AgentSession` | 具名 Agent prompt、隔离上下文、结构化产出、回传 mailbox | `electron/main/agent-host.ts:2303–2400` |
| `SessionManager` | lead/member session 的创建、持久化、恢复和 archive | `electron/main/agent-host.ts:2022–2023`；成员当前是 `inMemory()` |
| hooks / events | `subagent/start|end`、`team/member-updated`、`team/finished` | `electron/main/agent-host.ts:2354`、`2393`；Team service event |
| Electron Main / preload | 只传递版本化、脱敏的 command/event | `electron/main/ipc/index.ts`、`electron/preload/index.ts` |
| Renderer / Zustand | 只消费事件快照，渲染 TeamStatus/Colleagues/进度 | `src/components/SubagentPanel.tsx`、`src/components/TeamStatusView.tsx` |

### 7.2 Team 状态机与消息模型

Team 建议状态为 `created → active → paused → active → completed | failed → archived`，异常路径允许 `active → cancelling → cancelled`；成员状态为 `idle → working → waiting → completed | error | killed`。每次状态转换必须包含 `teamId`、`memberId`、`runId`、`sessionId`、`sequence` 和时间戳，renderer 通过 sequence 丢弃过期事件。

mailbox 消息使用 `messageId`、`fromMemberId`、`toMemberId`、`kind`、`payload`、`correlationId`、`createdAt`、`sequence`；成员只向 coordinator 回传，跨成员消息由 coordinator 中转。消息 payload 默认限制大小并脱敏，不能把完整 session transcript 复制到 UI event。

任务看板最小状态为 `backlog → todo → doing → review → done`，另有 `blocked`；任务包含 owner、priority、blockedBy、resultRef。成员完成任务时发送结构化 `task_updated`，lead 只汇编已完成成员的 `resultRef`，不凭空补写成员结论。

### 7.3 Pi 运行最佳实践

1. **Persona 与 orchestration 分离**：Expert prompt 定义角色和协作规则，Team service 负责生命周期；不要让 prompt 自己持久化状态或猜测成员文件路径。
2. **Agent ID 稳定化**：使用 `pluginId/agentId` namespace，兼容旧短名但不再生成匿名 `planner-1`；manifest、软链接和 UI 统一使用同一 ID。
3. **成员 session 隔离**：成员不继承无关的 parent transcript；使用显式 team context 和 `skip_parent_injection` 等价策略。需要回看时使用磁盘 `SessionManager`，临时任务才使用 `inMemory()`。
4. **工具最小化**：`noTools: "all"` 是递归保护而不是完整能力模型；按 Agent capability allowlist 注入必要 custom tools，并对 `team_create`、文件写入、网络和 connector 权限分别控制。
5. **并发和深度双重限制**：`maxParallel` 用 semaphore 实际约束，`maxDepth` 在 spawn 入口硬拒绝；取消、超时、异常都必须释放 semaphore。
6. **事件是事实源**：TeamStatusView 不应长期从 transcript 反推 live 状态；Team event store 是唯一状态源，transcript 只作回放和降级显示。
7. **恢复优先**：应用重启先恢复 Team journal，再恢复 member session；发现孤儿 run 时标记 `error` 并允许用户 retry，不自动重复执行有副作用的工具。
8. **导入后显式激活**：迁移只注册 Expert，不自动写 session metadata；激活沿用 `pending-expert-store` → `pi_set_session_expert`，满足 WorkBuddy 的用户确认语义。
9. **可观测性**：每个 run 记录状态、耗时、模型、token 计数、错误类别和 resultRef；UI 展示摘要，详细 transcript 留在 session store。
10. **版本化协议**：manifest、Team event、mailbox 和 cache metadata 都带 schema/version；扩展 reload 时通过 `DefaultResourceLoader` 重新发现资源，旧事件以 adapter 兼容。

### 7.4 推荐模块拆分

```text
packages/expert-import/
  workbuddy-source-reader.ts       # 只读发现和 allowlist 投影
  plugin-manifest-parser.ts        # plugin.json -> ExpertManifest
  agent-md-validator.ts             # frontmatter + Team 协作契约
  dependency-resolver.ts            # skills/avatar/scene/connector
  conflict-detector.ts              # plugin/agent/hash/version
  import-stager.ts                  # staging + atomic rename
  import-journal.ts                 # rollback/recovery/idempotency
packages/team/openbuddy-team/
  coordinator.ts                    # Team 状态机、semaphore、pause/resume
  mailbox.ts                        # 消息中转和 correlation
  task-board.ts                     # Kanban 状态和 resultRef
  events.ts                         # versioned team_event
electron/main/
  expert-import-ipc.ts              # preview/confirm/status/rollback
  team-event-bridge.ts              # Main -> preload 的脱敏事件
src/
  stores/expert-import-store.ts     # preview/progress/conflict
  stores/team-runtime-store.ts      # event snapshot
  components/experts-panel/        # import preview + activation
  components/TeamStatusView.tsx    # runtime projection
```

完整总体架构、迁移时序、数据模型和失败回滚图见 [`docs/diagrams/expert-team-architecture.md`](diagrams/expert-team-architecture.md)。图中 `workbuddy-import.ts`、IPC 和 Pi 资源根是本 change 已实现的本地迁移路径；Team coordinator、mailbox、任务板等仍是后续设计建议。

---

### 附录 A：WorkBuddy 对标组件 → OpenBuddy 代码映射速查

| WorkBuddy 组件 | OpenBuddy 入口 |
| --- | --- |
| HomePage / SceneTabs / PracticeCases | 推测 P3 实现；当前在 `FeaturedScenes.tsx` 局部实现 |
| ConversationList / PinnedSection | `src/components/SecondarySidebar.tsx` |
| ChatRenderer | `src/components/ChatView.tsx` |
| ColleaguesPanel | `src/components/TeamStatusView.tsx` + 推测 P5 提升 |
| TeamStatusView (live) | 暂未实现，P1 |
| AutomationPanel | `src/components/AutomationPanel.tsx` |
| KnowledgeBasePanel | 未实现 |
| SkillRecommendBar | `src/components/experts-panel/skills/SkillsTab.tsx` 内 grid；推测 P3 提升 |
| Composer | `src/components/experts-panel/experts/ExpertDetailModal.tsx` 等多处复用 `um-composer` 体系 |

### 附录 B：关键命令速查

| 命令 | 用途 |
| --- | --- |
| `rg "expertsLoad\|expertsLinkAgents"` | 追踪 renderer 侧调用 |
| `rg "team_create\|team_status\|team_delete" --type ts` | 校验工具名一致性 |
| `rg "@openbuddy/team-team\|@openbuddy/team-subagent" -l` | 校验 capability package 边界 |
| `pnpm typecheck` | 最低编译校验（文档不破坏类型树） |
| `git diff --check` | 文档 change 收尾校验 |
