# 贡献 OpenBuddy

[English](CONTRIBUTING.md) · **简体中文**

首先,感谢你考虑为 OpenBuddy 做贡献。正是像你这样的人让 OpenBuddy 成为开源 AI 工作台社区的绝佳工具。我们欢迎任何规模的贡献——从一个字符的笔误修复到完整的能力包。

---

## 🇨🇳 简体中文

### 行为准则

参与即代表你同意遵守我们的 [行为准则](CODE_OF_CONDUCT.md)。请先读一遍。

### 我们接受的贡献

下表列出我们欢迎的贡献方向:

| 方向 | 示例 | 首选标签 |
|---|---|---|
| 🐛 **Bug 修复** | 崩溃、回归、内存泄漏 | `bug` |
| ✨ **功能** | 新能力、新 Provider、新 UI 界面 | `enhancement` |
| 📖 **文档** | README、docs/、注释、i18n | `docs` |
| 🧪 **测试** | 新 Vitest 用例、smoke harness 覆盖 | `tests` |
| 🎨 **UI / UX** | 像素打磨、新图标、可访问性 | `ui` / `a11y` |
| 🌍 **国际化** | 翻译、locale 数据 | `i18n` |
| ⚡ **性能** | 包体积、启动时间、IPC 延迟 | `perf` |
| 🔏 **构建 / CI** | electron-builder、GitHub Actions、moon | `ci` |
| 📦 **插件** | 新增 `@openbuddy/*` 能力包 | `plugin` |
| 🔬 **研究** | 评测套件、benchmark 适配器 | `eval` |

拿不准方向?**先开 Issue 讨论**——我们更愿意沟通而不是直接 close。

### 我们 *不* 接受的(除非事先沟通)

- 单个 PR 改动超过 5 个包,且没有事先对齐 Issue
- 在根 `package.json` 添加新依赖(请用 workspace 包)
- 关闭 TypeScript strict 模式
- 删除 Casdoor / NewAPI 集成表面
- 重命名公开 IPC 通道(`electron/preload/index.ts`)

### 首次贡献者

留意这些标签的 Issue:

