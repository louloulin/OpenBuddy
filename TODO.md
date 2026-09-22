# OpenBuddy TODO

**English** · [简体中文](TODO.zh-CN.md)

### Current focus

**Make OpenBuddy v0.16.0 shippable.** All work below ladders up to the [`docs/ROADMAP.md`](docs/ROADMAP.md) public themes.

### Active work

#### 🚧 Linux packaging

- [ ] Linux AppImage build (electron-builder `linux.target = AppImage`)
- [ ] Linux `.deb` build (electron-builder `linux.target = deb`)
- [ ] Ubuntu 22.04 smoke harness in CI
- [ ] Fedora 38 smoke harness in CI
- [ ] Fix Wayland / X11 detection logic

#### 🚧 Code signing

- [ ] macOS notarization automation (see [`docs/macos-signing.md`](docs/macos-signing.md))
- [ ] Windows EV certificate integration
- [ ] Document signing workflow in [`docs/RELEASING.md`](docs/RELEASING.md)

#### 🚧 Permissions UI

- [ ] Permission management panel (granted / denied / revoked)
- [ ] Per-session permission overrides
- [ ] Folder trust UI polish

#### 🚧 Plugin marketplace (partially shipped in v0.16.0)

- [x] In-app install / uninstall + multi-source index (host / env / file) — v0.16.0
- [x] Capability versioning (semver `engines.openbuddy` range check) — v0.16.0
- [x] Plugin integrity badge (SHA-256 via `plugin:hash-content`) — v0.16.0
- [x] Marketplace search / filter + source management UI — v0.16.0
- [ ] Public catalog at <https://openbuddy.dev/marketplace>

### Architecture debt

- [ ] `electron/main/index.ts` Cordis `mount*()` calls Cordis `mount*()` calls → refactor to `app-desktop`'s `tasks.plugin` (moon-driven runtime)
- [ ] moon remote cache + `pnpm cache` integration
- [ ] SQL schema migration framework (currently hand-rolled per capability)

### Documentation improvements

- [ ] Translate the docs/ to Japanese, Korean (after the v0.16.0 line stabilizes)
- [ ] Record architecture overview video for YouTube
- [ ] Build a "Day in the life of an OpenBuddy session" infographic

### Tech debt (low priority)

- [ ] Replace the 8 remaining known TypeScript errors in `renderer-plugin-runtime.ts` and `use-email-keyboard.test.ts` (orthogonal to v0.16.0 work)
- [ ] Consolidate duplicate IPC handlers in `electron/main/ipc/` (47 handlers across 8 files)
- [ ] Reduce Vitest total runtime below 3 min (currently ~3:20)

### Completed (recent)

- [x] Microkernel slot surface: "declared but unconsumed" = 0 + three-state audit — v0.16.0
- [x] Plugin trust: integrity badge + Pi extension marketplace (multi-source, search, uninstall) — v0.16.0
- [x] `electron-updater` wired at startup + unsigned DMG profile + `docs/PRIVACY.md` — v0.16.0
- [x] Renderer contract packages (`ui-contract` / `platform` / `agent-rpc` / `ui-state`) + tsconfig collapse — v0.16.0
- [x] Build output `out/` → `dist/`, 134 stray emit artifacts removed — v0.16.0
- [x] One-command version bump (`scripts/bump-version.mjs`, 88 files) — v0.16.0
- [x] moon-managed monorepo (32-project DAG, `moon run` everywhere) — v0.15.0
- [x] Casdoor × NewAPI × OpenBuddy enterprise integration — v0.15.0
- [x] Admin Portal SPA with Resource Gateway — v0.15.0
- [x] 855 test / spec files in the workspace — visible to every contributor
- [x] Bilingual EN/中文 documentation suite (35,000+ lines) — v0.15.0
- [x] GitHub community infrastructure (CODEOWNERS, label guide, workflows, templates)

### How to help

Pick an item above and open a PR. For items in **Active work**, coordinate with `@louloulin/build` first. For items in **Architecture debt** or **Documentation**, open a Discussion and propose an approach.

For community-contributedable items, look at [GitHub Issues labeled `good first issue`](https://github.com/louloulin/OpenBuddy/labels/good%20first%20issue).
