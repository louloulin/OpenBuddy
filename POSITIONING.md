# 定位声明(POSITIONING)

> 一页纸。写给**用户**看,不是写给 roadmap 看的。
> 依据:`plan1029.md` §2 的差异化分析 + §4 候选 B。

## 一句话

**OpenBuddy 是一个可自托管、可审计的企业桌面 AI 邮件/协作 Agent —— 让 AI 在你控制的邮箱与协作空间里干活,并且每一步都留痕。**

## 给谁

- 企业 IT / 安全团队:需要把 AI 放进邮件与协作流,但**数据不能出内网**、行为**必须可审计**。
- 想自托管的团队:不想把凭据交给 SaaS,也不想被按席位收费。
- 独立开发者 / 研究者:想读懂并改造一个完整的桌面 Agent 主机(不是玩具 demo)。

## 解决什么

市面上的桌面 Agent 助手大多止步于"能聊天 + 能调工具"。真正难做、也真正值钱的三件事:

1. **接得住真实邮箱** —— IMAP / SMTP / Gmail API / Graph API / JMAP 五条真实协议链路,不是玩具 API。
2. **企业身份能落进去** —— Casdoor OIDC（主进程 5 个模块真实接线）、多租户隔离、NewAPI 网关、审计账本。SCIM v2 / SAML 2.0 目前是**有测试但未接线的种子实现**（2026-10-28 随 experimental/ 归档，git 历史可找回）—— 本文不把它们说成已交付。
3. **行为能追回来** —— 本地审计日志 + 租户级审计链 + 工具调用留痕,出了问题能回答"谁、在什么时候、对哪个邮箱、做了什么"。

## 凭什么不一样

| | 大多数桌面 Agent | OpenBuddy |
|---|---|---|
| 部署 | SaaS,数据出境 | **Electron 桌面端 + 自托管网关**,BYOK |
| 审计 | 服务端黑盒日志 | **本地审计账本 + 租户隔离,可导出** |
| 企业身份 | 无 / 事后补 | **Casdoor OIDC 已接线**；SCIM / SAML 为未接线种子 |
| 邮件 | 只能收发单封 | **五协议链路 + 真实投递验收脚本** |
| 代码 | 闭源 | **MIT,350K 行可读可 fork** |

## 不是什么

- **不是** WorkBuddy 的"开源替代品"。我们不比拼谁的 UI 更像谁。
- **不是** 大而全的办公套件。只做 Agent 主链路 + 邮件/协作这一层。
- **不是** 承诺企业级 SLA 的商业产品。签名、公证、支持渠道都还在补。

## 差异化的实体厚度

不是口号,是仓里的东西:

- `packages/capability/openbuddy-email` —— **8,328 行**,是其余四个 capability 包总和的 7 倍。
- `scripts/email/` —— 自托管 IMAP / SMTP MCP server。
- `evals/node/run_{imap_smtp,gmail_api,graph_api,jmap_api}_acceptance.mjs` —— 四条真实协议验收链。
- `scripts/verify-tenant-boundaries.sh` / `audit-enterprise-release` —— 租户隔离与发布审计,现成可跑。

## 现在能怎么用

- **下载**:`/download` 页的安装包(SHA-256 随包发布)。
- **从源码构建**:`git clone --recurse-submodules && pnpm install && pnpm electron:dev`。
- **读代码**:MIT 协议,没有 telemetry,没有黑盒。

## 对内纪律

对外讲上面这套;对内按**"自己的平台"**的纪律过活 —— 不追 star,不追 WorkBuddy 的功能表,不做没人用的功能。
P3 的决策门以真实下载与 issue 数据为准(见 `plan1029.md` §6)。
