# OpenBuddy 分布式 Buddy 网络整体架构

> 版本：Phase 1 local-first implementation · 2026-08-30
> 参考：Alook、MetaGPT、Block/Buzz、Pi ExtensionAPI，以及 OpenBuddy 当前 Electron + Pi + Cordis + Plugin Host 架构。

## 目标

OpenBuddy 把每个用户的 WorkBuddy 作为一个持久化代理，统一支持三种产品形态：

```text
个人生产力网络：Human ↔ Personal Buddy ↔ 本地日程/信息/任务/资源
团队/企业协作：Personal Buddy ↔ Org Coordinator ↔ Team Buddy
开放 Buddy 网络：Buddy ↔ Directory/Relay ↔ External Buddy/Service
```

三层不复制三套产品，而是共享同一协议内核；差异只来自信任等级、Room policy、能力可见性、Transport 和未来 settlement adapter。

## 统一对象模型

```text
BuddyIdentity
  → Room / Channel / DM / Thread
  → Capability Contract
  → Task Envelope
  → Policy Intersection
  → Workflow / Blackboard
  → Append-only Event Log
  → Artifact / Evidence Bundle
  → Independent Verification
```

关键约束：

- `effectivePolicy = user ∩ organization ∩ task ∩ capability`，任何一层 deny 都不能被覆盖。
- 查询、订阅和持久化写入先确定 `communityId`、`organizationId`、`roomId`、`taskId` scope，再访问数据。
- wake/通知只携带稳定 ID、principal、reason、nonce；消费时重新读取当前 authority，并检查 membership、expiry、revocation 和 nonce。
- Room、Inbox、任务、审计和搜索都是事件投影；事件账本是事实来源，投影可以重建。
- provider 不能自我验收；未有独立 verifier 时结果保持 `unverified` 并进入人工验收。
- 私有 session history、凭证、完整 prompt 和 connector config 不进入 Room activity、Inbox 或 Task Envelope。

## 产品与 UI

一级导航保持不变：

```text
新建任务
助理
项目
专家·技能·连接器
自动化
邮件
更多
```

全局协作控制面继续作为 `助理` 子菜单；项目内增加同一 Runtime 的上下文投影：

```text
助理
├── 总览
├── 收件箱
├── 跨项目任务
├── Rooms
├── 助理与 Buddy
├── 开放网络
├── 能力与策略
└── 证据与审计
```

项目
└── 项目详情
    ├── 动态
    ├── 计划
    ├── 任务
    ├── Buddy 协作（按 projectId 投影）
    └── 资产
