# OpenBuddy Plugin Catalog (Pi / Cordis / Renderer)

> 版本：v1 · 2026-08-31
> 配套文档：`openbuddy-distributed-buddy-vision.md` · `openbuddy-plugin-architecture.md` · `docs/diagrams/openbuddy-distributed-buddy-architecture.html`
> 目标：列出 OpenBuddy 当前已落地的全部 Pi/Cordis/Renderer 插件，作为后续扩展多智能体协作能力的索引。

OpenBuddy 不引入第二个 Agent runtime、第二个任务系统或第二个调度器。Pi AgentSession 是**唯一执行体**，Cordis 是**唯一服务总线**，Renderer Contribution Registry 是**唯一 UI 扩展面**。所有协作能力都通过这三种 surface 之一接入。

## 1. 三层 surface

| Surface | 用途 | 注册点 | 消费点 |
|---|---|---|---|
| **Pi Tool / Event / Command** | 模型可调用的工具 | `pi.tools.registerTool` | LLM tool-calling |
| **Cordis Service** | 主进程跨服务依赖注入 | `ctx.provide` / `ctx.inject` | `ctx.get` |
| **Renderer Contribution** | 修改 UI（侧栏 / 助理 / 项目 / 消息 / 设置 / 斜杠命令 / Composer） | `rendererContributions.register` | `useRendererContributions(kind)` |

三层之间**不互相替代**：Cordis 不能绕过主进程 capability gate；Renderer 不能拿原始 IPC；Pi tool 不能直接改 DOM。

## 2. Pi 工具插件（base bundle 内）

主进程把 capability 包以 Harness-shaped plugin 形式注入 Pi 工具集。详见 `packages/bundle/openbuddy-base/src/capability-plugins.ts`（567 行）。

| 插件 ID | Pi 工具 | capability 包 | 用途 |
|---|---|---|---|
| `openbuddy-session` | — | `@openbuddy/core-session` | Session 生命周期 |
| `openbuddy-authorization` | — | `@openbuddy/capability-authorization` | 主进程 capability gate（precondition） |
| `openbuddy-mcp-client` | — | `@openbuddy/capability-mcp-client` | 外部 MCP server → Pi 工具集 |
| `openbuddy-memory` | `memory_list` / `memory_get` / `memory_save` | `@openbuddy/capability-memory` | 长效记忆 |
| `openbuddy-notification` | `notification_list` / `notification_append` | `@openbuddy/capability-notification` | 通知中心 |
| `openbuddy-email` | 邮件全套 | `@openbuddy/capability-email` | 邮件 Provider（外部资源） |
| `openbuddy-inspiration` | — | `@openbuddy/capability-inspiration` | 灵感 / 草稿 |
| `openbuddy-web-search` | 网络搜索 | `@openbuddy/capability-web-search` | Web 搜索 |
| `openbuddy-permission` | — | `@openbuddy/auth-permission` | 文件 / 命令权限 |
| `openbuddy-plan` | `plan_get` / `plan_set` / `plan_approve` | `@openbuddy/capability-plan` | Plan Mode |
| `openbuddy-automation` | — | `@openbuddy/capability-automation` | 定时 / 周期触发 |
| `openbuddy-calendar` | — | `@openbuddy/capability-calendar` | 日程读写 |
| `openbuddy-fs-local` | — | `@openbuddy/fs-fs-local` | 本地文件系统 |
| `openbuddy-subagent` | — | `@openbuddy/team-subagent` | 子 Agent 深度限制 |
| `openbuddy-team` | Team 工具 | `@openbuddy/team-team` | 多成员 Pi Session |
| `openbuddy-folder-trust` | — | `@openbuddy/capability-folder-trust` | 目录信任 |
| `openbuddy-task` | — | `@openbuddy/capability-task` | TaskStep（会话内） |
| `openbuddy-collaboration` | 10 个协作工具（见下） | `@openbuddy/collaboration-runtime` | **多智能体协作核心** |

### 2.1 `openbuddy-collaboration` 的 10 个 Pi 工具

`buddy_collaboration_manifest` · `buddy_collaboration_snapshot` · `buddy_task_propose` · `buddy_network_snapshot` · `buddy_side_effect_intent` · `buddy_collaboration_propose` · `buddy_workflow_propose` · `buddy_network_propose` · `buddy_network_negotiate` · `buddy_network_offer`

每个工具的 payload 都通过 envelope 约束 `capabilityInput` 通道，**不复制完整 prompt / 凭证**。授权链仍走 Runtime，不在 tool 层复制。

## 3. 协作内核包（`packages/collaboration/`）

8 个子包构成多智能体协作的协议 / 控制 / 投影 / 传输 / 证据栈：

