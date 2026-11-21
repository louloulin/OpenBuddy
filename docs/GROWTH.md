# 增长与传播计划：如何让更多人知道 OpenBuddy

> 目标不是"刷存在感"，而是让正确的人在一分钟内理解：**这是一个能让每个人拥有自己的 Buddy 的本地优先桌面工作台**。
> 所有对外表述必须与 [功能状态总表](FEATURE-STATUS.md) 一致：当前是未签名预览版，不声称已发布、已公证或跨平台安装成功。

## 一句话定位

| 语言 | 主张 |
| :--- | :--- |
| 中文 | **OpenBuddy — 让每个人都能拥有自己的 AI Buddy。本地优先，数据在你手里。** |
| English | **OpenBuddy — Your buddy. On your machine. Local-first AI workspace with your keys, your data.** |

这句话要同时出现在：README 首屏、`package.json` description、GitHub 仓库简介、Release 说明、社区帖子的第一行。

## 目标人群（按优先级）

| 人群 | 他们痛在哪里 | 我们怎么说 |
| :--- | :--- | :--- |
| 隐私敏感的开发者 / 专业人士 | 不想把代码和文档喂给云端 | 本地会话 + BYOK + 审批 + 受保护路径 |
| 想给 AI 一个"人设"的职场人 | 每次都要重新解释背景 | 专家 / 技能 / 项目说明让 Buddy 记住你 |
| 本地模型爱好者 | 工具不支持 OpenAI 兼容端点 | 本地模型配置，可全程离线 |
| 开源工具尝鲜者 | 想要能自托管的桌面 Agent | MIT、Electron + Pi、可自己构建验证 |

## 渠道矩阵

### 1. GitHub（基础盘，先做好）

- 仓库简介写上一句话定位；Topics 建议：`local-first`、`ai-agent`、`desktop-app`、`electron`、`byok`、`personal-ai`、`open-source`、`pi-coding-agent`。
- `package.json` 补齐 `description` / `homepage` / `repository` / `keywords` / `bugs` —— 已被本轮优化覆盖。
- README 首屏必须有：**价值主张 → 60 秒上手 → 截图 / GIF → 诚实的构建状态**；技术细节下沉到 [架构说明](architecture.md)。
- 开一批 `good first issue`（文档翻译、Buddy 模板、截图回归）；贡献入口见 [CONTRIBUTING.md](../CONTRIBUTING.md)。
- Release 每条都写"这次你的 Buddy 多了什么"，而不是只列 commit 类型。

### 2. 演示资产

静态截图已就位（`docs/screenshots/`），**36 秒演示 GIF 也已做好**（`docs/demo.gif`，在 README 首屏）：

1. **演示 GIF** ✅：选模板 → 提问 → 工具审批 → 产物落在工作台。用真实 Electron 构建录制（`pnpm demo:gif`），不伪造界面。
2. **Buddy 模板卡图**：3 张模板（写作 / 代码 / 资料）拼成一张图，用于社媒。
3. **对比图**：一张图说明“聊天网页 vs IDE 插件 vs OpenBuddy”。
4. **架构图**：复用 README 的 mermaid，单独导出 SVG 供文章引用。

### 3. 英文社区

| 渠道 | 标题模板 | 要点 |
| :--- | :--- | :--- |
| Hacker News | `Show HN: OpenBuddy – a local-first desktop buddy powered by Pi` | 首条评论讲清楚 BYOK / 本地数据 / 未签名预览；贴 GIF，不贴安装包链接诱饵 |
| Product Hunt | `OpenBuddy – your AI buddy, on your machine` | Gallery 用模板卡 + GIF；maker comment 讲"为什么本地优先" |
| Reddit r/LocalLLaMA | `I built a desktop buddy that works with local models and keeps keys in the OS keychain` | 强调 OpenAI 兼容端点与离线路径 |
| Reddit r/SideProject | 故事向：为什么想要一个"记得我"的 AI | 少术语，多截图 |
| X / Twitter | 6–8 条 thread：痛点 → GIF → 五个部分 → 开源地址 → 求模板 | 每条配一张截图 |

### 4. 中文社区

| 渠道 | 角度 | 形式 |
| :--- | :--- | :--- |
| 掘金 | 《我给 AI 做了个"住在本机"的 Buddy》 | 技术 + 产品叙事，附架构图 |
| V2EX | 本地优先 / 隐私 / BYOK 讨论 | 干净的功能清单 + 构建方法 |
| 少数派 | "把 AI 助手变成自己的长期搭档" | 场景化截图，面向非开发者 |
| 知乎 | "为什么 AI 助手应该是本地优先的" | 观点文，结尾引产品 |
| B 站 | 60 秒演示 + 模板创建过程 | 视频比文字更能展示 Buddy 概念 |

### 5. SEO / 可搜索性

- 文档标题和首段自然包含关键词：本地 AI 助手、桌面 AI Agent、BYOK、个人 AI buddy、离线模型、工具审批。
- `README.en.md` 必须是真正的英文产品页，而不是迁移说明（本轮已重写）。
- 每个文档页都有一个明确的 H1 和互相链接的导航块；链接检查由 `pnpm check:docs` 把关。

## 增长飞轮

```text
Buddy 模板好用 → 用户导出分享 → 新用户零门槛导入
      ↑                                   ↓
  模板生态更丰富 ← 更多人创造自己的 Buddy ─┘
```

产品侧要为此提供：模板导出 / 导入、Buddy 卡片首页、分享链接。当前这些仍在路线图阶段，宣传时不要说成已上线。

## 发布节奏与话术

| 阶段 | 对外话术 | 禁止说法 |
| :--- | :--- | :--- |
| 当前预览 | "未签名预览版，可自行构建或从 Release 取审核包" | "正式发布""已公证""开箱即用" |
| 首个签名版 | "macOS 已签名公证 / Windows 已签名，可放心安装" | 未验证平台的安装承诺 |
| 模板市场 | "一键拥有别人的 Buddy 配置" | 暗示云端同步已实现 |

## 衡量指标

| 指标 | 看什么 | 目标 |
| :--- | :--- | :--- |
| GitHub Stars / Fork | 关注度与共建意愿 | 持续增长 |
| 文档到达率 | 从社媒到 README 的点击 | 首屏 10 秒内看懂定位 |
| 模板分享率 | 导出 / 导入次数 | 每 10 个活跃 Buddy 至少 1 次分享 |
| 首屏观看率 | README 首屏 GIF 的播放完成度 | 多数访客看完 36 秒 |
| 首次 Buddy 耗时 | 新手引导埋点 | < 60 秒 |
| 7 日回访 | 是否回来找同一个 Buddy | 逐月提升 |

## 诚实边界（必须遵守）

- 不伪造下载量、用户评价或演示数据。
- 截图来自本地 fixture，要在图注里说明，不能包装成真实用户数据。
- 未签名 / 未公证 / Linux 无安装包，要在 README 与 Release 里明确写出。
- 宣传"本地优先"时，同时说明模型请求仍会发往用户自己配置的服务商（见 [隐私说明](privacy.md)）。