```

实现约束：左侧 Sidebar 只显示一级入口；助理的上述子菜单统一渲染在助理工作台右上方的 `AssistantTopTabs`，总览页和所有子页面共用同一组 Tab。这样不会把“助理与 Buddy”“开放网络”等协作治理概念误认为新的一级产品模块，也避免项目页与助理页各维护一套导航和事实源。插件只能通过受校验的 renderer contribution 注册 `助理·子菜单`，不能注入新的顶级 Coordinator。

Project Room 规则：没有项目的个人任务使用 `personal-room`；项目个人、组织和项目级开放网络任务分别使用由 `projectId + mode` 稳定计算的 `project-<digest>` Room。个人 Project Room 默认 `private/local`，组织/网络 Project Room 默认 `org/local+org`。助理工作台跨 Room 聚合任务、Inbox 和审计，项目页只按 `projectId` 过滤投影；两者不维护第二份执行状态。项目级开放网络任务现在可以先进入项目 Room 并参与发现/竞标，但在授标投递前必须完成跨组织 Project Room/Relay 授权。LocalRelay 与 RemoteRelay 对 `project-*` Room 采用同一 fail-closed 规则：endpoint 注册和 `task.send` 必须携带有效、未过期、未撤销且精确绑定 `projectId + roomId + taskId + principal + capability + dataScopes + actions` 的 Federated Room Grant；个人 Room 继续保持本地兼容路径。

统一协作入口已经贯通：助理工作台的“发起 Buddy 协作”覆盖个人、组织和开放网络任务；开放网络页进一步提供“发布提案”“先谈判”和“发布能力卡”，形成发现 → 谈判 → 委托的本地沙盒闭环。相同操作也通过 Pi `openbuddy-collaboration` 插件暴露为 `buddy_collaboration_propose`、`buddy_network_propose`、`buddy_network_negotiate` 和 `buddy_network_offer` 工具；UI、Pi 工具和项目投影都只调用同一个 Main `CollaborationRuntime`，不新增第二套执行器。网络提案只允许公开数据范围，能力发布默认 `known_peers`、需要外部提交审批，结算保持 `not_configured`。

组织协作的最小操作闭环也已进入 `助理·助理与 Buddy`：先添加组织 Buddy（成员 ID、句柄、所属用户和角色），再选择已加入的成员，填写能力列表、数据范围、可选 `taskId`/`roomId` 和过期时间即可创建委托；撤销按钮直接调用 Main-owned `delegation-revoke`，刷新后以 Runtime 投影为准。Renderer 不保存成员或委托状态，也不绕过 `Task → Policy → Approval → ExecutionRef` 链路。当前只提供添加成员，不在 UI 暗示未接通的成员删除操作。

Room 授权遵循更严格的最小权限：组织成员加入组织目录后不会自动获得所有 Project Room 的访问权；只有 `助理·Rooms` 中对 `team/org` Room 的显式“加入 Room”操作才会写入 `room.member_added`，并可由管理员显式“移出 Room”写入 `room.member_removed`。个人 `personal/private` Room 永远拒绝该管理 API。Room 成员事件按最新事件重建，重启后撤销状态不会恢复为 active。

理由：聊天、Projects、Skills、Connectors、Automations 仍保持原有路径；分布式协作的全局控制面集中在助理上下文，项目详情页提供 `projectId` 范围内的委托、执行和证据投影。两处都调用同一 Task Contract、Coordinator、Provider 和 Verifier，不复制执行引擎。个人任务和跨项目任务仍可直接从助理发起；项目任务从项目页发起时必须带受控的项目 context refs。UI 使用 progressive disclosure：默认展示摘要、下一步和风险，展开后查看策略、事件、引用和证据。

Mission 页面稳定分为四个区域：

- `Contract`：目标、输入/输出 schema、SOP、角色和验收测试。
- `Policy`：数据范围、动作、预算、审批、过期和撤销。
- `Activity`：脱敏事件流；工具细节进入抽屉，不把每个调用渲染成聊天气泡。
- `Evidence`：artifact、来源、执行、测试、审批和 verifier 状态。

完整可视化架构图：`docs/diagrams/openbuddy-assistant-workbench-architecture.html`。

模块职责、已有能力与 Buddy 协作层的重叠矩阵见：`docs/openbuddy-module-overlap-analysis.md`。该文档明确了 Session Todo、后台 Job、Team Record 与 Buddy Task 的父子关系，以及 Agent Profile、Pi AgentSession、Team Member 和 Buddy Identity 的边界，避免新增协作功能重复实现现有执行能力。

## 参考设计的吸收与边界

### Alook

吸收 people + agents 的 Room 模型、持久 Agent handle、Inbox/wake、控制面与数据面分离、最小 wake payload、幂等 nonce 和结构化 activity。OpenBuddy 保留本地 AgentSession 私有上下文，不把 Room 当作全量共享记忆。

### MetaGPT

吸收 role、SOP、结构化 artifact、blackboard 和 independent verifier。OpenBuddy 的 Coordinator 维护 DAG 和状态，不让所有角色在共享聊天中自由漂移；跨 Buddy 只传 artifact/context refs。

### Block/Buzz

吸收人和 Agent 同等成员、community 作为信任边界、relay/event log 作为协作事实来源、ACP 与 MCP 分管 Agent 生命周期和工具资源、remote body 可替换、presence 是 lease。Phase 1 不复制 Nostr wire、relay、支付或公网市场，只保留可替换 adapter 边界。

### Pi

`AgentSession` 负责模型会话生命周期，Pi `ExtensionAPI` 负责 agent-facing tool/command/event/UI request；Cordis Service 负责产品能力的生命周期、持久化和跨宿主复用；MCP/skills/connectors 只通过 Capability Adapter 注册；Electron Main IPC 只暴露 typed redacted projection。

### 可核对的公开来源

- Pi coding-agent README：说明 Pi 是可嵌入的 coding harness，扩展、Skills、Prompt Templates、Themes 和 SDK 是公开扩展面；OpenBuddy 采用其 ExtensionAPI/AgentSession 生命周期，不复制 agent loop。
- MetaGPT README：明确“按角色组成协作实体”和 `Code = SOP(Team)`；OpenBuddy 对应 `Capability.procedure`、Workflow DAG、结构化 Artifact 和独立 Verifier，而不是共享完整对话。
- Block/Buzz README 与架构目录：强调 self-hostable workspace、community、relay、人与 Agent 同室，以及 ACP/MCP、remote body、signed event 的分层；OpenBuddy 把 community/relay/remote body/settlement 作为可替换 adapter，Phase 1 只启用本地沙盒。
- Alook 公开仓库：其产品方向可归纳为持久 Agent、Room/Channel、Inbox/Wake 和本地控制面；OpenBuddy 只吸收协议形状，不复制云端服务、身份系统或私有实现。

来源入口：`https://github.com/earendil-works/pi`、`https://github.com/geekan/MetaGPT`、`https://github.com/block/buzz`、`https://github.com/alookai/alook`。远程内容只用于设计参考，不能替代本地代码、测试和安全边界。

