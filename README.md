<div align="center">

<img src="app-icon.png" width="128" height="128" alt="OpenBuddy logo" />

# OpenBuddy

### The open desktop AI workspace that you can actually read, fork, and own.

**English** · [简体中文](README.zh-CN.md)

<a href="docs/README.md"><img alt="Docs" src="https://img.shields.io/badge/docs-openbuddy-blue?style=for-the-badge"></a>
<a href="CONTRIBUTING.md"><img alt="Contributing" src="https://img.shields.io/badge/contributing-welcome-green?style=for-the-badge"></a>
<a href="docs/COMMUNITY.md"><img alt="Community" src="https://img.shields.io/badge/community-join-purple?style=for-the-badge"></a>
<a href="SPONSORS.md"><img alt="Sponsors" src="https://img.shields.io/badge/sponsor-♥-ff69b4?style=for-the-badge"></a>

<br/>

<a href="https://github.com/louloulin/OpenBuddy/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/louloulin/OpenBuddy?style=for-the-badge&logo=starship&logoColor=white&color=yellow"></a>
<a href="https://github.com/louloulin/OpenBuddy/releases"><img alt="Release" src="https://img.shields.io/github/v/release/louloulin/OpenBuddy?style=for-the-badge&logo=github&color=blue"></a>
<a href="https://github.com/louloulin/OpenBuddy/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/louloulin/OpenBuddy/ci.yml?branch=main&style=for-the-badge&logo=githubactions&logoColor=white"></a>
<a href="https://github.com/louloulin/OpenBuddy/blob/main/LICENSE"><img alt="License" src="https://img.shields.io/badge/license-MIT-green?style=for-the-badge"></a>

<br/>

<img alt="Platform" src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue?style=flat-square&logo=windows10&logoColor=white">
<img alt="Electron" src="https://img.shields.io/badge/Electron-44-47848F?style=flat-square&logo=electron&logoColor=white">
<img alt="React" src="https://img.shields.io/badge/React-18-61dafb?style=flat-square&logo=react&logoColor=white">
<img alt="moon" src="https://img.shields.io/badge/moon-2.5-blue?style=flat-square&logo=moonrepo&logoColor=white">
<img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.6-3178C6?style=flat-square&logo=typescript&logoColor=white">

<br/><br/>

**OpenBuddy is a self-hostable, auditable desktop AI agent for enterprise email and collaboration — 100% open source (MIT) on Electron + Pi.**
Five real mailbox protocols, Casdoor × NewAPI identity, a tenant-scoped audit ledger, and every provider BYOK. Every byte auditable.

