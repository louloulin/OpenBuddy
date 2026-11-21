# OpenBuddy

[中文文档（默认）](README.md)

OpenBuddy is a React desktop workspace migrating to Electron and the in-process Pi coding agent. The Electron MVP targets chat, sessions, tools, workspace files, model/BYOK settings, permissions, MCP configuration, skills and notifications. This branch is migration work; a version number in package.json does not imply a published release.

[简体中文](README.zh-CN.md)

## Development

Use Node.js 22.19.0 or newer (Node 24 recommended) and pnpm 10.29.3. Electron 45.3.0 and `@earendil-works/pi-coding-agent` 1.5.2 are pinned from the npm registry. The downloaded macOS arm64 binary reports Electron 45.3.0, Node 24.22.2 and Chromium 156.0.8078.96.

```sh
pnpm install --frozen-lockfile
pnpm dev:electron
pnpm test
pnpm build:electron
pnpm pack:electron
pnpm dist:electron
```

`pnpm dev` starts the browser-only Vite preview; native platform operations require `dev:electron`. Restart the Electron development command after changing main/preload code. Packaging uses the current host platform by default. `pnpm dist:mac` targets DMG and `pnpm dist:win` targets NSIS; native host verification is still required for each platform. Output is written to `release/`.

## Architecture and security

The React renderer communicates through `window.openbuddy`, a restricted context bridge. The main process validates the sender, command and payload before invoking services. The renderer runs with context isolation, sandboxing and Node integration disabled. CSP restricts renderer execution; navigation and popups are blocked, and external links allow only HTTP/HTTPS. Saving an export requires a native save dialog authorization.

Pi runs in the main process. Application data lives beneath Electron's `userData` directory in `pi/`; the application does not automatically use `~/.pi`. API keys use Electron safeStorage, and configurations must not be treated as a backup of credentials. Existing Tauri/ACP sessions are not automatically converted to Pi's session format.

### Code layout

The repository is a pnpm workspace. Packages are consumed as TypeScript source: `tsconfig.base.json` paths (which esbuild also uses for the main process) and matching Vite/Vitest aliases map `@openbuddy/<package>[/<subpath>]` to `packages/<package>/src/…`; there is no separate package build step.

```text
apps/desktop      Electron host: main/, preload/, ipc/register.ts, scripts/ (build, dev, UI checks)
apps/web          React renderer: src/app (shell, palette, routing), src/features/*, src/shared/*
packages/protocol IPC contract (commands, events) and DTO types
packages/kernel   ports the host implements (events, shell, secrets, clock, logger) and payload validators (pure TS)
packages/services settings, providers, mcp, skills, files, preview (Node)
packages/engine   Pi session engine, permissions, extension UI bridge, checkpoints, artifacts (Node)
packages/host     IPC command handlers and file/workspace access guards (Node)
packages/client   renderer-side IPC client
packages/chat-core headless chat logic: turns, tool summaries, diffs, export, error text
packages/platform platform utilities (clipboard, platform detection)
packages/ui       icons, Toast, ImageLightbox, ThemeProvider, LetterAvatar, design tokens
packages/markdown Markdown rendering pipeline and code-block actions
tools/            boundary checker, move codemod, IPC audit, verification scripts
```

Allowed dependency directions are enforced by `tools/check-boundaries.mjs`, which runs inside `pnpm test` and fails when any category (layering, forbidden imports, direct bridge use, cross-feature edges, cycles, unreachable files, oversized files) grows beyond `tools/boundaries-baseline.json`. Electron-only APIs belong in `apps/desktop`; `protocol`, `client` and `chat-core` stay free of Node and React so that a web or mobile shell can reuse them.

```sh
pnpm typecheck          # renderer + main process
pnpm check:boundaries   # module boundaries against the baseline
pnpm verify:e2e         # real Electron walkthrough with a local fixture (needs pnpm build:electron; xvfb on Linux)
```

## Features and local verification

Models use a complete provider/model identity, and thinking controls reflect the active model's actual capabilities. Restoring a session reads the engine's model state. Pi input/select/confirm/editor requests use desktop forms; steering/follow-up queues and idle session forks use the SDK. Custom terminal UI components are unsupported.

Attachments require native picker or genuine File grants, file identity checks and real image decoding. Limits are 10 MiB per image, 20 MiB total, eight attachments, and 256 KiB per UTF-8 text file. Extensions are disabled by default and require explicit native path selection and enablement. Unknown project extensions are not automatically executed. Project cloud collaboration, invitations and uploads remain deferred.

```sh
pnpm audit:ipc
pnpm build:electron
pnpm test:electron-ui
pnpm test:electron-ui --main=release/mac-arm64/OpenBuddy.app/Contents/Resources/app.asar/dist-electron/main.js
```

The command matrix is generated at `release/contract-matrix.json` and distinguishes static calls, reachable routes and runtime evidence. The UI script starts a real Electron process with a temporary bootstrap and isolated userData, then imports the supplied main module and uses a local HTTP fixture. It does not use user credentials and is separate from installation, notarization and Gatekeeper verification. `--native-dialogs` requires an operator to interact with real native dialogs. Independently launch the real application executable with `OPENBUDDY_SMOKE_TEST=1` for automatic startup smoke and a screenshot in its temporary profile.

## MVP limits and distribution

Expert/marketplace, automations, connector CLI, plugins, cloud storage, teams/subagents, plan mode and rewind are deferred. Unsupported commands reject with an explicit `not_implemented` error. Electron packages are larger and use more memory than the former Rust shell.

The build configuration includes hardened runtime entitlements and packaged Pi resources. Current CI creates unsigned review artifacts and does not publish releases. macOS signing/notarization and Windows signing require separate credentials and real installation tests. No signing, notarization, cross-platform installation or paid-provider conversation success is claimed by this README.

See [CHANGELOG.md](CHANGELOG.md) for migration notes and [TODO.md](TODO.md) for remaining release checks. Historical release notes describe earlier versions.

## License

MIT; see [LICENSE](LICENSE).
