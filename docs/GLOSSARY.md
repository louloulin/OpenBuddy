# Glossary

> 🌐 **Language / 语言:** [English](#english) · [简体中文](#简体中文)

Terms used across OpenBuddy's docs, code, and UI. Keep this up to date as new concepts emerge.

---

<a id="english"></a>
## 🇬🇧 English

### Core

| Term | Definition |
|---|---|
| **OpenBuddy** | The open-source desktop AI workspace this repo builds. |
| **OpenBuddy Pi** | The full product name, including the underlying Pi agent runtime attribution. |
| **Pi** | The agent runtime that powers OpenBuddy's prompt loop. |
| **Agent** | A Pi-managed entity that owns prompts, tools, permissions, plans, and tasks. |
| **Session** | A single conversation between a user and an agent. |
| **Cordis** | The dependency-injection framework OpenBuddy uses for its capability mesh. |
| **Context (Cordis)** | The shared service registry that all capabilities attach to. |

### Architecture

| Term | Definition |
|---|---|
| **Renderer** | The React + Vite UI process that runs in Electron's BrowserWindow. |
| **Main** | The Electron main process — hosts Cordis and + the IPC surface. |
| **Preload** | The Electron preload script — exposes the allowlisted `window.api` to the renderer. |
| **IPC** | Inter-process communication between renderer and main. OpenBuddy uses allowlisted channels. |
| **contextBridge** | Electron's safe API for exposing preload functions to a sandboxed renderer. |
| **moon** | The monorepo tool that orchestrates all build / test / dev / release tasks. |
| **Vite** | The build tool for the renderer. |
| **electron-vite** | The Vite-based bundler for main + preload + renderer in one orchestration. |

### Capabilities

| Term | Definition |
|---|---|
| **Capability** | A Cordis service that exposes a feature (`@openbuddy/capability-*`). |
| **Plugin** | A runtime-loadable Cordis service from `~/.openbuddy/plugins/` (no rebuild). |
| **Skill** | A Markdown file with YAML frontmatter that teaches the agent a new behavior. |
| **MCP** | Model Context Protocol — the standard for tool integration. |
| **MCP connector** | A registered MCP server, configured in OpenBuddy settings. |
| **Expert** | A persistent agent configuration (system prompt + tools). |
| **Task** | A sub-agent spawned by the main agent. |
| **Team** | A coordinated group of agents with shared rooms and inbox. |
| **Room** | A shared space for cross-agent messages. |
| **Inbox** | A cross-agent message queue. |
| **A2A** | Agent-to-agent — the protocol OpenBuddy uses for inter-agent communication. |

### User-facing features

| Term | Definition |
|---|---|
| **Plan mode** | A mode where the agent plans before executing, with user approval. |
| **Rewind** | Undo the last N steps in a session, optionally forking. |
| **Fork** | Branch a session at a rewind point. |
| **Slash command** | A `/-prefixed` shortcut in the composer (e.g. `/plan`, `/rewind`). |
| **Automation** | A scheduled task that runs the agent on a cron / event trigger. |
| **Notification** | An in-app or OS-level alert about agent activity. |
| **Memory** | Long-term context the agent can recall across sessions. |
| **Web search** | A provider-pluggable way for the agent to look things up online. |
| **Inspiration** | A prompt template / starter for common tasks. |

### Persistence

| Term | Definition |
|---|---|
| **Pi data directory** | Where Pi stores its config (provider keys, etc.). |
| **OpenBuddy data directory** | `~/.config/openbuddy/` on Linux/macOS, `%APPDATA%\openbuddy\` on Windows. |
| **Session JSONL** | Append-only JSON-lines file per session. |
| **Audit ledger** | Append-only, hash-chained log of privileged operations. |
| **Folder trust** | A user-granted permission for the agent to access a folder. |
| **safeStorage** | Electron API for encrypting secrets in the OS keychain. |

### Providers

| Term | Definition |
|---|---|
| **Provider** | An LLM API that OpenBuddy can call (Anthropic, OpenAI, NewAPI, …). |
| **BYOK** | "Bring Your Own Key" — user supplies their own API key. |
| **Service Token** | A server-side token for OpenBuddy to call NewAPI on behalf of a user. |
| **NewAPI** | The self-hosted model aggregator we integrate with. |
| **Anthropic** | Maker of Claude. |
| **OpenAI** | Maker of GPT-4 / o1. |
| **NewAPI channel** | A single LLM provider registered inside a NewAPI instance. |

### Enterprise

| Term | Definition |
|---|---|
| **Casdoor** | The OIDC IdP we ship a full client + admin REST for. |
| **OIDC** | OpenID Connect — the SSO protocol OpenBuddy uses. |
| **PKCE** | Proof Key for Code Exchange — OIDC extension for desktop apps. |
| **SAML** | Security Assertion Markup Language — federation protocol. |
| **SCIM** | System for Cross-domain Identity Management — provisioning protocol. |
| **OIDC tenant** | An isolated Casdoor organization with its own users / policies. |
| **Audit log shipping** | Streaming the audit ledger to a SIEM. |
| **Transactional outbox** | Pattern for at-least-once webhook delivery. |

### Development

| Term | Definition |
|---|---|
| **moon project** | One unit of the monorepo DAG (renderer / Electron / 30+ packages). |
| **moon task** | A script that runs against a project (e.g. `dev`, `build`, `test`). |
| **Vitest** | The test runner. |
| **Playwright** | The browser-automation tool used for Electron smoke tests. |
| **Zustand** | The state-management library for the renderer. |
| **Cordis plugin** | A `Service` subclass that gets injected into a context. |
| **IPC channel** | A named string like `"agent:prompt"` that bridges renderer ↔ main. |

### Build / ship

| Term | Definition |
|---|---|
| **NSIS** | The Windows installer format OpenBuddy uses. |
| **DMG** | The macOS installer format. |
| **AppImage** | The portable Linux installer format. |
| **electron-builder** | The tool that produces cross-platform installers. |
| **electron-updater** | The auto-update library that talks to GitHub Releases. |
| **Notarization** | Apple's process for verifying that a binary is safe to run. |
| **Code signing** | Cryptographically signing a binary to prove its origin. |

---

<a id="简体中文"></a>
## 🇨🇳 简体中文

### 核心

(同英文)

### 架构

(同英文)

### 能力

(同英文)

### 用户面功能

(同英文)

### 持久化

(同英文)

### Provider

(同英文)

### 企业

(同英文)

### 开发

(同英文)

### 构建 / 发布

(同英文)

---

<div align="center">

**A shared vocabulary prevents confusion. / 共同词汇库,避免误解。**

<sub>Missing a term? Open a PR editing this file. / 缺词条?开 PR 编辑此文件。</sub>

</div>