- [`good first issue`](https://github.com/louloulin/OpenBuddy/labels/good%20first%20issue) — 范围小,有人带
- [`help wanted`](https://github.com/louloulin/OpenBuddy/labels/help%20wanted) — 需要帮手,不承诺带教
- [`docs`](https://github.com/louloulin/OpenBuddy/labels/docs) — 无需写代码,只需写文档
- [`i18n`](https://github.com/louloulin/OpenBuddy/labels/i18n) — 翻译工作

### 开发工作流

#### 1. Fork & 克隆

```bash
git clone --recurse-submodules https://github.com/<你的名字>/OpenBuddy.git
cd OpenBuddy
git remote add upstream https://github.com/louloulin/OpenBuddy.git
```

#### 2. 从 `master` 拉分支

```bash
git fetch upstream
git checkout -b feat/short-name upstream/master
```

> OpenBuddy 使用 **`master`** 作为默认分支(我们沿用 moon workspace 的命名约定,见 `.moon/workspace.yml`)。请确保你的分支基于最新的上游 `master`,而非 `main`。

#### 3. 安装并验证

```bash
pnpm install               # 安装依赖 + 自动 `moon sync projects`
pnpm workspace:typecheck   # 检查全部 moon 工程的类型
pnpm workspace:test        # 跑全部 Vitest 测试
```

#### 4. 写你的改动

先读 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) · [`docs/ARCHITECTURE.zh-CN.md`](docs/ARCHITECTURE.zh-CN.md) 和 [`docs/GETTING_STARTED.md`](docs/GETTING_STARTED.md) · [`docs/GETTING_STARTED.zh-CN.md`](docs/GETTING_STARTED.zh-CN.md)。再开始改。

**推荐**使用 Conventional Commits 风格(不强制):

```
feat(capability-memory): 增加跨会话回忆
fix(electron-ipc): 处理空事件载荷
docs(readme): 增加 Linux 截图
test(plugin-host): 覆盖 30 秒重载超时
chore(deps): 升级 cordis 到 3.18.1
```

#### 5. 测试你的改动

| 测试类型 | 命令 | 时机 |
|---|---|---|
| 类型检查 | `pnpm workspace:typecheck` | 总是 |
| 单元测试 | `pnpm workspace:test` | 总是 |
| 单包测试 | `cd packages/<group>/<name> && pnpm test` | 只动一个包时 |
| 存储边界 | `pnpm storage:boundaries` | 动 `packages/runtime/openbuddy-storage` 时 |
| Electron smoke | `pnpm test:electron` | 动 Electron 主进程或 preload 时 |
| Surface 回归 | `pnpm test:electron:surface` | 动 IPC 通道时 |
| 闭环评测 | `pnpm test:closed-loop` | 动 Agent 流程时 |
| 真机 UI smoke | `pnpm test:electron:real-ui` | 动渲染端时 |

如果新增了 IPC 通道,请同时跑 `node scripts/electron/audit-agent-surface.mjs` 并更新审计快照。

#### 6. 提 PR

- 目标分支: **`master`**
- 标题: 命令式语气, ≤ 72 字符(如 `feat(email): 增加 Gmail API 草稿支持`)
- 正文: 关联 Issue,描述改了什么、为什么改,UI 改动附前后截图
- PR 模板: 见 `.github/PULL_REQUEST_TEMPLATE.md`(自动填充)
- 所有 PR 都会触发 CI——CI 绿才能合

#### 7. 评审流程

- 维护者会在 **48h 内**给出初次响应: 👍 + 评论,或要求修改。
- 评审使用 **conventional comments**(如 `nit:`、`question:`、`suggestion:`、`issue:`)。
- 通过后,维护者用 Conventional Commit 信息 squash merge。

### 编码规范

#### TypeScript

- 强制 TypeScript 5.6 strict 模式。
- `packages/` 与 `electron/` 下禁止使用 `any`。请用 `unknown` + narrow。
- 公开 API 必须同时导出类型定义与运行时。
- 新 IPC 通道必须加入 `electron/preload/index.ts` 白名单,且在 `src/lib/electron-api.ts` 中有对应的类型化包装。

#### React

- 仅函数式组件,不用 class 组件。
- Zustand store 放 `src/stores/`(一个关注点一个)。
- `useEffect` 的副作用必须声明 **全部** 依赖。
- 不使用 CSS-in-JS。请用 `src/styles/tokens.css` 中的 `--wb-*` 设计 tokens。

#### Cordis 能力包

- 一个关注点一个能力包,放 `packages/<group>/openbuddy-*/`。
- 必须导出 `apply(ctx: Context)` 作为默认入口。
- 必须在 `src/__tests__/` 下有对应 Vitest 用例。
- 存储访问必须走 `@openbuddy/storage`——**禁止在能力代码里直接调用 `fs`**。

#### 文档

- 每个新增功能的 PR 也必须新增或更新描述它的文档页。
- 每个新增 IPC 通道的 PR 也必须在 `docs/openbuddy-ipc-surface.md` 中增加一行(自动生成,跑 `pnpm test:electron:ipc-surface` 即可)。
- 每个新增环境变量的 PR 必须在 `docs/ENVIRONMENT.md` 中加入(自动生成)。
- 每个新增 `@openbuddy/*` 包的 PR 必须把它加到 `docs/openbuddy-capability-matrix.md`。

#### Commit 卫生

- 一个 commit 一个逻辑改动。
- PR 中不要 "WIP" 或 "fix typo" 提交——推送前本地 squash。
- Commit 作者邮箱必须为真实地址(想看头像的话最好 Gravatar 兼容)。

### 发布流程

OpenBuddy 使用[语义化版本](https://semver.org/),每 2–4 周发布一次。发布流程完全由 `.github/workflows/release.yml` 自动化:

1. 维护者用 `workflow_dispatch` 触发,填入新 tag(如 `v0.15.0`)。
2. CI 跑全部 moon 工程的 typecheck + tests。
3. CI 构建 Windows NSIS+MSI、macOS DMG(签名)、Linux AppImage+deb。
4. CI 用 `CHANGELOG.md` 抽取的内容发布草稿 GitHub Release。
5. 维护者审阅草稿,点击 "Publish"。
6. auto-updater(`electron-updater`)通知已安装用户。

### 获取帮助

- **GitHub Discussions** — 设计问题、求助、Show & Tell
- **Discord** — 实时聊天(链接见 [`docs/COMMUNITY.md`](docs/COMMUNITY.md))
- **Office Hours** — 每周视频 Q&A(在 Discussions 公告)

### 致谢

所有贡献者都会出现在 GitHub Contributors 图中,并在发布说明中致谢。新贡献者的首个 PR 在合并 commit 中会带 🎉。

---

<div align="center">

**感谢你愿意让 OpenBuddy 变得更好!**

<sub>这份 CONTRIBUTING.md 改编自 [Atom](https://github.com/atom/atom/blob/master/CONTRIBUTING.md)、[Vue.js](https://github.com/vuejs/vue/blob/main/.github/CONTRIBUTING.md) 与 [Rust](https://github.com/rust-lang/rust/blob/master/CONTRIBUTING.md) 的最佳实践。</sub>

</div>
