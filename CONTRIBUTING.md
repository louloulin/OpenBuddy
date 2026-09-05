# Contributing to OpenBuddy

**English** · [简体中文](CONTRIBUTING.zh-CN.md)

Thank you for considering contributing to OpenBuddy. It's people like you who make OpenBuddy a great tool for the open AI workspace community. We welcome contributions of every size — from one-character typo fixes to full-blown capability packages.

---

### Code of Conduct

By participating, you agree to uphold our [Code of Conduct](CODE_OF_CONDUCT.md). Please read it before you start.

### What we accept

We accept contributions in the following areas:

| Area | Examples | First-stop label |
|---|---|---|
| 🐛 **Bug fixes** | Crash, regression, memory leak | `bug` |
| ✨ **Features** | New capability, new provider, new UI screen | `enhancement` |
| 📖 **Docs** | README, docs/, docstrings, i18n | `docs` |
| 🧪 **Tests** | New Vitest specs, smoke harness coverage | `tests` |
| 🎨 **UI / UX** | Pixel polish, new icon, accessibility | `ui` / `a11y` |
| 🌍 **i18n** | Translation, locale data | `i18n` |
| ⚡ **Performance** | Bundle size, startup time, IPC latency | `perf` |
| 🔏 **Build / CI** | electron-builder, GitHub Actions, moon | `ci` |
| 📦 **Plugins** | New `@openbuddy/*` capability package | `plugin` |
| 🔬 **Research** | Eval suite, benchmark adapter | `eval` |

If you're unsure whether your idea fits, **open an issue first** — we'd rather discuss than close.

### What we *don't* accept (without prior discussion)

- Changes that touch > 5 packages in a single PR without prior issue alignment
- New dependencies added at the root `package.json` (use a workspace package)
- Switching off TypeScript strict mode
- Removing the Casdoor / NewAPI integration surface
- Renaming public IPC channels (`electron/preload/index.ts`)

### First-time contributors

Look for issues with these labels:

