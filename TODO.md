# OpenBuddy TODO

**English** · [简体中文](TODO.zh-CN.md)

### Current focus

**Make OpenBuddy v0.16 (Linux first-class) shippable.** All work below ladders up to the [`docs/ROADMAP.md`](docs/ROADMAP.md) public themes.

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

#### 🚧 Plugin marketplace (planned for v0.17)

- [ ] Public catalog at <https://openbuddy.dev/marketplace>
- [ ] One-click install in app
- [ ] Capability versioning (semver)

### Architecture debt

- [ ] `electron/main/index.ts` Cordis `mount*()` calls Cordis `mount*()` calls → refactor to `app-desktop`'s `tasks.plugin` (moon-driven runtime)
- [ ] moon remote cache + `pnpm cache` integration
- [ ] SQL schema migration framework (currently hand-rolled per capability)

### Documentation improvements

- [ ] Translate the docs/ to Japanese, Korean (after v0.16 ships)
- [ ] Record architecture overview video for YouTube
- [ ] Build a "Day in the life of an OpenBuddy session" infographic

### Tech debt (low priority)

- [ ] Replace 8 known TypeScript errors in `renderer-plugin-runtime.ts` and `use-email-keyboard.test.ts` (orthogonal to v0.16 work)
- [ ] Consolidate duplicate IPC handlers in `electron/main/ipc/` (47 handlers across 8 files)
- [ ] Reduce Vitest total runtime below 3 min (currently ~3:20)

### Completed (recent)

- [x] moon-managed monorepo (32-project DAG, `moon run` everywhere) — v0.14
- [x] Casdoor × NewAPI × OpenBuddy enterprise integration — v0.15
- [x] Admin Portal SPA with Resource Gateway — v0.15
- [x] 309 test files (Vitest) — visible to every contributor
- [x] Bilingual EN/中文 documentation suite (35,000+ lines) — v0.15
- [x] GitHub community infrastructure (CODEOWNERS, label guide, workflows, templates)

### How to help

Pick an item above and open a PR. For items in **Active work**, coordinate with `@louloulin/build` first. For items in **Architecture debt** or **Documentation**, open a Discussion and propose an approach.

For community-contributedable items, look at [GitHub Issues labeled `good first issue`](https://github.com/louloulin/OpenBuddy/labels/good%20first%20issue).
