# OpenBuddy Host Core (Rust)

Rust workspace providing the privileged local backend of OpenBuddy Electron.

Mirrors PI-Desktop's `crates/host-core` design with adaptations for OpenBuddy
(different scope: secrets/permissions/session_search/workspace/audit —
**5 independent sub-capabilities**).

## Layout

| Crate                  | Owns                                                |
|------------------------|------------------------------------------------------|
| `openbuddy-host-core`  | aggregator: tokio main + NDJSON JSON-RPC dispatcher |
| `openbuddy-error-codes`| error codes mirroring `@openbuddy/shared/error-codes`|
| `openbuddy-audit-types` | audit entry serde model (cross-crate shared)         |
| `openbuddy-db`         | SQLite schema + migrations                           |
| `openbuddy-ignore`     | `.openbuddyignore` loader                            |

## Quick build

```bash
cargo build --release -p openbuddy-host-core
cargo test --workspace
```

## Cross-compile matrix (8 targets)

Mirrors the v1 plan §6 binary dispatch matrix. Same artifacts
`electron-builder` consumes via `extraResources: bin/`.

| OS       | Architecture | Triple                          | Cross image                                                | Artifact name                          |
|----------|--------------|----------------------------------|------------------------------------------------------------|----------------------------------------|
| macOS    | arm64        | `aarch64-apple-darwin`           | *(native, run on `macos-latest`)*                          | `openbuddy-host-core-darwin-arm64`      |
| macOS    | x64          | `x86_64-apple-darwin`            | *(native, run on `macos-latest`)*                          | `openbuddy-host-core-darwin-x64`        |
| Linux    | x64-gnu      | `x86_64-unknown-linux-gnu`       | `ghcr.io/cross-rs/x86_64-unknown-linux-gnu:main`           | `openbuddy-host-core-linux-x64`         |
| Linux    | arm64-gnu    | `aarch64-unknown-linux-gnu`      | `ghcr.io/cross-rs/aarch64-unknown-linux-gnu:main`          | `openbuddy-host-core-linux-arm64`       |
| Linux    | x64-musl     | `x86_64-unknown-linux-musl`      | `ghcr.io/cross-rs/x86_64-unknown-linux-musl:main`          | `openbuddy-host-core-linux-x64-musl`    |
| Linux    | arm64-musl   | `aarch64-unknown-linux-musl`     | `ghcr.io/cross-rs/aarch64-unknown-linux-musl:main`         | `openbuddy-host-core-linux-arm64-musl`  |
| Windows  | x64          | `x86_64-pc-windows-msvc`         | `ghcr.io/cross-rs/x86_64-pc-windows-msvc:main`             | `openbuddy-host-core-windows-x64`       |
| Windows  | arm64        | `aarch64-pc-windows-msvc`        | `ghcr.io/cross-rs/aarch64-pc-windows-msvc:main`            | `openbuddy-host-core-windows-arm64`     |

### One-off build (local dev)

```bash
# Pick the triple you need (macOS builds need a macOS host):
cargo build --release --target aarch64-apple-darwin   -p openbuddy-host-core
cargo build --release --target x86_64-apple-darwin    -p openbuddy-host-core
cargo build --release --target x86_64-unknown-linux-gnu -p openbuddy-host-core

# For non-host triples, install cross once:
cargo install cross --locked

# Then cross-build (cross handles sysroot + linker):
cross build --release --target aarch64-unknown-linux-gnu  -p openbuddy-host-core
cross build --release --target x86_64-unknown-linux-musl   -p openbuddy-host-core
cross build --release --target aarch64-unknown-linux-musl  -p openbuddy-host-core
cross build --release --target x86_64-pc-windows-msvc      -p openbuddy-host-core
cross build --release --target aarch64-pc-windows-msvc     -p openbuddy-host-core
```

### CI

`.github/workflows/rust-host-core.yml` runs the full 8-target release matrix
plus `cargo test` on 3 native platforms plus `cargo clippy -D warnings`.
Artifacts upload as `openbuddy-host-core-{os}-{arch}{,-musl}` and the
release workflow downloads them when packaging the Electron build.

## Where the binary ends up

The TypeScript side reads the binary path via
`packages/runtime/openbuddy-host-runtime/src/host-binary.ts::resolveHostBinary()`
(PI-Desktop `resolveHostBinary` clone). The resolver tries, in order:

1. `PI_OPENBUDDY_HOST_BIN` env override
2. `process.resourcesPath/bin/openbuddy-host-core{,.exe}` (packaged)
3. `target/debug/openbuddy-host-core{,.exe}` (monorepo dev)
4. `target/release/openbuddy-host-core{,.exe}` (monorepo build)

If none exist, it throws and the user sees a clear message
("run `cargo build -p openbuddy-host-core` first"). This mirrors the
PI-Desktop ADR 0011 binary dispatch.

## Adding a new triple

1. Add an `include:` entry under `rust-cross-release.matrix` in
   `.github/workflows/rust-host-core.yml`.
2. Add the row to the table above.
3. Run the new build locally:
   `cross build --release --target <new-triple> -p openbuddy-host-core`
4. Verify the binary still passes `file` + ldd smoke checks.