本轮还直接核对了四个仓库当前公开 README/扩展文档：Alook 的产品描述明确强调“people and agents share the same rooms”、持久 handle/inbox/membership 与本地 always-on body；Buzz 明确将 community 作为 workspace tenant、将人、Agent、workflow、git、approval 统一为 signed event，并以 ACP/MCP、relay、remote body 分层；MetaGPT 明确以 role + SOP 组成软件公司式团队并产出结构化交付物；Pi 的 ExtensionAPI 明确提供 tool、command、event、UI、session persistence 与 reload。OpenBuddy 采用这些机制的边界形状，不把任何一个外部项目当作运行时依赖或安全背书。

## 当前代码落点

```text
packages/collaboration/openbuddy-protocol   Identity / Room / Capability / Task / Event / Evidence 类型
packages/collaboration/openbuddy-policy     四层策略交集、预算、审批、delegation 和过期
packages/collaboration/openbuddy-task        任务状态机、合法 transition、nonce、事件重放
packages/collaboration/openbuddy-evidence    Artifact/Evidence bundle digest 和独立 verifier 规则
packages/collaboration/openbuddy-room        scoped Room、member、channel、presence lease、wake rebuild
packages/collaboration/openbuddy-inbox       Event → Inbox projection、cursor、ack、dedupe、rebuild
packages/collaboration/openbuddy-coordinator 任务 proposal、Org Coordinator、成员角色、delegation、approval、takeover、Provider adapter

packages/bundle/openbuddy-base/src/capability-plugins.ts  `openbuddy-collaboration` 独立 Pi/Cordis plugin：通过 bridge 注入 runtime，并注册 manifest、snapshot、task/workflow、network proposal/offer/negotiation tools；可独立 disable/reload，不要求把协作逻辑塞进所有 capability。

electron/main/collaboration-runtime.ts       local JSONL EventStore adapter + scope + redacted snapshot
 electron/main/ipc/index.ts                         collaboration snapshot/proposal/ack + member/delegation/approval/task-control
 electron/main/openbuddy-core-plugin.ts       提供 collaboration runtime bridge；OrganizationCapabilityProvider 仍复用现有 teamRunner，并通过 Cordis disposer 清理
 src/lib/agent/pi-client.ts                         renderer typed client
 src/components/AssistantWorkspacePanel.tsx  助理子菜单的 Inbox/Mission/Rooms/Buddy/Capabilities/Evidence UI
src/components/ProjectCollaborationTab.tsx   项目详情页的 projectId 协作投影，不拥有独立执行器

`CollaborationRuntime.onUpdate()` 是控制面到体验面的最小事件桥；IPC/preload 只传 `eventId/kind/taskId?/roomId?/updatedAt`，Renderer 收到后重新调用 scoped snapshot。助理工作台和项目协作 Tab 均通过 `assistantFacade.onUpdate` 订阅，项目 Store 只保留 canonical task 的弱引用，不复制事件状态。

“开放网络”也作为“助理”的子菜单接入，展示 Peer 信任、能力卡、服务提案和竞标状态；不改变“项目”“专家·技能·连接器”“自动化”“邮件”“更多”等一级导航。当前 UI 明确标记 `local-sandbox`，不提供公网 Relay、真实支付或无人值守副作用。

在“助理·开放网络”顶部提供本地 Agent Card 信任根管理：用户粘贴 Ed25519 公钥 PEM 后，Main 进程写入 `agent-card-trust.json`；列表只投影 `keyRef`、添加时间和撤销时间，支持显式撤销。私钥、完整 Agent Card、prompt 和 session history 不进入 trust store。运行时重启或事件重放时会重新用当前公钥验签；没有 trust root、验签失败或已撤销时，Peer 保持 `unverified`，不能进入开放网络报价、竞标和授标流。该入口是本地 trust root，不等于公网目录、跨组织信任根发布或撤销传播。

本地 Agent Directory 通过 `JsonAgentDirectoryAdapter` 写入与事件文件同目录的 `agent-directory.json`，只保存 Peer 的脱敏 projection（identity、capabilities、trust、Agent Card 状态、presence lease 和时间字段），文件按 `0600` 权限原子替换。它用于重启后的快速恢复和 UI 查询，不是事件事实源，也不能作为授权、信任或能力执行依据；Runtime 启动后仍以事件重放、当前 Agent Card trust root 和 policy 重新计算状态。该 adapter 属于 `local-sandbox` seam，不等于公网 Agent Directory、跨组织发现或自动信任。

开放网络的服务提案在竞标前生成可重放的 `NetworkCapabilityAgreement`：请求方与提供方的 capability、数据范围、允许动作、产物类型和审批级别计算交集，任一范围无法满足就拒绝；竞标绑定 `agreementId`，授标时再次检查合同有效期与当前 Peer trust，事件与快照只暴露合同 projection。该合同仍受 Agent Card、Peer trust、Room Grant 和统一 Runtime policy 约束，不代表已启用支付、信誉或公网结算。
```

