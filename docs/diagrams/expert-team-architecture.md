# OpenBuddy 专家团迁移与运行时架构图

> 说明：图中“当前”表示仓库已存在的可观察实现；“目标”表示 WorkBuddy 专家团迁移和 Pi-first Team runtime 的设计建议。WorkBuddy 私有后端、商业账号、授权服务和未公开协议不在图中展开。

实现落点：本地导入服务位于 `electron/main/workbuddy-import.ts`，通过 `electron/main/ipc.ts` 和 `electron/preload/index.ts` 暴露 `workbuddy_import_preview/confirm/status/rollback`，Renderer 入口位于 `src/components/experts-panel/experts/ExpertsTab.tsx`。导入只写 `~/.pi/agent/workbuddy-experts` 及 journal，结果带 `autoActivated: false`；Team coordinator、mailbox 和持久化 member session 仍是后续 Pi-first 设计。

## 1. 总体架构

```mermaid
flowchart TB
  user[用户]

  subgraph wb[WorkBuddy 本机可观察配置 ~/.workbuddy]
    wb_manifest[plugins/marketplaces/*/plugins/*/plugin.json]
    wb_agents[agents/*.md]
    wb_skills[skills/*/SKILL.md]
    wb_assets[avatars/*]
    wb_scenes[cb_teams_marketplace/scenes.json]
    wb_recommend[skill-recommend-experts/connectors]
    wb_cache[app/cache/experts metadata/version]
    wb_selection[experts/custom experts.json]
    wb_schema[SQLite migrations]
  end

  subgraph import[已实现：WorkBuddy 本地导入层]
    reader[workbuddy-import.ts\n只读 + allowlist 投影]
    parser[PluginManifestParser\nJSON + 路径规范化]
    validator[Manifest/Prompt/Dependency Validator]
    conflict[ConflictDetector\nID + version + hash]
    preview[Import Preview\n用户确认]
    staging[staging\n隔离目录 + 原子 rename]
    journal[import journal\nrollback / recovery / idempotency]
    adapter[Expert manifest index\n-> ExpertItem / Pi resources]
  end

  subgraph electron[OpenBuddy Electron Main]
    ipc[IPC handlers + preload allowlist\nworkbuddy_import_*]
    host[agent-host.ts\nPi host + TeamRunner]
    bridge[脱敏 Team event bridge]
  end

  subgraph pi[Pi Runtime]
    loader[DefaultResourceLoader\nextensions / skills / prompts]
    lead[Lead AgentSession]
    coordinator[Team Coordinator\n状态机 + semaphore + pause/resume]
    member1[Member AgentSession\nagentRef=plugin/agent]
    member2[Member AgentSession\nagentRef=plugin/agent]
    session[SessionManager\n持久化或 inMemory]
    hooks[subagent/start|end\nagent/start hooks]
    mailbox[Mailbox\n消息中转 + correlation]
    tasks[Task Board\nbacklog/todo/doing/review/done]
  end

  subgraph renderer[OpenBuddy Renderer]
    market[ExpertsPanel\nExpertCard / Detail / Import Preview]
    pending[pending-expert-store]
    teamstore[team-runtime-store\n版本化 event snapshot]
    teamui[TeamStatusView / ColleaguesPanel]
    chat[ChatView / Composer]
  end

  user --> market
  wb_manifest --> reader
  wb_agents --> reader
  wb_skills --> reader
  wb_assets --> reader
  wb_scenes --> reader
  wb_recommend --> reader
  wb_cache --> reader
  wb_selection --> reader
  wb_schema --> reader
  reader --> parser --> validator --> conflict --> preview
  preview -->|确认安装| staging
  staging --> journal
  staging --> adapter
  adapter --> loader
  adapter --> market
  market -->|用户明确召唤| pending --> ipc --> host
  host --> lead
  lead -->|team_create / route| coordinator
  coordinator --> member1
  coordinator --> member2
  coordinator <--> mailbox
  coordinator <--> tasks
  member1 <--> mailbox
  member2 <--> mailbox
  lead --> session
  member1 --> session
  member2 --> session
  member1 --> hooks
  member2 --> hooks
  coordinator --> bridge --> teamstore --> teamui
  lead --> chat
  host --> loader
  loader --> lead
  market -.不自动激活.-> chat
```

## 2. 专家团迁移时序

```mermaid
sequenceDiagram
  autonumber
  actor U as 用户
  participant UI as ExpertsPanel
  participant S as WorkBuddySourceReader
  participant P as Manifest/Prompt Parser
  participant V as Validator
  participant C as ConflictDetector
  participant I as ImportStager + Journal
  participant R as Pi ResourceLoader
  participant H as OpenBuddy Main/IPC
  participant X as Lead AgentSession

  U->>UI: 选择“导入 WorkBuddy 专家团”
  UI->>S: 请求预览（默认 ~/.workbuddy）
  S-->>UI: 只读候选列表（pluginId/type/version/hash）
  U->>UI: 选择一个 Team
  UI->>P: 解析 plugin.json、agents、skills、avatars、scenes
  P->>V: 交付归一化 ExpertManifest
  V->>V: schema / 路径 / lead / member / prompt / 依赖校验
  V->>C: 提交 pluginId + agentId + version + hash
  C-->>UI: new / same / upgrade / conflict / blocked
  UI-->>U: 展示成员、Skill、场景、冲突、权限和风险
  U->>UI: 确认安装（不等于激活）
  UI->>I: 创建隔离 staging + import journal
  I->>I: 复制 allowlist 资源并校验 hash
  I->>I: 原子 rename + 更新 manifest pointer
  I-->>UI: installed / degraded / failed
  UI->>R: reload / refresh resources
  R-->>H: plugin/readiness snapshot
  H-->>UI: 可用状态和缺失依赖
  U->>UI: 点击“召唤”
  UI->>H: pending-expert-store -> pi_set_session_expert
  H->>X: 以 lead AgentSession 启动 Expert persona
  X-->>U: 首轮 prompt 或路由确认
```