| 包 | 行数 | 职责 | 关键不变式 |
|---|---:|---|---|
| `openbuddy-protocol` | 1.8K | 9 类核心对象（Identity/Room/Capability/SideEffectIntent/TaskEnvelope/Policy/Event/Artifact/Verifier） | 三层产品共用 |
| `openbuddy-policy` | 8.8K | `effectivePolicy = owner ∩ org ∩ task ∩ capability` | 任何 deny 不能被覆盖 |
| `openbuddy-room` | 5.1K | Room / Channel / DM membership + ChannelStore | EventStore 是唯一事实源 |
| `openbuddy-task` | 9.0K | TaskStep / Workflow DAG | 任务合同跨 Buddy 共享 |
| `openbuddy-inbox` | — | InboxProjection + Wake | 每次 wake 携带 ID + reason + nonce |
| `openbuddy-coordinator` | 30.6K + provider.ts 14.4K | OrgCoordinator / TaskExecutor / WorkflowExecutor / Verifier | fail-closed |
| `openbuddy-network` | 43.5K | Agent Card / Federated Room Grant / LocalRelay / RemoteRelayWire / A2A adapter | Discovery ≠ Authorization；公网 Relay not_configured |
| `openbuddy-evidence` | — | Artifact / EvidenceBundle / VerifierResult | Provider ≠ Verifier |

## 4. Renderer Contribution 插件

`@openbuddy/renderer-host` 支持 7 种 contribution kind。每种都已在 base 中落地示例。

### 4.1 Assistant 贡献（`助理工作台`）

| 插件 | 路由 | modes | trust | capabilityIds |
|---|---|---|---|---|
| `openbuddy-assistant-cross-org-deliveries` | `助理·跨组织交付` | org+network | known_peer | `federated-room-grant` · `network-deliveries` |
| `openbuddy-assistant-research-buddy` | `助理·研究 Buddy` | all | org | `research:brief` · `memory:list` · `web-search` |
| `openbuddy-assistant-team-workflow` | `助理·团队工作流编排` | org | org | `workflow:propose` · `workflow:execute` |

消费点：`AssistantTopTabs`（更多⌄ popover） + `AssistantExtensionPanel`（按 route 渲染）。

### 4.2 Project 贡献（`项目详情`）

| 插件 | projectTab | modes | trust | capabilityIds |
|---|---|---|---|---|
| `openbuddy-project-cross-org-deliveries` | `cross-org-deliveries` | org+network | known_peer | `federated-room-grant` · `network-deliveries` |
| `openbuddy-project-workflow-blackboard` | `workflow-blackboard` | personal+org | local | `workflow:read` |

消费点：`ProjectDetailView`。

### 4.3 Message 贡献（`消息内`）

| 插件 | modes | trust | capabilityIds |
|---|---|---|---|
| `openbuddy-message-delegate-to-buddy` | all | org | `task:propose` · `buddy:delegate` |

消费点：`MessageItem`（消息 footer 区域）。

### 4.4 Settings 贡献（`设置`）

| 插件 | section | modes | trust | capabilityIds |
|---|---|---|---|---|
| `openbuddy-settings-collaboration` | `collaboration` | all | local | `policy:read` · `buddy:identity:read` · `federated-room-grant:read` |

消费点：`SettingsPanel`。

### 4.5 Command 贡献（`斜杠命令`）

| 插件 | command | modes | trust | capabilityIds |
|---|---|---|---|---|
| `openbuddy-command-buddy-propose` | `buddy-propose` | all | local | `task:propose` |
| `openbuddy-command-federated-grant` | `federated-grant` | org+network | known_peer | `federated-room-grant` |

消费点：`SlashCommands`（composer 内的 `/` 触发）。

### 4.6 Sidebar / Composer 贡献（已有）

| 插件 | 用途 |
|---|---|
| `openbuddy-renderer-sidebar` | 侧栏入口 |
| `openbuddy-renderer-composer` | Composer 入口 |

## 5. 测试覆盖

| 包 | 测试文件 | 用例 |
|---|---|---:|
| `@openbuddy/bundle-base` | `index.test.ts` + `renderer-assistant-contributions.test.ts` + `renderer-contributions.test.ts` | 25 |
| `AssistantWorkspacePanel.test.tsx` | FederatedGrantList 跨组织 + 10 section | 12 |
| `AssistantTopTabs.test.tsx` | top tabs + 插件扩展 | 10 |
| `collaboration-runtime.test.ts` | Runtime 集成 + 跨重启 | 47+ |
| `openbuddy-coordinator/src/index.test.ts` | Coordinator fail-closed | 11 |
| `openbuddy-network/src/index.test.ts` | Federated Grant + LocalRelay | 30+ |
| **小计** |  | **~140**（base + 协作内核） |

## 6. 后续可扩展点（按优先级）

### 6.1 同一 surface 内的扩展（低风险）

1. **新 capability 包接入 MCP**：把 `task` / `plan` / `memory` / `automation` / `notification` 等适配为 MCP Resources/Tools，让 Buddy 能力对外暴露为标准协议
2. **新 Pi tool**：在 `openbuddy-collaboration` 下增加 `buddy_federated_grant_issue` / `buddy_federated_grant_revoke` / `buddy_workflow_blackboard_query` 等
3. **新 Assistant 贡献**：`助理·Artifact 库` · `助理·公网 Relay 状态`（即使 not_configured 也要展示）
4. **新 Project 贡献**：`协作日志` · `能力合同预览` · `审计证据视图`