当前 local runtime 的持久化位置默认是：

```text
~/.pi/agent/openbuddy-collaboration/events.jsonl
~/.pi/agent/openbuddy-collaboration/events.jsonl.cursor.json
```

事件只写摘要、digest、scope、status 和 stable IDs；完整任务目标不会写入 projection。

## 分阶段路线

### Phase 0：协议内核（已实现）

类型、事件 digest、任务状态机、策略交集、nonce、证据 bundle、scope-first query 和 independent verification。

### Phase 1：个人 local-first（当前实现）

本地 Room/Inbox/wake runtime、JSONL event store、Personal Buddy identity、任务提议、Inbox ack/cursor、Pi skills/extensions/prompts capability cards，以及助理工作台 projection。

### Phase 2：组织协作与本地多 Buddy（控制面与本地 Provider 已实现）

已实现 Org Coordinator、成员角色和可撤销 delegation、审批请求/决策、pause/resume/takeover/revision/revoke、组织投影重放，以及复用现有 `openbuddy-team` 的 `OrganizationCapabilityProvider`。统一 `personal / organization / network` 命令契约由 `collaboration:propose` 和 `buddy_collaboration_propose` 暴露；个人和组织任务都通过共享 `OrganizationTaskExecutor` 生成 artifact/evidence，并由独立 verifier 验收。`OrganizationProviderRegistry` 支持多个独立 Buddy 按 capability 路由；`OrganizationWorkflowExecutor` 支持独立节点并发和依赖阻塞。Provider 只接收任务合同、output schema 和 context refs，不拼接成员完整历史；Coordinator 与 Provider 两层都执行 capability scope/action 交集检查，外部动作在 Provider 边界再次检查 approval，独立 verifier 不能由 provider/requester 充当。生产单例现在由 `openbuddy-core` 生命周期注入 `LocalRelay`，自动注册个人/组织 Provider endpoint；Award 后会执行 trust/capability/scope 检查、脱敏事件记录和幂等投递。真实网络投递统一经过 `DurableRelayOutbox`：完整 envelope 仅保存于发送方 `events.jsonl.outbox.json`，失败保留尝试次数和错误，重启后由 `collaboration:network-retry` 恢复；`pending_delivery` / `delivered` / `failed` 只作为网络状态投影进入助理工作台。Relay 仍是本地适配器，不代表公网 relay 或跨组织同步已完成。Room-scoped repositories 和远程 body 仍在后续迭代。

### Phase 3：跨设备/跨组织

协作网络包现在提供 `RemoteRelayServer` + `RemoteRelayTransport` 的可替换 wire seam，以及独立的 `createWebSocketRemoteRelayWire` / `createResilientWebSocketRemoteRelayWire` / `attachRemoteRelayWebSocket` carrier：独立 Runtime 可以通过 credential 连接，注册带 `PresenceLease` 的 recipient endpoint，发送经过 scope/expiry/identity/lease 校验的 Task Envelope，并通过事件 cursor 查询/重放；resilient carrier 暴露 `connecting | ready | degraded | closed`，断线后按有界退避重连，自动恢复 endpoint 和 subscription，显式 `close()` 后不再重连。Relay 运行时会为每个 delivery 分配稳定 `deliveryId`，保留待投递 envelope 直到 Provider ACK；Provider 重新注册时自动 replay，provider 端以 `messageId` 幂等执行，成功后才标记 `delivered`。完整 envelope 只在 Relay 内存和发送方 Durable Outbox 中存在，Relay persistence 只写 delivery metadata，因此服务端重启后的 envelope 恢复仍由发送方 Outbox 负责。撤销状态也跨 Relay 重启恢复：credential 和 capability token 只保存 `stableDigest`，Room Grant 只保存 `grantId`；重启后旧 credential、capability 和 Grant 继续拒绝。Relay credential 现在支持默认推荐的 Ed25519 签名：验证方通过 `keyRef → public key` resolver 管理当前 trust root，轮换时可并行信任新旧 key，撤销旧 key 后旧 credential 立即拒绝；既有 HS256/HMAC 仅保留给兼容和测试路径。Relay seam 现在额外提供带 `authorityId + sequence + kind + identifier + revokedAt` 的有序 revoke feed，可通过 `revocations.query` / `revocations.apply` 在独立 Relay 实例间增量同步，并对重复记录幂等、对序号冲突拒绝。生产模式下每条 revoke record 还必须携带独立 revoke authority 的 Ed25519 签名，接收方通过 `keyRef → public key` resolver 验证；普通连接 credential 不能代表撤销 authority。只有显式 `allowInsecureLocal` 的本地测试才允许无签名撤销记录。这仍是显式注入的传播接口，不等于已经部署跨组织 revoke 广播、denylist 服务或信任根目录。`RemoteRelayTransport` 现在会把拉取到的 credential/capability/room-grant revoke 记录写入本地内存索引，在下一次 endpoint 注册、task send 或 Grant 查询前先拒绝旧授权；本地 Runtime 仍通过事件日志记录可重放的 authority 审计投影。Electron 跨进程 Worker 已使用有界 resilient carrier；WebSocket carrier 已有双端 wire 集成测试，但仍是应用内可挂载的 carrier，不宣称已经部署公网 Relay 服务。签名 credential 证明身份，短期 capability token 约束 task/scope/capability/dataScopes/actions，Presence Lease 只证明近期在线资格，三者不能互相替代。下一步是跨重启服务端 envelope replay、presence fan-out、公共目录和生产级 token registry。Relay 只协调 identity/membership/quota/revoke，不读取明文 prompt。

