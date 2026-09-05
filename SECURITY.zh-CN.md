# Security Policy

[English](SECURITY.md) · **简体中文**

### 支持的版本

我们只为**最新次版本**与上一个次版本发布安全补丁。更老版本只能尽力修复。

| 版本 | 是否支持 |
|---|---|
| `0.15.x`(最新) | ✅ |
| `0.14.x` | ✅ |
| `< 0.14` | ❌ |

### 上报漏洞

**请勿在公开 GitHub Issue 中提交安全漏洞。**

请使用以下私密渠道之一:

1. **GitHub Security Advisories**(首选)— [上报漏洞](https://github.com/louloulin/OpenBuddy/security/advisories/new)
2. **邮件** — `security@openbuddy.dev`(PGP 公钥见 [`docs/SECURITY-PGP.md`](docs/SECURITY-PGP.md))
3. **Discord** — `@security` 维护者团队(仅私聊)

报告时请附上:

- 清晰的问题描述及其影响
- 复现步骤(优先附 PoC 代码或截图)
- 受影响版本
- 你的名字 / 昵称(用于致谢,或填 "anonymous")

### 响应时间

| 阶段 | 目标 |
|---|---|
| 确认收到 | 收到后 **48h** 内 |
| 初步评估 | **5 个工作日内** |
| 严重问题补丁 | **7 天内** |
| 高危问题补丁 | **30 天内** |
| 中低危问题补丁 | 下一个发布周期 |
| 公开披露 | 补丁发布后 + 14 天缓冲 |

### 致谢

我们为遵循协调披露的安全研究者维护公开致谢页。研究者可随时选择退出。

### 内置安全特性

OpenBuddy 开箱即提供以下保护:

| 特性 | 位置 | 作用 |
|---|---|---|
| **上下文隔离** | Electron 渲染端 | `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` |
| **IPC 白名单** | `electron/preload/index.ts` | 每个通道都显式枚举,禁止动态调用 |
| **文件夹级信任** | `@openbuddy/capability-folder-trust` | 文件操作前必须显式授权每个文件夹 |
| **能力级策略** | `@openbuddy/capability-authorization` | 每个 Cordis 能力声明所需权限 |
| **CSP** | `index.html` | 严格默认 `default-src`,禁止内联脚本 |
| **OIDC PKCE** | `@openbuddy/auth-casdoor` | 桌面端 SSO 使用 PKCE 授权码模式,无 client secret |
| **Token 轮换** | Casdoor refresh 流 | 每次使用都轮换 refresh token |
| **事务性 Outbox** | `@openbuddy/webhook-outbox` | Webhook 至少一次投递,带幂等键 |
| **本地优先审计** | `@openbuddy/runtime-storage` | 每个特权操作记录到防篡改的本地账本 |
| **依赖扫描** | `.github/workflows/release.yml` | 每个 PR 都在 CI 跑 `pnpm audit` |
| **镜像配置** | `electron-builder.yml` | electron-builder 下载固定走 npmmirror,不走 github |

### 威胁模型(摘要)

**范围之内:**

- 渲染端逃逸到主进程
- preload bridge 暴露内部 IPC
- Provider SDK 密钥通过日志/错误泄露
- 超出授权文件夹的本地文件访问
- 通过 prompt 注入窃取 Casdoor / NewAPI token
- MCP 连接器沙箱逃逸

**范围之外:**

- 用户本人(BYOK 意味着用户拥有自己的密钥)
- Provider 端安全(Anthropic、OpenAI 等)
- Pi coding agent 运行时本身(在上游提报)

### 安全加固清单(自托管/企业版)

- [ ] 在 CI 中启用 macOS 公证
- [ ] 用 EV 证书签名 Windows 安装包
- [ ] 每年轮换 Casdoor 签名密钥
- [ ] 把 Webhook 端点限制到已知 IP
- [ ] 把审计日志导入 SIEM
- [ ] 每周跑一次 `pnpm audit`
- [ ] 订阅 GitHub Security Advisories

---

<div align="center">

**Security is a feature, not an afterthought. / 安全是特性,不是事后补救。**

</div>
