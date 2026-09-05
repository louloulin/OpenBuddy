# Getting Started

**English** · [简体中文](GETTING_STARTED.zh-CN.md)

### 1. Prerequisites

Install these once on your machine:

| Tool | Version | How to get it |
|---|---|---|
| **Node.js** | 22.x LTS | [nodejs.org](https://nodejs.org/) or `nvm install 22` |
| **pnpm** | 10+ | `npm install -g pnpm` |
| **Git** | 2.30+ | [git-scm.com](https://git-scm.com/) |
| **Moon** | 2.5+ | Auto-installed by `pnpm install` as `@moonrepo/cli` |

Optional per platform:

| Platform | Need it for |
|---|---|
| **Windows** | NSIS + MSI build → install [NSIS 3](https://nsis.sourceforge.io/) and [WiX Toolset 3](https://wixtoolset.org/) |
| **macOS** | DMG + notarization → install Xcode Command Line Tools (`xcode-select --install`) |
| **Linux** | AppImage + .deb → `sudo apt install rpm fakeroot` |

Verify:

```bash
node --version    # v22.x
pnpm --version    # 10.x
git --version     # 2.30+
```

### 2. Clone

```bash
git clone --recurse-submodules https://github.com/louloulin/OpenBuddy.git
cd OpenBuddy
```

> ⚠️ **`--recurse-submodules` is required** — the Pi submodule is checked in alongside the main repo.

### 3. Install

```bash
pnpm install
```

This does three things in order:

1. Installs all dependencies for the 19 moon projects via `pnpm`.
2. Runs `moon sync projects` to register the workspace DAG.
3. Auto-generates TS path aliases used by `packages/ui`.

Expected output ends with `Done in <N>s.`

### 4. Start the dev shell

```bash
pnpm electron:dev
```

What's running:

- **Electron main process** — Cordis + Pi runtime
- **Preload bridge** — allowlisted IPC
- **Vite dev server** — React renderer with HMR at `http://localhost:5173`
- **moon watcher** — rebuilds any `@openbuddy/*` workspace package you edit

Open the app — you should see the OpenBuddy window with the chat composer. Try typing a message. The provider defaults to a built-in stub unless you configure a real one in **Settings → Providers**.

### 5. Add your first provider key

In the app, **Settings → Providers → Add Provider**, then choose:

- **Anthropic** — paste your `sk-ant-…` key
- **OpenAI** — paste your `sk-…` key
- **NewAPI** — paste your self-hosted key (BYOK)
- **Custom** — any OpenAI-compatible base URL + key

Keys are stored encrypted in your OS keychain via the Electron `safeStorage` API.

### 6. Make your first code change

A good first change: open `src/styles/tokens.css` and tweak the `--wb-accent` color. Save — the Vite HMR instantly reflects in the running app, no reload.

A slightly larger first change: pick a `feat(good-first-issue)` from the GitHub issue list, fork the repo, branch off `master`, and make the change.

### 7. Test your change

```bash
# Type-check the full monorepo
pnpm workspace:typecheck

# Run all unit tests (309 test files)
pnpm workspace:test

# Run just the test for a single package
cd packages/capability/openbuddy-memory && pnpm test

# Run the closed-loop agent evaluation
pnpm test:closed-loop
```

### 8. Build a production installer

```bash
# Pick your platform:
pnpm electron:build:win     # NSIS .exe + MSI
pnpm electron:build:mac     # signed .dmg
pnpm electron:build:linux   # AppImage + .deb
```

The installer lands in `release/<version>/`. For all-platform builds, run `pnpm electron:build:all`.

### 9. Next steps

- Read [`ARCHITECTURE.md`](ARCHITECTURE.md) to understand the codebase.
- Read [`PLUGIN_DEVELOPMENT.md`](PLUGIN_DEVELOPMENT.md) to build your first capability package.
- Read [`../CONTRIBUTING.md`](../CONTRIBUTING.md) to learn the PR workflow.
- Join the [Discord](https://discord.gg/openbuddy) for real-time help.

### Troubleshooting

#### `moon: command not found`

`pnpm install` should have added `node_modules/.bin` to your PATH. If it didn't:

```bash
pnpm exec moon sync projects
```

#### Electron window is blank

1. Open DevTools (View → Toggle Developer Tools) and check the console.
2. Most likely cause: Vite dev server failed to start. Run `pnpm dev:renderer` in a separate terminal and check for port 5173 conflicts.

#### `pnpm install` fails on Apple Silicon

The `bufferutil` and `utf-8-validate` native modules need a working C++ toolchain. Install Xcode CLT: `xcode-select --install`.

#### Tests fail with "Cannot find module '@openbuddy/...'"

You missed `pnpm install` or `moon sync projects`. Re-run both.

#### `electron:build` fails downloading Electron binary

Set the npmmirror mirror env vars (see `electron-builder.yml`):

```bash
export ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
export ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"
```
