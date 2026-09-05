# Getting Started

[English](GETTING_STARTED.md) · **简体中文**

### 1. 前置条件

机器上一次性安装:

| 工具 | 版本 | 获取方式 |
|---|---|---|
| **Node.js** | 22.x LTS | [nodejs.org](https://nodejs.org/) 或 `nvm install 22` |
| **pnpm** | 10+ | `npm install -g pnpm` |
| **Git** | 2.30+ | [git-scm.com](https://git-scm.com/) |
| **Moon** | 2.5+ | 由 `pnpm install` 自动以 `@moonrepo/cli` 形式安装 |

可选(按平台):

| 平台 | 用于 |
|---|---|
| **Windows** | NSIS + MSI 构建 → 安装 [NSIS 3](https://nsis.sourceforge.io/) 与 [WiX Toolset 3](https://wixtoolset.org/) |
| **macOS** | DMG + 公证 → 安装 Xcode 命令行工具(`xcode-select --install`) |
| **Linux** | AppImage + .deb → `sudo apt install rpm fakeroot` |

验证:

```bash
node --version    # v22.x
pnpm --version    # 10.x
git --version     # 2.30+
```

### 2. 克隆

```bash
git clone --recurse-submodules https://github.com/louloulin/OpenBuddy.git
cd OpenBuddy
```

> ⚠️ **`--recurse-submodules` 是必需的** —— Pi 子模块与主仓一同签出。

### 3. 安装

```bash
pnpm install
```

依次执行三件事:

1. 通过 `pnpm` 安装 19 个 moon 工程的所有依赖
2. 运行 `moon sync projects` 注册 workspace DAG
3. 自动生成 `packages/ui` 使用的 TS 路径别名

期望输出以 `Done in <N>s.` 结尾。

### 4. 启动开发外壳

```bash
pnpm electron:dev
```

正在跑的内容:

- **Electron 主进程** — Cordis + Pi 运行时
- **Preload bridge** — 白名单 IPC
- **Vite dev server** — React 渲染端 + HMR,`http://localhost:5173`
- **moon 监听器** — 你修改任意 `@openbuddy/*` 工作区包时自动重建

打开 App,你会看到带 chat composer 的 OpenBuddy 窗口。试输入一条消息。除非你在 **Settings → Providers** 配置真实 Provider,否则默认走内置 stub。

### 5. 加入第一个 Provider key

App 中进入 **Settings → Providers → Add Provider**,选择:

- **Anthropic** — 粘贴 `sk-ant-…` key
- **OpenAI** — 粘贴 `sk-…` key
- **NewAPI** — 粘贴自托管 key(BYOK)
- **Custom** — 任何 OpenAI 兼容 base URL + key

Key 通过 Electron `safeStorage` API 加密存到 OS 钥匙串。

### 6. 第一次改代码

简单的改动:打开 `src/styles/tokens.css`,微调 `--wb-accent` 颜色。保存 —— Vite HMR 立即反映到运行中的 App,无需 reload。

稍大点的改动:从 GitHub Issue 列表挑一个 `good first issue`,fork 仓库,从 `master` 拉分支,开始改。

### 7. 测试你的改动

```bash
# 检查整个 monorepo 类型
pnpm workspace:typecheck

# 跑所有单元测试(309 个测试文件)
pnpm workspace:test

# 只跑单个包的测试
cd packages/capability/openbuddy-memory && pnpm test

# 跑闭环 Agent 评测
pnpm test:closed-loop
```

### 8. 构建生产安装包

```bash
# 按平台:
pnpm electron:build:win     # NSIS .exe + MSI
pnpm electron:build:mac     # 签名 .dmg
pnpm electron:build:linux   # AppImage + .deb
```

安装包落地 `release/<version>/`。要全平台:`pnpm electron:build:all`。

### 9. 下一步

- 读 [`ARCHITECTURE.md`](ARCHITECTURE.md) 理解代码库。
- 读 [`PLUGIN_DEVELOPMENT.md`](PLUGIN_DEVELOPMENT.md) 写第一个能力包。
- 读 [`../CONTRIBUTING.md`](../CONTRIBUTING.md) 学习 PR 工作流。
- 加入 [Discord](https://discord.gg/openbuddy) 获取实时帮助。

### 排错

#### `moon: command not found`

`pnpm install` 应已把 `node_modules/.bin` 加入 PATH。若没有:

```bash
pnpm exec moon sync projects
```

#### Electron 窗口空白

1. 打开 DevTools(View → Toggle Developer Tools),看 Console。
2. 最常见原因:Vite dev server 没起来。另起终端跑 `pnpm dev:renderer`,检查 5173 端口冲突。

#### Apple Silicon 上 `pnpm install` 失败

`bufferutil` 与 `utf-8-validate` 原生模块需要可用的 C++ 工具链。装 Xcode CLT:`xcode-select --install`。

#### 测试报 "Cannot find module '@openbuddy/...'"

你跳过了 `pnpm install` 或 `moon sync projects`。重跑两个。

#### `electron:build` 下载 Electron 二进制失败

设置 npmmirror 镜像环境变量(见 `electron-builder.yml`):

```bash
export ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
export ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"
```

---

<div align="center">

**Welcome aboard! / 欢迎登船!** 🚀

<sub>需要更多帮助?见 [`FAQ.md`](FAQ.md)、[`../SUPPORT.md`](../SUPPORT.md),或在 [Discord](https://discord.gg/openbuddy) 提问。</sub>

</div>