Electron Harness 提供可选的 `/api/buddy-relay` upgrade 挂载，但只有显式注入 `buddyRelay` 且通过 Harness token 鉴权时才开放；没有 credential verifier 时 `RemoteRelayServer` 默认 fail-closed，只有明确标注的本地测试才可启用 `allowInsecureLocal`。这保证 carrier 接入不会意外变成无鉴权的公共入口。

### Phase 4：开放网络

Public directory、A2A-style Agent Card、capability discovery、proposal/bid/award、异步 task update、SLA/metering、reputation、sandbox、settlement/dispute。默认禁止公开能力执行购买、生产发布和不可逆外部副作用。

当前仅实现 Phase 4 的本地沙盒投影与协议状态机：跨域 scope 拒绝 `private:*`、`credential:*`、`secret:*`，网络事件只保存 objective digest、稳定 ID 和最小合同；结算固定为 `not_configured`。本地公钥 trust store 已可在助理 UI 添加/撤销并跨重启恢复；Relay 已具备独立 Ed25519 revoke authority 的签发/验签 seam，但生产公钥目录、轮换、跨组织 trust-root 发布与自动化 revoke 广播仍未完成。

协作插件现在还暴露版本化 `BuddyCollaborationManifest`（`collaboration/1`）：它统一声明 identity、rooms、tasks、workflows、policy、approval、evidence、verification、directory、relay 和 A2A 的支持模式、传输边界及四条安全不变量。Pi 工具、未来 Renderer Contribution 和 A2A/Relay 适配器必须以该 manifest 为能力发现入口，不能在各自插件中复制 Coordinator 或重新解释授权语义。

## 验证与未完成边界

### 协作能力的插件化 UI 边界

Agent Card 身份实现已拆成独立 adapter：Ed25519 签名与验签使用公钥 DER 指纹作为稳定 `keyRef`；`MemoryAgentCardTrustStore` 和 `JsonAgentCardTrustStore` 只保存公钥 PEM、`keyRef`、添加时间与撤销时间，绝不保存私钥。`CollaborationRuntime` 可注入该 trust store，重启重放时重新验签；没有当前 trust root 时状态降级为 `unverified`。

协作运行时继续由 `CollaborationRuntime`、Coordinator、Provider 和 Verifier 统一管理；插件不应直接复制任务状态机或绕过 IPC。需要新增助理能力时，插件可以在 renderer host 注册 `kind: "assistant"` 的 `AssistantRendererContribution`，声明唯一的 `route: "助理·<子菜单>"`、展示标题、可选 `capabilityIds` 与 `requiredTrust`，由现有 Sidebar 和 Assistant Workbench 自动提供入口。该注册会拒绝根路由、空标题和非助理路由，避免插件悄悄创建新的一级菜单或把能力挂到项目页。

插件 UI 只负责展示和发起命令，执行仍必须经过 `assistantFacade` → 受限 IPC → `CollaborationRuntime` → `CapabilityProvider` → `Artifact/Evidence/Verifier`。因此 Calendar、Email、Research、未来的跨组织服务都可以独立发布 renderer/Cordis/Pi surface，但共享同一 Room、Policy、Approval 和审计边界。

本轮新增两条产品闭环：Personal Calendar 通过 `calendar:list` 提供只读查询；日程创建、修改、删除统一转换为带 `capabilityInput` 的 Personal Collaboration Task，并由 `task:execute` 审批门控制。开放网络增加 `agent-card/1` 与本地 Capability Directory，Peer 只有在 Agent Card 的 community、identity、有效期和能力声明一致时才进入 `verified` 状态；缺少签名或生产 verifier 时保持 `unverified`，绝不等同于公网身份认证。网络包现在提供可插拔的 Ed25519 Agent Card 签名/验签 adapter、基于公钥 DER 指纹的 `keyRef` 和 resolver；`CollaborationRuntime` 可注入 trust-root resolver，事件重放会重新验签而不信任历史 `verified` 标记，默认无 resolver 仍降级为 `unverified`。

