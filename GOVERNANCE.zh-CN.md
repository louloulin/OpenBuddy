# Project Governance

[English](GOVERNANCE.md) · **简体中文**

### 角色

OpenBuddy 使用**联邦式治理模型**,有四个明确角色。同一个人可担任多个角色;角色通过贡献获得,非指派。

#### 用户(Users)

任何跑 OpenBuddy 的人。无义务,无权限。

#### 贡献者(Contributors)

任何**代码或文档 PR 被合并过**的人。贡献者:

- 出现在 GitHub Contributors 图
- 首个 PR 合并 commit 带 🎉
- 持续翻译工作后可被授予特定 `src/locales/<locale>/` 目录的 `write` 权限
- 待项目迁到组织账号后,可被邀请加入 `contributors` 团队

#### 评审者(Reviewers)

通过 ≥ 3 个月、≥ 10 个 PR 评审展现评审能力的贡献者。评审者:

- 收到其领域 PR 的 `@mention` 通知
- 可在其评审领域请求改动 / 通过 PR
- 列于 [`MAINTAINERS.md`](MAINTAINERS.md)

#### 维护者(Maintainers)

拥有**战略权限**的长期贡献者。维护者:

- 整个仓库有合并权
- 可在 RFC 中投票
- 可增减评审者
- 负责发布
- 列于 [`MAINTAINERS.md`](MAINTAINERS.md)

没有"核心团队"概念——每位维护者权限相同,按领域非正式分工。

### 团队

`louloulin` 目前是个人账号,GitHub 团队尚不存在。下表是**规划中**的归属划分,
待项目迁到组织账号后这些句柄才生效。在此之前,
[`.github/CODEOWNERS`](.github/CODEOWNERS) 将所有路径指向 `@louloulin`。

| 团队 | 用途 |
|---|---|
| `@louloulin/maintainers` | 全局合并权 + RFC 投票 |
| `@louloulin/security` | 安全响应团队(见 [`SECURITY.md`](SECURITY.md)) |
| `@louloulin/community` | 社区 + 文档 + 翻译 |
| `@louloulin/build` | 构建、CI、打包、基础设施 |
| `@louloulin/runtime` | Cordis runtime、storage、plugin host |
| `@louloulin/main` | Electron main + preload(安全关键) |
| `@louloulin/ui` | 渲染端 + UI 基元 |
| `@louloulin/auth` | Casdoor + permission |
| `@louloulin/agents` | 多 Agent + collaboration 包 |
| `@louloulin/capability` | capability 包 |
| `@louloulin/enterprise` | payment + SAML + SCIM + webhook-outbox + admin portal |
| `@louloulin/eval` | 评测 + 基准 + 分析 |
| `@louloulin/i18n-<locale>` | 每 locale 翻译维护者 |
| `@louloulin/former-maintainers` | 名誉 alumni |

路径与领域的映射见 [`.github/CODEOWNERS`](.github/CODEOWNERS);待组织账号建立后,
其 owner 列会从 `@louloulin` 切换为上表的团队。

### 决策

#### 日常

- 惰性共识。维护者提案,贡献者 7 天响应,默认 = 通过。
- 例行改动(bug 修复、文档、重构)无需投票即可发布。

#### 重大变更(RFC 流程)

影响以下范围的变更:

- 公开 API 表面(IPC 通道、包导出)
- Monorepo 结构(DAG、toolchain)
- 许可证
- 发布节奏
- 战略方向
- 安全模型

走 RFC 流程:

1. **提案** —— 在 GitHub Discussion 开贴,加 `rfc:` 标签。
2. **讨论** —— 至少 7 天公开讨论窗口。
3. **决定** —— 由维护者发起投票:👍 / 👎 / 中立。
4. **实施** —— 指派维护者开 PR,社区评审。
5. **发布** —— 合并后将讨论标记为 "Accepted" 或 "Rejected"。

投票规则:

- 仅当前 `@louloulin/maintainers` 成员有投票权。
- 简单多数通过。
- 投票窗口:14 天。
- 若出现实质性疑虑,维护者可发起延长讨论的投票。

#### 紧急情况

对关键安全或数据丢失问题,维护者可在无 RFC 的情况下发布补丁。该变更在 24 小时内公开记录。

### 发布

- **节奏**:每 2–4 周,机会主义。
- **流程**:见 [`.github/workflows/release.yml`](.github/workflows/release.yml)。由 `workflow_dispatch` 用新 tag 触发。
- **说明**:自动从 [`CHANGELOG.md`](CHANGELOG.md) 抽取。
- **推广**:候选发布先给内部用户用 ≥ 3 天,然后公开发布。

### 冲突解决

1. **技术分歧?** 在 PR 或 RFC 讨论。以数据和基准为准。
2. **方向分歧?** 开 Discussion,不开 PR。
3. **个人分歧?** 升级到 `conduct@openbuddy.dev`,按 [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md)。
4. **僵局?** 任意两位维护者可发起投票。

持续违反行为准则的维护者,可由其他维护者 2/3 多数票移除。

### 增减维护者

#### 成为维护者

1. 担任评审者 ≥ 6 个月。
2. 跨多个领域合并过 ≥ 30 个 PR。
3. 由现有维护者提名。
4. 在公开 Discussion 中获 2/3 当前维护者同意。
5. 加入 `@louloulin/maintainers`,列于 [`MAINTAINERS.md`](MAINTAINERS.md)。

#### 卸任

维护者可随时提 PR 从 [`MAINTAINERS.md`](MAINTAINERS.md) 移除自己,转入 `@louloulin/former-maintainers`。

#### 不活跃移除

连续 12 个月无合并 PR、无评审活动、无 Discussion 参与的维护者,在友好 ping 后转入 `@louloulin/former-maintainers`。

### 组织所有权

`louloulin` GitHub org 由维护者团队集体所有。组织级 admin 由 ≥ 3 位维护者持有(多签风格)。无单一个人拥有组织。

### 参考

本治理借鉴自:

- [Rust 语言治理](https://www.rust-lang.org/governance)
- [Node.js 项目治理](https://nodejs.org/en/about/governance)
- [Python 软件基金会](https://www.python.org/psf/)
- [Mozilla 模块所有权](https://www.mozilla.org/en-US/about/governance/policies/module-ownership/)

---

<div align="center">

**Good governance is boring governance. / — 好治理就是无聊的治理。**

</div>