### 6.2 跨 surface 整合（中风险）

5. **跨设备恢复 Outbox sync**：本地 JSONL → Outbox adapter，仍走本地，不开公网 Relay
6. **Workflow Blackboard 编辑模式**：拖拽新建 / 重连依赖 / 拆分子流程
7. **更多 capability* 包接入 MCP**（重复展开）：8+ 个包统一适配

### 6.3 评审后启动（高风险）

8. **公网 Relay 部署**：现有 `RemoteRelayWire` 已就位，需独立的安全/运维/合规评审
9. **跨组织身份凭证**：当前 `credential:*` 仍走 local trust；需对接 A2A / OIDC
10. **结算 / 争议 / SLA**：全部 `not_configured`，需双向协议 + 资金通道

## 7. MCP adapter（per-package exporters）

 是 transport-only：列出 capability + 转发 invoke。2026-08-31 新增  提供 per-package 注册机制，让每个 capability 包独立声明自己的 MCP surface。

### 7.1 架构



### 7.2 三个内置 exporters

| 包 | capability id | scope | approval |
|---|---|---|---|
|  |  | personal / read |  |
|  |  | personal / write |  |
|  |  | personal / read |  |
|  |  | personal / read |  |
|  |  | personal / read |  |

每个 exporter 强制 ，守住 **Discovery ≠ Authorization**。

### 7.3 测试覆盖

| 测试文件 | 用例 |
|---|---:|
|  | 15（+3 per-package exporter 集成） |
|  | 13（registry / projection / built-in） |

合计 28 个 MCP adapter 用例全过。

## 8. 跨 Buddy 协作流（Alice ↔ Bob 端到端）

### 7.1 七步流程

发现 → 信任 → 提案 → 授权 → 委托 → 验收 → 结算

详见 `docs/diagrams/openbuddy-cross-buddy-collaboration-flow.html`（16.8 KB）。

### 7.2 UI 入口

| 入口 | 消费插件 / 组件 | 用途 |
|---|---|---|
| `助理·开放网络` | NetworkList + BuddyDirectory | 网络快照 + Buddy 目录（本人 / 组织 / Peer 三栏） |
| `助理·Rooms` | FederatedGrantList | 跨/同组织徽章 + 颁发方/主体/数据范围/动作/操作 |
| `助理·证据与审计` | ActivityList | 独立 Verifier 高亮；verifier.id 与 digest |
| `助理·副作用恢复` | SideEffectIntentList + RecoveryList | 跨组织 SideEffectIntent + 一次性消费 |
| 项目详情跨组织 tab | `openbuddy-project-cross-org-deliveries` | 项目维度 Federated Grant + 交付 |
| 项目详情黑板 tab | `openbuddy-project-workflow-blackboard` | Workflow DAG（Provider ≠ Verifier 高亮） |
| Composer /buddy-propose | `openbuddy-command-buddy-propose` | 统一协作合同入口 |
| Composer /federated-grant | `openbuddy-command-federated-grant` | 颁发/撤销 grant |
| 消息 footer | `openbuddy-message-delegate-to-buddy` | replayable TaskEnvelope |
| 设置-协作 | `openbuddy-settings-collaboration` | 只读 effectivePolicy + 信任根 |

### 7.3 实现文件

| 文件 | 用途 |
|---|---|
| `src/components/BuddyDirectory.tsx` | 统一 Buddy 目录视图（8 个 Vitest 用例） |
| `packages/collaboration/openbuddy-network/src/relay-auth.ts` | Federated Room Grant 验签 |
| `packages/collaboration/openbuddy-network/src/index.ts` | LocalRelay.deliver |
| `packages/collaboration/openbuddy-coordinator/src/index.ts` | OrganizationTaskExecutor |
| `packages/collaboration/openbuddy-coordinator/src/provider.ts` | OrganizationCapabilityProvider.invoke |
| `electron/main/collaboration-runtime.ts` | executeNetworkEnvelope 透传 grant |

## 9. 不变式（代码 + 文档同步强制）

1. `effectivePolicy = owner ∩ org ∩ task ∩ capability`
2. EventStore 是唯一事实源；UI 是事件投影
3. `Discovery ≠ Authorization`：Agent Card ≠ 可执行授权
4. `Provider ≠ Verifier`：provider 不能自我验收
5. `AgentIdentity ≠ AgentProfile ≠ Pi AgentSession`
6. 私有 session/凭证/完整 prompt 不进入跨边界网络
7. 每次 wake/通知携带 ID + principal + reason + nonce
8. 不可逆外部副作用有 `SideEffectIntent` + 一次性消费
9. 跨组织 Project Room 必须有 Federated Room Grant
10. 公网 Relay/支付/结算：显式 `not_configured`

每个新增插件在 `payload` 中声明 `modes` / `capabilityIds` / `requiredTrust` 三元组，让 host 按场景和信任过滤；**不允许任何插件绕过 authority gate**。
