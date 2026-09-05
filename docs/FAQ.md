# Frequently Asked Questions

**English** · [简体中文](FAQ.zh-CN.md)

### General

#### What is OpenBuddy?

OpenBuddy is a 100% open-source (MIT) desktop AI workspace. It has the same shape of experience as Tencent's WorkBuddy — polished UI, plan mode, skills, MCP connectors — but the codebase is fully auditable, you bring your own API keys, and your data stays local.

#### How is OpenBuddy different from WorkBuddy?

| | WorkBuddy | OpenBuddy |
|---|---|---|
| License | Closed-source | MIT (open) |
| Data path | Tencent backend | Local + your gateway |
| Provider choice | Limited | BYOK — any provider |
| Plugin SDK | Closed | Cordis open capability mesh |
| Visible tests | ❌ | 309 test files in the repo |

See [`workbuddy-parity-matrix.md`](workbuddy-parity-matrix.md) for the full comparison.

#### Is this an official Tencent project?

**No.** OpenBuddy is an independent, community-driven open-source effort. It is not affiliated with, endorsed by, or sponsored by Tencent. The WorkBuddy design tokens and 207-icon set are open source assets that OpenBuddy reuses under the original license.

#### Who maintains OpenBuddy?

The [OpenBuddy contributors](https://github.com/louloulin/OpenBuddy/graphs/contributors) — a worldwide group of open-source developers. There is no single company behind it.

---

### Installation

#### Which platforms are supported?

- **Windows** — Windows 10+ (NSIS `.exe` and MSI installers)
- **macOS** — macOS 11 Big Sur+ (`.dmg`, Intel + Apple Silicon)
- **Linux** — Ubuntu 22.04+, Fedora 38+ (AppImage and `.deb`; RPM coming)

#### Can I run OpenBuddy from source without building an installer?

Yes. See [`GETTING_STARTED.md`](GETTING_STARTED.md). You can have the dev environment running in ~5 minutes.

#### What are the minimum hardware requirements?

- 4 GB RAM (8 GB recommended for multi-agent workloads)
- 2 GB free disk space
- Any x86_64 or arm64 CPU released after 2018

---

### Providers & API keys

#### Do I have to use a specific provider?

No. OpenBuddy supports:

- **Anthropic** (Claude 3.5 Sonnet, Claude 3 Opus, …)
- **OpenAI** (GPT-4o, GPT-4-turbo, o1, …)
- **OpenAI-compatible** (Azure OpenAI, Together, Groq, …)
- **NewAPI** (self-hosted model aggregator, BYOK)
- **Custom** (any base URL + key)

Configure in **Settings → Providers**. Keys are encrypted via Electron `safeStorage` and stored in your OS keychain.

#### Where are my API keys stored?

In the OS keychain (Windows Credential Manager / macOS Keychain / Linux Secret Service) via Electron's `safeStorage` API. They are never written to disk in plaintext.

#### Can I use multiple providers at once?

Yes. You can configure unlimited providers in Settings. Select the active one per session.

#### Does OpenBuddy log my prompts?

OpenBuddy writes **only** to its local audit log (`~/.config/openbuddy/audit.log`) on privileged operations (file access, network calls, permission grants). The audit log never leaves your machine unless you explicitly configure Casdoor sync.

The actual prompt content is held only in your local session JSONL files in `~/.config/openbuddy/sessions/`.

---

### Features

#### Does OpenBuddy support plan mode?

Yes. Toggle **Plan Mode** in the composer. The agent will plan first, then execute after your approval.

#### Can I use skills?

Yes. Skills are Markdown files with YAML frontmatter, stored in `~/.config/openbuddy/skills/`. OpenBuddy auto-discovers and lists them. See [`PLUGIN_DEVELOPMENT.md`](PLUGIN_DEVELOPMENT.md) for how to write your own.

#### Can I connect MCP servers?

Yes. Open `Settings → MCP Connectors` and add a server. You can configure stdio, SSE, or HTTP transports, plus OAuth.

#### Does OpenBuddy support sub-agents?

Yes. OpenBuddy has a full multi-agent runtime: sub-agents, teams, rooms, inbox, and A2A protocol. See [`distributed-buddy-network-architecture.md`](distributed-buddy-network-architecture.md).

#### Can I extend OpenBuddy?

Yes. Three options:

1. **Capability package** — add to `packages/` and contribute back (best for in-tree features)
2. **Plugin** — build a runtime-loadable plugin in `~/.config/openbuddy/plugins/` (best for private features)
3. **Fork** — fork the repo and ship your own variant (best for heavy divergence)

See [`PLUGIN_DEVELOPMENT.md`](PLUGIN_DEVELOPMENT.md) for details.

---

### Architecture & code

#### Why Electron and not Tauri?

Tauri was the original choice; we migrated to Electron because:

- Better ecosystem support for our dependency-injection needs (Cordis)
- First-class support for IPC streaming patterns we needed
- Mature tooling for cross-platform installers (electron-builder)
- Easier debugging via Chrome DevTools

See [`tauri-grok-removal-and-cordis-adoption.md`](tauri-grok-removal-and-cordis-adoption.md) for the full migration story.

#### Why moon instead of Turborepo / Nx?

- moon's DAG is explicit and inspectable (`moon project-graph --json`)
- moon's task system is the same in CI and locally (no separate CI runner)
- moon's caching is more predictable (no accidental cache invalidations)
- moon's tasks can target specific projects (`moon run openbuddy:dev.electron`)

See [`moon-monorepo-refactor.md`](moon-monorepo-refactor.md) for the full rationale.

#### Why Cordis instead of plain DI?

- Cordis gives us plugin lifecycle (init → ready → dispose)
- Service disposal is automatic and clean
- Plugin isolation prevents accidental cross-service coupling
- Config is typed and validated at startup

---

### Enterprise

#### Can I self-host Casdoor?

Yes. Casdoor is open source: [casdoor.org](https://casdoor.org/). OpenBuddy ships the full client + admin REST integration.

#### Can I use a self-hosted LLM gateway?

Yes. NewAPI is open source: [github.com/songquanpeng/new-api](https://github.com/songquanpeng/new-api). Point OpenBuddy's NewAPI preset at your instance and BYOK.

#### Does OpenBuddy support SSO?

Yes. Casdoor OIDC + SAML 2.0 + SCIM v2 are all supported. See [`casdoor-enterprise-auth.md`](casdoor-enterprise-auth.md) and [`enterprise-casdoor-newapi-openbuddy-architecture.md`](enterprise-casdoor-newapi-openbuddy-architecture.md).

#### Can I run OpenBuddy in CI to test?

Yes. `pnpm test:closed-loop` runs the agent against a fixture and scores the output. CI-friendly with no UI dependencies. See [`electron-testing.md`](electron-testing.md).

---

### Troubleshooting

#### The Electron window is blank

1. Open DevTools (View → Toggle Developer Tools) and check the console.
2. Run `pnpm dev:renderer` separately to confirm Vite is running.
3. Check port 5173 is free.

#### `pnpm install` fails with EACCES

Add yourself to the `dialout` group (Linux) or fix npm prefix permissions (macOS/Linux):

```bash
mkdir -p ~/.npm-global
npm config set prefix '~/.npm-global'
export PATH=~/.npm-global/bin:$PATH
```

#### Electron-builder download fails

Set the npmmirror mirror env vars (see `electron-builder.yml`):

```bash
export ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
export ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"
```

#### Tests fail with "Cannot find module '@openbuddy/...'"

```bash
rm -rf node_modules .moon/cache
pnpm install
pnpm moon:sync
```

#### The Pi agent hangs

1. Check your API key in Settings.
2. Verify network egress: `curl https://api.anthropic.com/v1/messages`.
3. Look at the audit log: `~/.config/openbuddy/audit.log`.

#### My question isn't answered here

Open a [GitHub Discussion › Q&A](https://github.com/louloulin/OpenBuddy/discussions/categories/q-a) or join [Discord](https://discord.gg/openbuddy).