[Quick Start](#-quick-start) · [Features](#-features) · [Architecture](#-architecture) · [Documentation](#-documentation) · [Contributing](CONTRIBUTING.md) · [Community](docs/COMMUNITY.md)

</div>

---

- **AI Chat overhaul (Plan5)**: streaming caret, live reasoning card, inline tool expand, citation/artifact chips, message-level rewind/fork, parallel-tool visualization, shortcut overlay — see `WORKBUDDY_UI_REFERENCE.md`.

## 📑 Table of Contents

- [Why OpenBuddy?](#-why-openbuddy)
- [✨ Features](#-features)
- [🎬 Demo & Screenshots](#-demo--screenshots)
- [🏢 Self-hostable, auditable, enterprise-ready](#%EF%B8%8F-self-hostable-auditable-enterprise-ready)
- [🚀 Quick Start](#-quick-start)
- [🏗️ Architecture](#-architecture)
- [🧩 Capabilities](#-capabilities)
- [🛠️ Built With](#-built-with)
- [📚 Documentation](#-documentation)
- [🗺️ Roadmap](#-roadmap)
- [🤝 Contributing](#-contributing)
- [🛡️ Security](#-security)
- [🌍 Community](#-community)
- [⭐ Star History](#-star-history)
- [🙏 Acknowledgements](#-acknowledgements)
- [📄 License](#-license)

---

## 💡 Why OpenBuddy?

**OpenBuddy is a self-hostable, auditable desktop AI agent for enterprise email and collaboration.** It lets an AI work inside a mailbox and collaboration space you control — and leaves a trail of everything it did.

Three things are hard to get right, and they are what this project is actually about:

1. **It talks to real mailboxes.** IMAP, SMTP, Gmail API, Graph API and JMAP — five real protocol paths, with acceptance scripts that exercise them end to end.
2. **Enterprise identity fits in.** Casdoor OIDC (wired into the main process), multi-tenant isolation, a NewAPI gateway, and an audit ledger. SCIM v2 / SAML 2.0 exist as tested but **unwired** seed implementations (archived 2026-10-28, recoverable from git history) — we don't claim them as shipped.
3. **Every action is traceable.** Local audit log, tenant-scoped audit chain, tool-call records — when something goes wrong you can answer *who, when, which mailbox, what*.

<table>
<tr><td>🔓</td><td><strong>100% open source (MIT)</strong><br/>No telemetry black box, no vendor lock-in. The whole repo is auditable.</td></tr>
<tr><td>⚡</td><td><strong>Electron + Pi runtime</strong><br/>One tested desktop host with a versioned preload bridge; the renderer only sees a typed API surface.</td></tr>
<tr><td>🔁</td><td><strong>Restart-safe sessions</strong><br/>Pi sessions, provider settings, capability state, and audit logs persist across renderer reloads and Electron restarts.</td></tr>
<tr><td>🤖</td><td><strong>Pi as the agent runtime</strong><br/>The in-process <code>AgentSession</code> owns prompts, tools, permissions, plans, tasks, and streaming events.</td></tr>
<tr><td>🌐</td><td><strong>Truly cross-platform</strong><br/>One codebase, Windows, macOS, and Linux. <a href="electron-builder.yml">electron-builder</a> produces installers for each.</td></tr>
<tr><td>🪐</td><td><strong>moon DAG monorepo</strong><br/>Type-check / test / build incrementally across the whole workspace (current project count in [`docs/stats.json`](docs/stats.json)). CI runs the same commands you run locally.</td></tr>
<tr><td>🧩</td><td><strong>Cordis capability mesh</strong><br/>Workspace packages (capability / collaboration / UI / …) under <code>@openbuddy/*</code> — email, calendar, MCP, folder trust, authorization, multi-agent collaboration. Pick what you need.</td></tr>
<tr><td>🏢</td><td><strong>Enterprise building blocks</strong><br/>Casdoor OIDC and the audit ledger are wired; NewAPI gateway integration is in the tree. SCIM v2 / SAML 2.0 exist as tested seeds in git history, not yet wired.</td></tr>
</table>

> *"A desktop AI agent you can host yourself, read every line of, and audit afterwards."*

The full one-page positioning statement lives in [`POSITIONING.md`](POSITIONING.md).

## ✨ Features

<table>
<tr><th width="50%">Surface</th><th width="50%">Capabilities</th></tr>
<tr>
<td valign="top">

**🎨 Pixel-close WorkBuddy UI**
Ported `--wb-*` design tokens, full 207-icon foundation (all implemented, no stubs), brand atoms. It looks like WorkBuddy because the same atoms make it up.

**⚙️ Pi, in-process**
`@earendil-works/pi-coding-agent` runs in Electron Main. Renderer code only sees the typed preload API; no Node or provider SDK is required in the UI.

**🔌 Pi events as contract**
Streaming assistant deltas, tool calls, plan updates, permission requests, and completion events flow through cleanup-aware `pi://*` events.

</td>
<td valign="top">

**🔑 BYOK, multi-provider**
Bring your own keys. Configure Anthropic, OpenAI-compatible, Pi, MiniMax, NewAPI, or custom providers in the local Pi/OpenBuddy data directory.

**🧩 Extensible agent surface**
- **Skills** — Pi skills and local skill catalogs
- **MCP connectors** — local connector roots + OAuth/auth status
- **Experts / Assistants** — local Pi/OpenBuddy agent files
- **Plugins** — loadable via the marketplace

**🚀 Advanced workflows**
Plan mode (toggle & view) · Rewind (rewind & fork) · sub-agent Tasks (observe & cancel) · Slash Commands · local Automations scheduler.

**📦 Cross-platform installers**
Windows (NSIS `.exe`), macOS (`.dmg`), Linux (AppImage) — x64 + arm64. CI-built releases via GitHub Actions.

</td>
</tr>
<tr>
<td valign="top">

**🏢 Enterprise integration**
- **Casdoor** — OIDC SSO + tenant policy + audit log
- **NewAPI** — model aggregation gateway (BYOK + Service Token)

</td>
<td valign="top">

**🧪 Battle-tested quality**
- **Every test file is in the repo** — current count in [`docs/stats.json`](docs/stats.json) (Vitest)
- **Live integration tests** against public Casdoor + NewAPI endpoints
- **Closed-loop capability evals** for end-to-end agent runs
- **Type-safe IPC** — every preload channel is allowlisted in `electron/preload/index.ts`
- **Storage boundaries** — automated architecture enforcement

**🌍 Internationalization**
Full UI locale coverage via `@openbuddy/ui-locale`; ships English + 简体中文 out of the box.

**🪟 Native desktop polish**
System tray, native notifications, deep links (`casdoor://`), clipboard integration, multi-window, autosave-on-quit.

</td>
</tr>
</table>

---

## 🎬 Demo & Screenshots (all captured against the real MiniMax-M3 model)

> Every AI chat screenshot below is from a **real Electron build driven by the real MiniMax-M3 model** at `https://api.minimaxi.com/anthropic` — not a mock, not a replay.
>
> Reproduce locally:
> ```bash
> pnpm build
> OPENBUDDY_E2E_API_KEY="sk-cp-..." \
> OPENBUDDY_E2E_BASE_URL="https://api.minimaxi.com/anthropic" \
> OPENBUDDY_E2E_MODEL_ID="MiniMax-M3" \
> node scripts/electron/_screenshot-real-ui.mjs
> ```
> Offline fallback (local echo upstream, same Anthropic Messages wire format):
> `node scripts/electron/launch-real-evals-echo.mjs`

### 1. Cold start — no API key configured

<p align="center">
  <img src="docs/screenshots/01-home-cold-start.png" alt="OpenBuddy cold start — sidebar with tasks / workspaces / settings, main area showing '正在本地初始化 agent…', composer disabled with a hint to configure an API key first" width="1024" />
</p>

### 2. Composer ready after configuring MiniMax

<p align="center">
  <img src="docs/screenshots/02-composer-ready.png" alt="After configuring MiniMax-M3 the composer is enabled, model selector shows '均衡 (MiniMax-M2.7)', the user can type a prompt and send" width="1024" />
</p>

### 3. Real MiniMax-M3 streaming answer — mid-turn

<p align="center">
  <img src="docs/screenshots/03-turn1-mid-stream.png" alt="Real MiniMax-M3 model streaming a self-introduction — Buddy displays '我是 Pi, 一个在 OpenBuddy 中运行的 AI 编程助手', the 深度思考 (deep thinking) block is collapsible" width="1024" />
</p>

### 4. Turn 1 settled

<p align="center">
  <img src="docs/screenshots/04-turn1-settled.png" alt="First turn settled — status pill shows '已完成 4s', Buddy's reply is fully readable, copy / retry / thumbs-up row visible" width="1024" />
</p>

### 5. Turn 2 — multi-turn conversation

<p align="center">
  <img src="docs/screenshots/05-turn2-settled.png" alt="Second turn — user asks how to translate 'Hello world' to Chinese, Buddy replies '你好, 世界'" width="1024" />
</p>

### 6. Turn 3 — structured output (Chinese to-do list)

<p align="center">
  <img src="docs/screenshots/06-turn3-settled.png" alt="Third turn — user asks for a three-line Chinese to-do list, Buddy outputs all three items: 买菜 / 做饭 / 洗碗" width="1024" />
</p>

### 7. Full three-turn transcript

<p align="center">
  <img src="docs/screenshots/07-three-turns-full.png" alt="OpenBuddy AI chat full transcript of three turns — real MiniMax-M3 streaming responses, each turn with a collapsible 深度思考 block, retry / copy / thumbs-up actions" width="1024" />
</p>

### Verification evidence (all passing)

- `tests/electron/chat-ui-minimax-real.spec.ts` — 6/6 pass (54.7s) against the real upstream
- `tests/electron/minimax-real-roundtrip.spec.ts` — 4/4 pass (46.1s), real `agent:prompt` / `follow-up` / `abort` / `current-model` IPC chain
- `tests/electron/chat-flow-echo.spec.ts` — 5/5 pass against the local echo upstream
- `tests/electron/chat-ui-streaming.spec.ts` — 7/7 pass, multi-turn / hidden window / reload / streaming
- `tests/electron/chat-flow.spec.ts` — 2/2 pass, cold-start composer-disabled surface
- `tests/electron/session-history-load.spec.ts` — 2/2 pass, persisted history replay

### 30-second tour — what you get

<p align="center">
  <img src="docs/diagrams/tour-30s.svg" alt="OpenBuddy 30-second tour — desktop agent UI, Cordis capabilities, enterprise-ready, verifiable, fast" />
</p>

### Architecture overview

<p align="center">
  <img src="docs/diagrams/architecture-overview.svg" alt="OpenBuddy end-to-end architecture — renderer, preload bridge, Electron main, Pi agent runtime, Cordis capability mesh" />
</p>

### Capability matrix

<p align="center">
  <img src="docs/diagrams/capability-matrix.svg" alt="OpenBuddy capability matrix — workspace packages across 8 groups" />
</p>

### Data flow — prompt to tool result

<p align="center">
  <img src="docs/diagrams/data-flow-end-to-end.svg" alt="OpenBuddy data flow — every prompt crosses 5 typed boundaries before reaching the model, and 4 on the way back" />
</p>

### Capability parity (evidence-backed)

<p align="center">
  <img src="docs/diagrams/workbuddy-parity.svg" alt="OpenBuddy capability parity" />
</p>

### Bilingual support

OpenBuddy ships with first-class bilingual UI: **`zh-CN` (default)** and **`en-US`**. Translations live as JSON dictionaries under `packages/ui/openbuddy-ui-locale/src/dictionaries/`. The locale persists in `localStorage` under `openbuddy:locale` and is hot-swappable at runtime via the `LocaleService` API — no renderer reload required for the active dictionary after the next navigation. See [`docs/I18N.md`](docs/I18N.md) for the full workflow and how to add a third locale.

All primary documentation is shipped as **separate files per language** so contributors can edit them in parallel without merge churn:

| Document | English | 简体中文 |
|---|---|---|
| Landing README | [`README.md`](README.md) | [`README.zh-CN.md`](README.zh-CN.md) |
| Codebase analysis | [`docs/CODEBASE_ANALYSIS.md`](docs/CODEBASE_ANALYSIS.md) | [`docs/CODEBASE_ANALYSIS.zh-CN.md`](docs/CODEBASE_ANALYSIS.zh-CN.md) |
| Docs index | [`docs/README.md`](docs/README.md) | [`docs/README.zh-CN.md`](docs/README.zh-CN.md) |
| Getting started | [`docs/GETTING_STARTED.md`](docs/GETTING_STARTED.md) | [`docs/GETTING_STARTED.zh-CN.md`](docs/GETTING_STARTED.zh-CN.md) |
| Architecture | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | [`docs/ARCHITECTURE.zh-CN.md`](docs/ARCHITECTURE.zh-CN.md) |
| FAQ | [`docs/FAQ.md`](docs/FAQ.md) | [`docs/FAQ.zh-CN.md`](docs/FAQ.zh-CN.md) |
| Performance | [`docs/PERFORMANCE.md`](docs/PERFORMANCE.md) | [`docs/PERFORMANCE.zh-CN.md`](docs/PERFORMANCE.zh-CN.md) |
| Contributing | [`CONTRIBUTING.md`](CONTRIBUTING.md) | [`CONTRIBUTING.zh-CN.md`](CONTRIBUTING.zh-CN.md) |
| Governance | [`GOVERNANCE.md`](GOVERNANCE.md) | [`GOVERNANCE.zh-CN.md`](GOVERNANCE.zh-CN.md) |
| Code of Conduct | [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) | [`CODE_OF_CONDUCT.zh-CN.md`](CODE_OF_CONDUCT.zh-CN.md) |
| Security | [`SECURITY.md`](SECURITY.md) | [`SECURITY.zh-CN.md`](SECURITY.zh-CN.md) |
| Support | [`SUPPORT.md`](SUPPORT.md) | [`SUPPORT.zh-CN.md`](SUPPORT.zh-CN.md) |
| Maintainers | [`MAINTAINERS.md`](MAINTAINERS.md) | [`MAINTAINERS.zh-CN.md`](MAINTAINERS.zh-CN.md) |
| Sponsors | [`SPONSORS.md`](SPONSORS.md) | [`SPONSORS.zh-CN.md`](SPONSORS.zh-CN.md) |
| Brand | [`BRAND.md`](BRAND.md) | [`BRAND.zh-CN.md`](BRAND.zh-CN.md) |
| Changelog | [`CHANGELOG.md`](CHANGELOG.md) | [`CHANGELOG.zh-CN.md`](CHANGELOG.zh-CN.md) |
| Roadmap / TODO | [`TODO.md`](TODO.md) | [`TODO.zh-CN.md`](TODO.zh-CN.md) |

See [`docs/diagrams/`](docs/diagrams/) for the full set of system architecture diagrams in SVG / HTML format.

---

## 🏢 Self-hostable, auditable, enterprise-ready

The table below is the short version of what makes this usable inside an organization — each row points at code that exists in this repository.

| Capability | Where it lives |
|---|---|
| License | MIT — every line auditable, fork it |
| Data path | Local + your own gateway (BYOK), never a vendor backend |
| Mailbox protocols | IMAP · SMTP · Gmail API · Graph API · JMAP — five real protocol paths |
| Provider choice | BYOK — Anthropic / OpenAI / NewAPI / custom |
| Identity | Casdoor OIDC (wired) · multi-tenant isolation · SCIM/SAML seeds (unwired, in git history) |
| Audit | Local audit log + tenant-scoped audit ledger, exportable |
| Plugin SDK | Open Cordis capability mesh (`@openbuddy/*`), versioned contracts |
| Tests | Every test file is in this repository (count: `docs/stats.json`) |
| Cross-platform | Windows · macOS · Linux |

A full, evidence-backed capability matrix — including the parts that are **not** done yet — lives in [`docs/workbuddy-parity-matrix.md`](docs/workbuddy-parity-matrix.md). We would rather point you at the matrix than at a marketing table.

---

## 🚀 Quick Start

### Prerequisites

- **Node.js 22+** (we use Node 22 features; see `package.json` `packageManager`)
- **pnpm 10+** — `npm install -g pnpm`
- **Git** with submodule support
- **(Optional)** Platform build tools — see [`docs/release-ci.md`](docs/release-ci.md)

### Install & Run (development)

```bash
# 1. Clone with submodules
git clone --recurse-submodules https://github.com/louloulin/OpenBuddy.git
cd OpenBuddy

# 2. Install deps (also runs `moon sync projects` automatically)
pnpm install

# 3. Start the dev shell — Electron host + Vite renderer + HMR
pnpm electron:dev
#   ↑ equivalent to:  moon run openbuddy:dev.electron
```

> The first run takes ~30s for the Vite cold start. Subsequent restarts are sub-second thanks to moon's incremental DAG.

### Build a production installer

```bash
# Windows installer (NSIS .exe)
pnpm electron:build:win

# macOS installer (DMG)
pnpm electron:build:mac

# Linux AppImage
pnpm electron:build:linux

# All three
pnpm electron:build:all
```

### Verify your environment

```bash
# Type-check the entire monorepo
pnpm workspace:typecheck

# Run the full Vitest suite (every test file is in the repo)
pnpm workspace:test

# Closed-loop capability evaluation (real agent run + scoring)
pnpm test:closed-loop
```

Need a deeper walkthrough? Head to **[`docs/GETTING_STARTED.md`](docs/GETTING_STARTED.md)**.

---

## 🏗️ Architecture

OpenBuddy is a **three-layer Electron app** with a **Cordis capability mesh** under the hood:

```
┌──────────────────────────────────────────────────────────────┐
│  React Renderer (src/, packages/ui/*)                        │
│    Vite + React 18 + Zustand stores                          │
│    Foundation: --wb-* tokens, 207-icon set, brand atoms      │
└──────────────────────┬───────────────────────────────────────┘
                       │ window.api (typed contextBridge)
┌──────────────────────┴───────────────────────────────────────┐
│  Electron Main + preload bridge                              │
│    ipc.ts                ← allowlisted IPC handlers          │
│    agent-host.ts         ← Pi AgentSession lifecycle         │
│    pi-event-bridge.ts    ← cleanup-aware pi://* events       │
│    pi-resources.ts       ← local persistence (Cordis fs)     │
│    capability-*.ts       ← Cordis capability services        │
└──────────────────────┬───────────────────────────────────────┘
                       │ typed Pi session events
┌──────────────────────┴───────────────────────────────────────┐
│  Pi AgentSession + Cordis capability services                │
│    providers, tools, permissions, plans, tasks, persistence  │
└──────────────────────────────────────────────────────────────┘
```

**Capability mesh** — every feature is a Cordis service under `packages/<group>/openbuddy-*/`:

```
runtime/      cordis · plugin-host · storage
renderer/     renderer-host (preload bridge glue)
bundle/       base (umbrella for renderer-only deps)
auth/         casdoor · permission
team/         team · subagent
capability/   memory · inspiration · web-search · plan ·
              folder-trust · task · automation · calendar · email · mcp-client · authorization
core/         session
fs/           fs-local
shared/       files-kb · types
collaboration/ coordinator · evidence · inbox · network · policy · protocol · room · task
ui/           26 UI packages (shell, sidebar, settings, workbench, …)
```

### Project layout

```
src/                     # React frontend
  styles/                # tokens.css / global.css / app.css
  foundation/components/Icon/   # ported from WorkBuddy (207 icons, all implemented)
  lib/                   # pi-client.ts + electron-api.ts (typed bridge wrappers)
  stores/                # Zustand: session / sessions / permission / ...
  components/            # Topbar, Sidebar, HomePage, ChatView, Composer, ...

electron/                # Electron main + preload host
  main/                  # index.ts · window.ts · ipc.ts · agent-host.ts · sessions.ts
  preload/               # contextBridge surface (allowlisted)

apps/
  admin-portal/          # Independent React SPA (Casdoor OIDC + Resource Gateway)

packages/                # one moon project per capability (50+ packages)
  runtime/openbuddy-{cordis,plugin-host,storage}/
  renderer/openbuddy-renderer-host/
  bundle/openbuddy-base/
  auth/openbuddy-{casdoor,permission}/
  team/openbuddy-{team,subagent}/
  capability/openbuddy-{memory,inspiration,web-search,plan,
              folder-trust,task,automation,calendar,email,mcp-client,authorization}/
  core/openbuddy-session/
  fs/openbuddy-fs-local/
  shared/openbuddy-{files-kb,types}/
  collaboration/openbuddy-{coordinator,evidence,inbox,network,policy,
              protocol,room,task}/
  ui/openbuddy-{shell,sidebar,settings,workbench,…} (19 packages)

.moon/                   # moon workspace + task configuration
  workspace.yml          # project graph (renderer + Electron + packages)
  tasks/                 # typecheck / test / build / dev / electron.* presets
  toolchains.yml         # node 22 / pnpm 10 / typescript 5.6

moon.yml                 # renderer moon project (Vite + React)
electron/moon.yml        # Electron host moon project

scripts/                 # dev/build helpers (thin shims over moon tasks)
docs/                    # all documentation (this folder)
```

For a deeper dive see **[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)**.

---

## 🧩 Capabilities

OpenBuddy ships **72 `@openbuddy/*` workspace packages** (36 UI, 8 collaboration, 5 capability, plus runtime/auth/core/shared). Exact counts live in [`docs/stats.json`](docs/stats.json) — the table below names only packages that exist in the tree.

> Agent-facing features such as **plan mode**, **sub-agent tasks**, **local automations**, and **web search** are implemented as **Pi extensions** in `electron/main/agent/pi-extensions.ts` (tools `openbuddy_plan`, `openbuddy_goals`, `openbuddy_automation`, …) — they are **not** `@openbuddy/capability-*` packages. Earlier versions of this README listed non-existent packages for them; that was wrong.

### Core agent & runtime

| Package | Purpose |
|---|---|
| `@openbuddy/core-session` | Session lifecycle, fork, rewind |
| `@openbuddy/cordis` | Cordis context + service helpers |
| `@openbuddy/host-runtime` | Host-side runtime glue |
| `@openbuddy/dsh-core` | Agent shell runtime |
| `@openbuddy/plugin-host` | Plugin discovery + hot reload |
| `@openbuddy/plugin-sdk` | Plugin authoring SDK |
| `@openbuddy/storage` | Local persistence with audit |

### Capability

| Package | Purpose |
|---|---|
| `@openbuddy/capability-email` | IMAP/SMTP + Gmail/Graph/JMAP API |
| `@openbuddy/capability-calendar` | Calendar integration |
| `@openbuddy/capability-mcp-client` | MCP connector governance |
| `@openbuddy/capability-authorization` | Capability-level policy gate |
| `@openbuddy/folder-trust` | Per-folder permission grants |

### File & shell

| Package | Purpose |
|---|---|
| `@openbuddy/fs-fs-local` | Local filesystem via Cordis |
| `@openbuddy/files-kb` | Knowledge-base file indexing |

### Multi-agent

| Package | Purpose |
|---|---|
| `@openbuddy/team-team` | Multi-agent team orchestration |
| `@openbuddy/collaboration-protocol` | A2A message envelopes |
| `@openbuddy/collaboration-room` | Shared rooms |
| `@openbuddy/collaboration-inbox` | Cross-agent inbox |
| `@openbuddy/collaboration-policy` | Cross-agent policy |
| `@openbuddy/collaboration-task` | Cross-agent task graph |
| `@openbuddy/collaboration-network` | Network topology |
| `@openbuddy/collaboration-evidence` | Audit evidence |
| `@openbuddy/collaboration-coordinator` | Coordination layer |

### Enterprise

| Package | Purpose |
|---|---|
| `@openbuddy/auth-casdoor` | Casdoor OIDC client + admin REST |
| `@openbuddy/auth-permission` | Permission prompts UI |
| `@openbuddy/auth-policy` | Tenant + capability policy evaluation |

### UI primitives

36 packages under `packages/ui/openbuddy-ui-*` — shell, sidebar, settings, settings-models, workbench, home, conversation, experts, dialogs, markdown, primitives, modules, theme, runtime, slots, locale, hmr, email, files, automation, account, billing, audit-center, and more (full list: `pnpm exec node -e "…"` or `ls packages/ui`).

---

## 🛠️ Built With

<table>
<tr><th>Layer</th><th>Tech</th></tr>
<tr><td>Shell</td><td><a href="https://www.electronjs.org/">Electron 44</a>, <a href="https://www.electron.build/">electron-builder 26</a>, <a href="https://github.com/Squirrel/Squirrel.Windows">Squirrel</a>, <a href="https://github.com/Squirrel/Squirrel.Mac">Squirrel.Mac</a></td></tr>
<tr><td>Renderer</td><td><a href="https://react.dev/">React 18</a>, <a href="https://vitejs.dev/">Vite 5</a>, <a href="https://github.com/pmndrs/zustand">Zustand 4</a>, <a href="https://reactrouter.com/">React Router 6</a>, <a href="https://github.com/remarkjs/react-markdown">react-markdown</a>, <a href="https://github.com/lucide-icons/lucide">lucide-react</a>, <a href="https://katex.org/">KaTeX</a>, <a href="https://github.com/mermaid-js/mermaid">Mermaid</a></td></tr>
<tr><td>Agent runtime</td><td><a href="https://github.com/badlogic/pi-mono">@earendil-works/pi-coding-agent</a>, <a href="https://github.com/badlogic/pi-mono">@earendil-works/pi-agent-core</a>, <a href="https://github.com/badlogic/pi-mono">@earendil-works/pi-ai</a></td></tr>
<tr><td>Capability mesh</td><td><a href="https://github.com/cordisjs/cordis">Cordis 3</a>, <a href="https://modelcontextprotocol.io/">MCP SDK 1.25</a></td></tr>
<tr><td>Monorepo</td><td><a href="https://moonrepo.dev">moon 2.5</a>, <a href="https://pnpm.io/">pnpm 11</a></td></tr>
<tr><td>Quality</td><td><a href="https://vitest.dev/">Vitest 2</a>, <a href="https://playwright.dev/">Playwright 1.58</a>, <a href="https://testing-library.com/">Testing Library</a>, TypeScript 5.6 strict</td></tr>
<tr><td>Backend integrations</td><td>Casdoor, NewAPI, Stripe, WeChat Pay, Alipay, IMAP, SMTP, Gmail API, Graph API, JMAP</td></tr>
</table>

---

## 📚 Documentation

All documentation lives in [`docs/`](docs/). Start here:

| Doc | What it's for |
|---|---|
| **[`docs/README.md`](docs/README.md)** | Full docs index |
| **[`docs/GETTING_STARTED.md`](docs/GETTING_STARTED.md)** | 30-minute developer setup |
| **[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)** | Layer-by-layer architecture deep dive |
| **[`docs/CODEBASE_ANALYSIS.md`](docs/CODEBASE_ANALYSIS.md)** | Verified 2026-09-05 package inventory & build/runtime architecture |
| **[`docs/PLUGIN_DEVELOPMENT.md`](docs/PLUGIN_DEVELOPMENT.md)** | Build your first Cordis capability |
| **[`docs/FAQ.md`](docs/FAQ.md)** | Frequently asked questions |
| **[`docs/COMMUNITY.md`](docs/COMMUNITY.md)** | Where to ask, chat, and contribute |
| **[`docs/ROADMAP.md`](docs/ROADMAP.md)** | Public roadmap |
| **[`SECURITY.md`](SECURITY.md)** | Security policy & disclosures |
| **[`SUPPORT.md`](SUPPORT.md)** | How to get help |
| **[`docs/release-ci.md`](docs/release-ci.md)** | Release & CI pipeline |
| **[`docs/workbuddy-parity-matrix.md`](docs/workbuddy-parity-matrix.md)** | OpenBuddy vs WorkBuddy capability parity |
| **[`docs/openbuddy-capability-matrix.md`](docs/openbuddy-capability-matrix.md)** | Package-by-package capability list |
| **[`docs/TESTING.md`](docs/TESTING.md)** | Testing strategy & conventions |
| **[`docs/PERFORMANCE.md`](docs/PERFORMANCE.md)** | Performance budget & optimization |
| **[`docs/ACCESSIBILITY.md`](docs/ACCESSIBILITY.md)** | WCAG 2.2 AA conformance |
| **[`docs/OPERATIONS.md`](docs/OPERATIONS.md)** | Production deployment & ops |
| **[`docs/WORKBUDDY_MIGRATION.md`](docs/WORKBUDDY_MIGRATION.md)** | Migrating from Tencent WorkBuddy |
| **[`docs/EXAMPLES.md`](docs/EXAMPLES.md)** | Examples & showcase |
| **[`docs/GLOSSARY.md`](docs/GLOSSARY.md)** | Terminology glossary |
| **[`docs/ENVIRONMENT.md`](docs/ENVIRONMENT.md)** | Environment variable reference |
| **[`docs/RELEASING.md`](docs/RELEASING.md)** | Release process |
| **[`docs/I18N.md`](docs/I18N.md)** | Translation & localization workflow |
| **[`docs/COMPARISON.md`](docs/COMPARISON.md)** | OpenBuddy vs Cursor / Continue / aider / Copilot |
| **[`docs/adr/`](docs/adr/)** | Architecture decision records |
| **[`docs/openbuddy-product-vs-pi.md`](docs/openbuddy-product-vs-pi.md)** | How OpenBuddy extends Pi |
| **[`SECURITY.md`](SECURITY.md)** | Security policy & disclosures |
| **[`SUPPORT.md`](SUPPORT.md)** | How to get help |
| **[`SPONSORS.md`](SPONSORS.md)** | Sponsorship & funding |

---

## 🗺️ Roadmap

The full backlog lives in [`TODO.md`](TODO.md). The public roadmap is in **[`docs/ROADMAP.md`](docs/ROADMAP.md)**. Highlights:

### ✅ Shipped

- Core layout: Sidebar / HomePage / ChatView / Composer
- In-process Pi agent over the Electron bridge
- Design tokens & 207-icon foundation (all implemented, zero stubs)
- BYOK multi-provider config
- Skills / MCP / Experts surfaces
- Plan mode · Rewind · Tasks · Slash Commands · Automations
- Windows (NSIS) & macOS (DMG) installers
- CI release workflow (GitHub Actions)
- moon-managed monorepo (`moon run` everywhere, incremental DAG builds)
- Casdoor OIDC + NewAPI gateway

### 🚧 In progress

- SceneTabs & skill recommendation bar
- Pinned sessions & workspace grouping
- Permission management panel
- Search across sessions
- Linux builds (AppImage)
- Code signing & notarization

### 🔮 Next

- Plugin marketplace (public catalog + install flow)
- Web companion (read-only session view)
- Voice input / output
- Local vector store integration
- 12 more capability packages on the public roadmap

Want to influence the roadmap? Open an issue with the **`roadmap:` label** or join the discussion in **[`docs/COMMUNITY.md`](docs/COMMUNITY.md)**.

---

## 🤝 Contributing

OpenBuddy is early and moving fast — **contributions of every size are welcome.**

1. Read **[`CONTRIBUTING.md`](CONTRIBUTING.md)** for the workflow.
2. Read our **[`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md)**.
3. Pick an issue from [`TODO.md`](TODO.md) or open a new one to discuss.
4. Fork, branch from `master`, and hack.
5. Run `pnpm electron:dev` (= `moon run openbuddy:dev.electron`).
6. Open a PR — every PR is reviewed within 48h.

**Areas that especially need help right now:**

- 🐧 Linux packaging & smoke tests
- 🎨 UI polish / screenshots / icons
- 🌍 Docs & i18n (we want Japanese, Korean, Spanish, German next)
- 🔏 CI for macOS signing & notarization
- 🧪 Plugin marketplace catalog curation
- 💼 Enterprise deployment playbooks (Caddy / Nginx / Vault)

All contributors are listed in the GitHub contributors graph. New contributors get a 🎉 in the next release notes.

---

## 🛡️ Security

OpenBuddy treats security as a first-class concern:

- **Context-isolated renderer** with allowlisted IPC (`electron/preload/index.ts`)
- **Per-folder trust grants** via `@openbuddy/folder-trust`
- **Capability-level policy** via `@openbuddy/capability-authorization`
- **Casdoor OIDC** with PKCE and refresh token rotation
- **SCIM v2 / SAML 2.0** — tested seeds, **not wired** into the app (archived 2026-10-28; recoverable from git history)
- **Local-first audit ledger** persisted across restarts

See **[`SECURITY.md`](SECURITY.md)** for the full policy and how to report vulnerabilities.

---

## 🌍 Community

- **GitHub Discussions** — design proposals & help
- **GitHub Issues** — bug reports & feature requests
- **Discord** — real-time chat (link in [`docs/COMMUNITY.md`](docs/COMMUNITY.md))
- **WeChat group** — Chinese-language community
- **Office hours** — weekly video Q&A (announced in Discussions)

Full details, language-specific channels, and code-of-conduct enforcement contacts are in **[`docs/COMMUNITY.md`](docs/COMMUNITY.md)**.

---

## ⭐ Star History

If OpenBuddy has earned its place on your daily-driver list, please consider giving it a ⭐. It directly fuels the next release cycle.

<a href="https://star-history.com/#louloulin/OpenBuddy&Timeline">
  <img src="https://api.star-history.com/svg?repos=louloulin/OpenBuddy&type=Timeline" alt="Star History Chart" />
</a>

---

## 🙏 Acknowledgements

OpenBuddy stands on the shoulders of giants:

- **[Tencent WorkBuddy](https://workbuddy.tencent.com/)** — the design north star. OpenBuddy reuses WorkBuddy's `--wb-*` design tokens, 207-icon foundation (all implemented), and brand atoms for a pixel-close visual experience. *(Attribution: the visual foundation is theirs; everything else in this repository is not.)*
- **[Pi coding agent](https://github.com/badlogic/pi-mono)** — the in-process agent runtime behind OpenBuddy's Electron host.
- **[Cordis](https://github.com/cordisjs/cordis)** — the dependency-injection framework that powers our capability mesh.
- **[moon](https://moonrepo.dev)** · **[Electron](https://www.electronjs.org/)** · **[React](https://react.dev/)** · **[Vite](https://vitejs.dev/)** — moon orchestrates every task; Electron hosts the Cordis/Pi runtime; React + Vite ship the renderer.
- **[Casdoor](https://casdoor.org/)** · **[NewAPI](https://github.com/songquanpeng/new-api)** — the open-source OIDC IdP and model gateway we integrate with.
- **[Vitest](https://vitest.dev/)** · **[Playwright](https://playwright.dev/)** — the test frameworks that keep us honest.

This project is an independent, community-driven open-source effort and is **not affiliated with, endorsed by, or sponsored by Tencent.**

---

## 📄 License

OpenBuddy is released under the **[MIT License](LICENSE)** — © OpenBuddy contributors.

You are free to use, modify, and distribute OpenBuddy in your own projects, commercial or otherwise, as long as you preserve the copyright notice.
