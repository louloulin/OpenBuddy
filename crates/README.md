# OpenBuddy Host Core (Rust)

Rust workspace providing the privileged local backend of OpenBuddy Electron.

Mirrors PI-Desktop's `crates/host-core` design with adaptations for OpenBuddy
(不同的 scope: secrets/permissions/session_search/workspace/audit，5 个独立子能力).

## Layout

| Crate | Owns | Lines (Phase 0) |
|---|---|---|
| `openbuddy-host-core` | aggregator: tokio main + NDJSON JSON-RPC dispatcher | ~800 |
| `openbuddy-error-codes` | error codes mirroring `@openbuddy/shared/error-codes` | ~150 |
| `openbuddy-audit-types` | audit entry serde model | ~120 |
| `openbuddy-db` | SQLite schema + migrations | ~200 |
| `openbuddy-ignore` | `.openbuddyignore` loader | ~100 |

## Build

```bash
cargo build --release -p openbuddy-host-core
```

## Test

```bash
cargo test --workspace
```

## Packaging

The compiled binary is consumed by Electron main process via `process.resourcesPath/bin/openbuddy-host-core{,.exe}`.
