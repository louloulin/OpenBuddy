//! OpenBuddy host-core library surface.
//!
//! Phase 0 only exposes the RPC dispatcher; capability modules are wired in
//! Phase 1. The library form keeps the binary thin and lets future napi-rs /
//! WASM targets re-use the same RPC plumbing.

pub mod rpc;
pub mod state;

pub mod secrets;
pub mod permissions;
pub mod session_search;
pub mod workspace;
pub mod audit;

/// Bumped whenever the wire protocol (JSON-RPC method names, params, results)
/// changes in a backward-incompatible way. The TS side refuses to speak to a
/// host-core with a different version.
///
/// Phase 0: `1`. Phase 1 will keep it on `1` (additive). Breaking changes
/// bump to `2`.
pub const PROTOCOL_VERSION: u32 = 1;

/// Match PI-Desktop: this is the host-core's own release tag, surfaced by
/// `app.handshake` for support diagnostics.
pub const HOST_VERSION: &str = env!("CARGO_PKG_VERSION");

/// Default RPC timeout in milliseconds (matches PI-Desktop
/// `DEFAULT_RPC_TIMEOUT_MS`). Renderer-facing calls use this; the supervisor
/// may override per-call.
pub const DEFAULT_RPC_TIMEOUT_MS: u64 = 130_000;

/// Max NDJSON line length (matches PI-Desktop `MAX_HOST_STDIN_LINE_BYTES`).
/// Oversize frames are rejected before the JSON parser runs.
pub const MAX_STDIN_LINE_BYTES: usize = 1_048_576;
