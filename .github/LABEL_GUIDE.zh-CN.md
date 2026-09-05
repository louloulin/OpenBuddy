# Label Guide

[English](LABEL_GUIDE.md) · **简体中文**

### 类型 label(选一个)

| Label | 颜色 | 含义 | 自动加? |
|---|---|---|---|
| `bug` | `#d73a4a` | 有东西坏了 | 否 |
| `enhancement` | `#a2eeef` | 新功能或改进 | 否 |
| `documentation` | `#0075ca` | 仅文档(无代码改动) | 否 |
| `tests` | `#bfdadc` | 新增或修复测试 | 否 |
| `performance` | `#fbca04` | 性能改进 | 否 |
| `security` | `#b60205` | 安全相关 | 否 |
| `ui` | `#e99695` | UI / 视觉改动 | 否 |
| `a11y` | `#5319e7` | 可访问性 | 否 |
| `i18n` | `#1d76db` | 翻译 / 本地化 | 否 |
| `ci` | `#0e8a16` | CI / 构建 / 工具链 | 否 |
| `plugin` | `#c2e0c6` | 新能力包 | 否 |
| `eval` | `#d4c5f9` | 评测 / 基准 / 研究 | 否 |
| `refactor` | `#cccccc` | 代码重构 | 否 |
| `chore` | `#eeeeee` | 工具 / 依赖 / 配置 | 否 |

### 区域 label(可多个)

| Label | 颜色 | 含义 |
|---|---|---|
| `area: renderer` | `#7057ff` | `src/` 改动 |
| `area: main` | `#7057ff` | `electron/main/` 改动 |
| `area: preload` | `#7057ff` | `electron/preload/` 改动 |
| `area: ipc` | `#7057ff` | 新增或改动 IPC 通道 |
| `area: storage` | `#7057ff` | `@openbuddy/runtime-storage` |
| `area: cordis` | `#7057ff` | `@openbuddy/runtime-cordis` |
| `area: auth` | `#7057ff` | `@openbuddy/auth-*` |
| `area: agent` | `#7057ff` | Pi agent 运行时 |
| `area: ui-shell` | `#7057ff` | `@openbuddy/ui-shell` |
| `area: ui-sidebar` | `#7057ff` | `@openbuddy/ui-sidebar` |
| `area: ui-settings` | `#7057ff` | `@openbuddy/ui-settings` |
| `area: ui-workbench` | `#7057ff` | `@openbuddy/ui-workbench` |
| `area: capability` | `#7057ff` | `@openbuddy/capability-*` |
| `area: collab` | `#7057ff` | `@openbuddy/collaboration-*` |
| `area: enterprise` | `#7057ff` | `@openbuddy/payment`、`saml`、`scim`、`webhook-outbox` |
| `area: admin-portal` | `#7057ff` | `apps/admin-portal/` |
| `area: docs` | `#7057ff` | `docs/` |

### 优先级 label(选一个)

| Label | 颜色 | 含义 |
|---|---|---|
| `priority: critical` | `#b60205` | 放下所有,尽快发 |
| `priority: high` | `#d93f0b` | 下一冲刺 |
| `priority: medium` | `#fbca04` | 本季度 |
| `priority: low` | `#0e8a16` | 有空再做 |

### 状态 label(机器人自动加)

| Label | 颜色 | 含义 |
|---|---|---|
| `status: needs-triage` | `#ededed` | 等待维护者评审 |
| `status: needs-info` | `#fef2c0` | 等待作者答复 |
| `status: needs-design` | `#d4c5f9` | 等待设计讨论 |
| `status: needs-repro` | `#f9c513` | 等待复现 |
| `status: blocked` | `#b60205` | 无法推进(链接阻塞项) |
| `status: in-progress` | `#0e8a16` | 已关联 PR 或分支 |
| `status: review` | `#1d76db` | 评审中 |
| `status: ready-to-merge` | `#0e8a16` | 所有检查通过,等待合并 |
| `status: stale` | `#cccccc` | 60+ 天无活动 |

### 工作流 label

| Label | 颜色 | 含义 |
|---|---|---|
| `good first issue` | `#7057ff` | 入门友好,有人带 |
| `help wanted` | `#008672` | 需要额外关注 |
| `rfc:` | `#d4c5f9` | 请求评论(≥7 天讨论) |
| `roadmap:` | `#d4c5f9` | 影响公开路线图 |
| `breaking` | `#b60205` | 破坏性改动(semver-major) |
| `duplicate` | `#cccccc` | 关闭另一个 Issue |
| `wontfix` | `#ffffff` | 不实现 |

### Locale label

| Label | 颜色 | 含义 |
|---|---|---|
| `locale: en` | `#1d76db` | English |
| `locale: zh-CN` | `#1d76db` | 简体中文 |
| `locale: ja` | `#1d76db` | 日本語 |
| `locale: ko` | `#1d76db` | 한국어 |
| `locale: es` | `#1d76db` | Español |
| `locale: de` | `#1d76db` | Deutsch |
| `locale: fr` | `#1d76db` | Français |

### 如何打 label

- **提 Issue?** 加一个 `type:` label 和适用的 `area:` label。
- **审 PR?** 开始时加 `status: review`,通过后改 `status: ready-to-merge`。
- **分流?** 先加 `status: needs-triage`,调查后再细化。

### Label 机器人

机器人在 60 天无活动后自动加 `status: stale`,对非维护者的新 Issue 自动加 `status: needs-triage`。配置在 `.github/stale.yml`。

---

<div align="center">

**Good labels = happy maintainers. / Label 打得好,维护者笑开颜。**

</div>