已验证：协作包和运行时定向测试、统一命令和个人/组织执行/独立 verifier 测试、LocalRelay/RemoteRelay Grant 授权、脱敏和跨 Buddy E2E、两个独立 `CollaborationRuntime` 实例通过 Relay 完成 Provider 执行并生成 Evidence、Harness `/api/buddy-relay` WebSocket 端到端、网络/插件/Sidebar 定向测试、项目 Buddy 协作 UI 回归、协作更新订阅的安全元数据与取消订阅、生产 `electron-vite build` 和 `git diff --check`。

当前仍明确未实现：公网 Relay 部署、跨组织生产同步、自动付款、链上身份、远程 Agent body、无人值守外部副作用、公共目录和结算；服务端跨重启 envelope replay 已提供可选的 AES-256-GCM `RelayEnvelopeCodec`，只有显式注入密钥时才将加密待投递内容写入 persistence，默认仍只保存 delivery metadata。Relay seam 已提供可插拔的 Ed25519/HMAC 兼容 credential 验证、可轮换 trust-root resolver、task-bound short-lived capability token 验证、Federated Room Grant 验证、独立 Ed25519 revoke authority 验证、Presence Lease 有序 fan-out 与过期/撤销边界；撤销索引、已签名记录和 Presence 投影可跨本地进程/重启恢复，但尚未实现真正跨组织的 revoke/presence 自动广播。Presence feed 只传播 `identityId + community/organization/room scope + lease 时间 + active/expired/revoked`，不传播 endpoint、prompt 或任务内容；生产模式必须显式注入 Presence verifier 和 authority authorization，只有 `allowInsecureLocal` 测试模式允许无 verifier。Federated Room Grant 默认使用 Runtime 私有、持久化、权限尽力为 `0600` 的 Ed25519 私钥签名，签名引用 Agent Card 风格的稳定 `ed25519:<keyRef>`；验证方通过组织/本地 trust root 解析公钥。显式注入 `OPENBUDDY_FEDERATED_GRANT_SECRET` 或测试 `grantSigningSecret` 时才使用旧 HMAC 兼容路径，不应作为跨组织生产部署方案。生产公钥目录、跨组织 trust root 发布和吊销同步仍未实现。`FederatedRoomGrant` 必须绑定 `projectId + communityId + organizationId + exact roomId`，并按 principal、task、capability、dataScopes、allowedActions、operation、expiry/revocation 校验；`project-*` Room 没有 Grant 一律拒绝，WebSocket carrier 只能转发 Grant，不能绕过服务端校验。当前 Electron Harness/Worker 仍使用测试或进程级 credential/Grant 注入，不等于跨组织身份体系已经上线。Presence Lease 只代表 endpoint 的短期在线资格，不能替代身份、信任、Grant 或 capability policy。Personal 的日程写入、邮件发送、自动化变更等有副作用动作也仍需专用 Provider 与人工审批。这些属于后续适配器，不应在 UI 中伪装成已连接能力；组织协作当前仅启用本地可信组织边界。`RemoteRelayServer` 和 WebSocket carrier 的独立连接、认证/过期/撤销/重放、Ed25519 key rotation、独立 revoke authority 签名校验、Presence fan-out/expiry、bounded reconnect 测试是 transport seam 证据，不等于公网联邦已上线。

A2A Main facade 的 request-id 幂等表和 sender+nonce 防重放索引现在跟随 CollaborationRuntime 的存储路径持久化；Electron/Main 重启后会恢复原 runtimeTaskId，过期的历史请求只作为已创建任务的重试记录读取，不会重新执行或重新发送。Room runtime 的 `consumeWake` 也在 authority rebuild 后按成员资格、任务 room、expiry、revokedAt、wakeNonce 和一次性 nonce 消费顺序 fail-closed；本地回归已覆盖成员移除、过期、撤销、错误 nonce 和重复消费。该持久化仍是本地控制面能力，尚未替代 Relay 服务端的跨节点 replay cache，也尚未证明跨 Runtime membership/revoke feed 到达前不会产生 stale wake。

## 参考项目吸收与下一阶段门槛

### SideEffectIntent 副作用授权边界

邮件发送和自动化运行不再各自维护一套外部动作授权，而是由 Main-owned `SideEffectIntent` 统一收敛：创建时关联 Task 与 Approval，执行前按 fingerprint 一次性消费，执行后记录 `completed` 或 `failed`，取消、拒绝和过期均不可执行。邮件旧 pending/scheduled 记录缺少授权意图时保持 fail-closed；自动化 scheduler 没有预授权时也不会静默执行。该状态机属于本地受控适配器，不等于公网 Relay、跨组织身份、支付或无人值守外部执行。