- [`good first issue`](https://github.com/louloulin/OpenBuddy/labels/good%20first%20issue) — small, well-scoped, mentor-friendly
- [`help wanted`](https://github.com/louloulin/OpenBuddy/labels/help%20wanted) — needs a hand, no mentor commitment
- [`docs`](https://github.com/louloulin/OpenBuddy/labels/docs) — no code, just words
- [`i18n`](https://github.com/louloulin/OpenBuddy/labels/i18n) — translation work

### Development workflow

#### 1. Fork & clone

```bash
git clone --recurse-submodules https://github.com/<your-name>/OpenBuddy.git
cd OpenBuddy
git remote add upstream https://github.com/louloulin/OpenBuddy.git
```

#### 2. Branch from `master`

```bash
git fetch upstream
git checkout -b feat/short-name upstream/master
```

> OpenBuddy uses **`master`** as the default branch (we mirror the moon workspace convention from `.moon/workspace.yml`). Make sure your branch is based on the latest upstream `master`, not `main`.

#### 3. Install & verify

```bash
pnpm install               # installs deps + runs `moon sync projects`
pnpm workspace:typecheck   # type-check all 32 projects
pnpm workspace:test        # run the 309 Vitest test files
```

#### 4. Make your change

Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and [`docs/GETTING_STARTED.md`](docs/GETTING_STARTED.md) first. Then make your change.

**Conventional commits** are encouraged (but not required) for commit messages:

```
feat(capability-memory): add cross-session recall
fix(electron-ipc): handle empty event payload
docs(readme): add Linux screenshot
test(plugin-host): cover 30s reload timeout
chore(deps): bump cordis to 3.18.1
```

#### 5. Test your change

| Test type | Command | When |
|---|---|---|
| Type-check | `pnpm workspace:typecheck` | Always |
| Unit tests | `pnpm workspace:test` | Always |
| Single package | `cd packages/<group>/<name> && pnpm test` | Touching one package |
| Storage boundaries | `pnpm storage:boundaries` | Touching `packages/runtime/openbuddy-storage` |
| Electron smoke | `pnpm test:electron` | Touching Electron main or preload |
| Surface regression | `pnpm test:electron:surface` | Touching IPC channels |
| Closed-loop eval | `pnpm test:closed-loop` | Touching the agent flow |
| Real-UI smoke | `pnpm test:electron:real-ui` | Touching the renderer |

If your change adds new IPC channels, also run `node scripts/electron/audit-agent-surface.mjs` and update the audit snapshot.

#### 6. Open a PR

- Target branch: **`master`**
- Title: imperative mood, ≤ 72 chars (e.g. `feat(email): add Gmail API draft support`)
- Body: link the issue, describe what changed and why, include before/after screenshots for UI changes
- PR template: see `.github/PULL_REQUEST_TEMPLATE.md` (auto-populated)
- All PRs trigger CI — green CI is required for merge

#### 7. Review process

- A maintainer will respond **within 48h** with either 👍 + comments, or a request for changes.
- We use **conventional comments** in review (e.g. `nit:`, `question:`, `suggestion:`, `issue:`).
- Once approved, a maintainer will squash-merge with a Conventional Commit message.

### Coding standards

#### TypeScript

- TypeScript 5.6 strict mode is enforced.
- `any` is forbidden in `packages/` and `electron/`. Use `unknown` + narrowing.
- Public APIs must export type definitions alongside the runtime.
- All IPC channels must be added to the allowlist in `electron/preload/index.ts` AND have a matching typed wrapper in `src/lib/electron-api.ts`.

#### React

- Functional components only. No class components.
- Zustand stores go in `src/stores/` (one per concern).
- Side effects in `useEffect` must declare **every** dependency.
- No CSS-in-JS. Use the `--wb-*` design tokens from `src/styles/tokens.css`.

#### Cordis capabilities

- One capability package per concern, under `packages/<group>/openbuddy-*/`.
- Must export `apply(ctx: Context)` as the default entry point.
- Must have a corresponding Vitest spec under `src/__tests__/`.
- Storage access must go through `@openbuddy/storage` — **no direct `fs` calls** in capability code.

#### Documentation

- Every PR that adds a feature must also add or update the doc page that describes it.
- Every PR that adds a new IPC channel must also add a row to `docs/openbuddy-ipc-surface.md` (auto-generated; just rerun `pnpm test:electron:ipc-surface`).
- Every PR that adds a new env var must add it to `docs/ENVIRONMENT.md` (auto-generated).
- Every PR that adds a new `@openbuddy/*` package must add it to the capability matrix in `docs/openbuddy-capability-matrix.md`.

#### Commit hygiene

- One logical change per commit.
- No "WIP" or "fix typo" commits in a PR — squash locally before pushing.
- Commit author email must be a real address (Gravatar-compatible if you want an avatar).

### Release process

OpenBuddy uses [semantic versioning](https://semver.org/) and ships every 2–4 weeks. The release process is fully automated via `.github/workflows/release.yml`:

1. Maintainer triggers a `workflow_dispatch` with the new tag (e.g. `v0.15.0`).
2. CI runs typecheck + tests across all 32 projects.
3. CI builds Windows NSIS+MSI, macOS DMG (signed), and Linux AppImage+deb.
4. CI publishes a draft GitHub Release with auto-extracted notes from `CHANGELOG.md`.
5. Maintainer reviews the draft and clicks "Publish".
6. auto-updater (`electron-updater`) notifies existing installs.

### Getting help

- **GitHub Discussions** — design questions, help requests, show & tell
- **Discord** — real-time chat (link in [`docs/COMMUNITY.md`](docs/COMMUNITY.md))
- **Office Hours** — weekly video Q&A (announced in Discussions)

### Recognition

All contributors are listed in the GitHub Contributors graph and acknowledged in release notes. New contributors receive a 🎉 in their first PR's merge commit.