## 3. Team 数据模型与事件

```mermaid
erDiagram
  TEAM ||--o{ TEAM_MEMBER : contains
  TEAM ||--o{ TEAM_MESSAGE : owns
  TEAM ||--o{ TEAM_TASK : tracks
  TEAM_MEMBER ||--o{ TEAM_MESSAGE : sends
  TEAM_MEMBER ||--o{ TEAM_TASK : owns
  TEAM_MEMBER ||--o| MEMBER_SESSION : runs
  EXPERT_MANIFEST ||--o{ AGENT_DEFINITION : declares
  EXPERT_MANIFEST ||--o{ SKILL_DEPENDENCY : requires
  EXPERT_MANIFEST ||--o{ SCENE_REF : appears_in
  EXPERT_MANIFEST ||--o{ IMPORT_RECORD : imported_as

  TEAM {
    string team_id PK
    string plugin_id
    string lead_agent_id
    string status "created active paused completed failed archived"
    int schema_version
    string config_json
    datetime created_at
    datetime updated_at
  }
  TEAM_MEMBER {
    string member_id PK
    string team_id FK
    string agent_ref
    string role "lead member"
    string status "idle working waiting completed error killed"
    string run_id
    string session_id
    string current_task_id
  }
  MEMBER_SESSION {
    string session_id PK
    string member_id FK
    string session_path
    string persistence_mode "disk inMemory"
    string last_event_sequence
    datetime updated_at
  }
  TEAM_MESSAGE {
    string message_id PK
    string team_id FK
    string from_member_id FK
    string to_member_id FK
    string kind
    string payload_ref
    string correlation_id
    int sequence
    datetime created_at
  }
  TEAM_TASK {
    string task_id PK
    string team_id FK
    string owner_member_id FK
    string status "backlog todo doing review done blocked"
    int priority
    string blocked_by_json
    string result_ref
  }
  EXPERT_MANIFEST {
    string plugin_id PK
    string version
    string expert_type "agent team"
    string lead_agent_id
    string manifest_hash
    string source_signature
    string readiness
  }
  AGENT_DEFINITION {
    string agent_ref PK
    string plugin_id FK
    string file_stem
    string prompt_hash
    string prompt_contract_status
  }
  SKILL_DEPENDENCY {
    string skill_id PK
    string plugin_id FK
    string relative_path
    string status
  }
  SCENE_REF {
    string scene_id PK
    string plugin_id FK
    string mode
    string prompt_set_hash
  }
  IMPORT_RECORD {
    string import_id PK
    string plugin_id FK
    string source_root
    string old_version
    string new_version
    string status
    string journal_path
    datetime created_at
  }
```

事件统一使用 `team_event` envelope：

```json
{
  "schemaVersion": 1,
  "type": "member_status | message | task_updated | paused | resumed | finished",
  "teamId": "team-id",
  "memberId": "plugin/agent-id",
  "runId": "run-id",
  "sessionId": "session-id",
  "sequence": 42,
  "payload": { "status": "working" },
  "createdAt": "2026-08-29T00:00:00.000Z"
}
```

## 4. 失败恢复和回滚

```mermaid
flowchart TD
  start[开始导入] --> discover[发现并生成 source snapshot]
  discover --> validate{校验通过?}
  validate -->|否| previewBlocked[预览 blocked\n显示缺失项，不写入]
  validate -->|是| stage[写入 staging]
  stage --> hash{hash 校验通过?}
  hash -->|否| cleanup[删除 staging\n记录失败原因]
  hash -->|是| journal[写入 import journal\n记录旧指针和新资源]
  journal --> rename[原子 rename 资源目录]
  rename --> pointer[更新 manifest pointer]
  pointer --> reload[刷新 Pi ResourceLoader]
  reload --> ready{readiness=ready?}
  ready -->|是| installed[安装完成\n等待用户显式激活]
  ready -->|否| degraded[安装 degraded\n保留可诊断状态]
  rename -.进程崩溃.-> recover[启动时扫描 journal]
  pointer -.reload 失败.-> rollback[按 journal 反向恢复旧指针]
  recover --> recoverDecision{新旧资源完整?}
  recoverDecision -->|新资源完整| resume[恢复 pointer 更新]
  recoverDecision -->|不完整| rollback
  rollback --> cleanup
  degraded --> userChoice{用户动作}
  userChoice -->|补依赖| stage
  userChoice -->|回滚| rollback
  userChoice -->|保留草稿| draft[保留 staging metadata\n不进入可运行目录]
```

回滚原则：manifest pointer、资源目录和 Team/Expert 注册必须以 journal 中的同一 `importId` 关联；不删除用户原有版本，不自动撤销用户已授权 connector，不重放成员 session 中可能产生副作用的工具调用。