Pi 协作插件现在通过 `buddy_side_effect_intent` 创建同一份 Main-owned Intent；`buddy_task_propose`、`buddy_collaboration_propose` 和 `buddy_workflow_propose` 可以只传递 Intent 引用与 fingerprint，不接收凭证或私有上下文。开放网络任务在 Relay 投递前消费请求方 Intent，远端只把引用视为已授权；Provider 交付经独立 Verifier 验收成功后，Relay ACK 才允许请求方完成本地 Intent。临时 Relay 失败保持可重试，过期才进入失败终态。这样 UI、Pi、个人/组织执行器和网络 Runtime 都共享同一副作用边界。

### 当前产品边界审计

截至本阶段，三层产品的可宣称范围是：个人层已具备本地日程、邮件、任务、自动化和 Personal Buddy 的统一 Task/Policy/Approval/Evidence 管线；团队层已具备本地可信组织、Room、成员、delegation、审批、DAG、独立 verifier 和跨重启投影；开放网络已具备本地/远程 Relay seam、Peer Directory、签名 Agent Card adapter、能力谈判、Federated Room Grant、重放/过期/撤销边界和受控跨 Runtime 执行。公网 Relay 部署、真正跨组织 authority 广播、生产公钥目录、自动付款、远程 Agent body 和无人值守外部副作用仍明确属于后续适配器，不能在 UI 或文档中伪装为已上线功能。

### Renderer contribution contract

协作 UI 不通过业务组件互相 import 来扩展，而是使用现有 `@openbuddy/renderer-host` 的 contribution registry。贡献者只能声明 UI 入口和能力前置条件，不能取得 Main Runtime、Pi session 或凭证：

```ts
{
  kind: "assistant",
  id: "plugin-assistant-network-inspector",
  payload: {
    route: "助理·网络检查",
    label: "网络检查",
    order: 240,
    modes: ["network"],
    requiredTrust: "known_peer",
    capabilityIds: ["directory", "relay"]
  }
}
```

`order` 只决定同一工作台内的稳定展示顺序；`modes`、`requiredTrust` 和 `capabilityIds` 是 UI 声明，不是授权。真正的能力检查仍由 Main-owned `CollaborationRuntime`、Policy Intersection 和 capability provider 执行。`AssistantTopTabs` 只显示 `助理·*` 子菜单，`ProjectDetailView` 只显示项目 Tab；贡献不能注册新的一级 Sidebar 或绕过项目 `projectId` 投影。插件卸载后入口随 registry disposer 消失，核心总览、收件箱、任务、Room、证据和审计不受影响。

这使 Alook 的 Room/Inbox、Buzz 的 community/event log、MetaGPT 的 SOP/artifact，以及 A2A/MCP 的协议分工都能映射到同一扩展边界：A2A/MCP 提供互操作和能力发现，Buddy Runtime 决定授权与任务事实，renderer contribution 只呈现脱敏投影。

本轮对照了 Alook、Block/Buzz、MetaGPT 和当前 Pi ExtensionAPI 的公开设计：

| 参考 | 关键启发 | OpenBuddy 的落地方式 |
|---|---|---|
| Alook | 本地运行时、持久身份、Inbox、Room、被信任的人可触达本机 Agent | `BuddyIdentity`、Room membership、Inbox projection、Assistant Workbench；私有 session body 仍留在本机 |
| Buzz | 人、Agent、Workflow、Repository 共用 community/event log；relay 是租户边界；ACP/MCP 分离 | `communityId` / `Room` / append-only event / Relay seam；Pi 执行与 Relay transport 分离；不把当前本地 carrier 宣称为公网 Relay |
| MetaGPT | 角色、SOP、DAG、artifact-first 和阶段性验收 | `Capability Contract`、ProviderRegistry、Workflow/ExecutionRef、Artifact/Evidence/Verifier；不复制第二套 AgentSession |
| Pi | ExtensionAPI、typed tools、session lifecycle、events、resource/plugin loader | `openbuddy-collaboration` 独立插件，统一暴露 snapshot、task proposal、network proposal、network offer 工具；Main Runtime 是唯一执行控制面 |

下一阶段必须以可观察验收为门槛：

1. 个人：日程、邮件、记忆、自动化等 capability 都通过同一个 Task/Policy/Approval/Artifact/Evidence 管线，而不是分别增加直连按钮。
2. 团队：两个独立 Runtime 的 Project Room membership、审批、撤销、接管和 verifier 结果必须跨重启可重放。
3. 开放网络：Agent Directory、签名 Agent Card、跨组织 Project Room Grant、revoke propagation 和 capability negotiation 先于任何支付/结算。
4. UI：助理子菜单负责全局控制面，项目页只做 `projectId` 投影；网络页面必须明确显示 `local-sandbox`、信任等级、数据范围和 settlement 状态。
5. 插件：协作能力必须可独立 enable/reload/disable，插件异常不得破坏主对话和现有邮件、自动化、技能入口。

## 当前互操作与能力治理落点（2026-08-30）

### Main-owned A2A facade

A2A 互操作现在通过 `electron/main/a2a-runtime-adapter.ts` 接入主进程，但仍不提供公网 HTTP/SSE/push transport：

```text
Renderer / future local transport
        │  allowlisted IPC only
        ▼
electron/main/a2a-runtime-adapter.ts
        │  protocol mapping + redaction + expiry validation
        ▼
CollaborationRuntime.proposeCollaboration({ mode: "network" })
        │
        ▼
append-only EventStore → NetworkSnapshot → A2A Task View
```

当前暴露的三个受控接口是：

- `collaboration:a2a-agent-card`：只读本地脱敏 Agent Card，不包含 prompt、session history、凭证或 private vault。
- `collaboration:a2a-task-submit`：把 A2A Task Request 转成统一 `BuddyTaskEnvelope`，再进入唯一的 `CollaborationRuntime`；不会创建第二个 Coordinator。
- `collaboration:a2a-task-get`：从统一任务/网络投影读取状态、Artifact 引用、ExecutionRef 和 Verification 状态。

网络任务仍拒绝 `private:*`、`credential:*`、`secret:*` 数据范围；context refs 只能是稳定的 `artifact:`、`resource:`、`room:` 或 `task:` 引用。发现 Agent Card 不代表获得执行授权，正式跨组织接入前仍需签名 Card、Federated Room Grant、nonce/expiry/revoke 和重放验收。当前 A2A facade 会把本地未签名 Card 标记为 `unverified`，只允许本地 Peer Directory 中 `known/trusted` 的发送方进入任务提案，按 `requestId` 做同请求幂等，并拒绝把同一 nonce 绑定到不同任务或把任务发送给其他 Buddy；这些检查仍不能替代生产公钥信任。

### MCP capability governance

MCP 继续作为 Capability Provider/Tool adapter，而不是长期任务协议。主进程从现有 MCP client 读取脱敏的 server/tool 状态，形成 `mcpCapabilities` 投影：

```text
MCP server/tool
  ├─ providerId: mcp:<server>
  ├─ roomId: personal-room（后续由 Room Grant 显式扩大）
  ├─ dataScopes: room:personal-room
  ├─ allowedActions: mcp:call:<server>:<tool>
  └─ approval: before_external_commit
```

该投影进入助理工作台“能力与策略”页，用于发现、审计和策略计算；它不包含 OAuth access token、refresh token、命令参数或原始 MCP 内容，也不允许 Renderer 直接调用 MCP transport。需要长期委托或跨 Buddy 协作时，必须重新进入 `Task → Policy → Approval → ExecutionRef → Evidence` 链路。

### Relay 授权与恢复边界

Relay 的授权顺序固定为：`credential → scope → FederatedRoomGrant → capability token → expiry/presence → nonce/replay → delivery`。`RemoteRelayServer` 将 nonce 以发送方、scope 和 nonce 组成的稳定键持久化；同一 `messageId` 可以在 endpoint 暂时离线后通过 outbox 重试，不同 `messageId` 复用 nonce 会被拒绝。失败投递只保存脱敏事件和 delivery metadata；完整 envelope 只有显式注入加密 codec 时才进入加密 persistence。`CollaborationRuntime` 在显式配置 `relayCapabilitySecret` 或 `OPENBUDDY_RELAY_CAPABILITY_SECRET` 时，会为每个 network award 生成绑定 `subject + community/organization/room + taskId + capability + dataScopes + allowedActions + expiry` 的 capability token；没有该 secret 的 local-only 模式保持兼容，但安全 Relay verifier 会拒绝缺失 token 的发送。`RemoteRelayTransport.syncAuthorityState()` 现在支持基于 `RelaySyncCursor` 的 revoke/presence 增量查询；默认只拉取并返回 feed，不会把记录回写同一 Relay，只有显式 `applyToRelay` 才执行 relay-to-relay 复制。可插拔 `RelaySyncScheduler` 负责首次立即同步、定时同步、失败退避和 JSON 游标持久化，并在本地 projection 成功后才提交游标；`CollaborationRuntime` 只有在显式注入远端 transport 且设置 `relaySync.enabled` 时启动该调度器，默认 local-only 模式不会产生公网行为。同步结果中的 Presence 会投影到本地 Agent Directory，revoke feed 会进入网络 authority 审计投影，并使匹配的本地 Federated Room Grant 失效；credential/capability 的完整 denylist enforcement 仍需接入组织级 authority 与本地 token registry 后才能宣称跨组织授权已完全收敛。
