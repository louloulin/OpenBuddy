//! NDJSON JSON-RPC dispatcher (stdio transport).
//!
//! Mirrors PI-Desktop `crates/host-core/src/rpc/mod.rs`:
//! - Dedicated OS threads for stdin (read) and stdout (write); Tokio adapters
//!   are not used for the control pipe (PI-Desktop §5a).
//! - Admission caps at 32 active requests; per-tool kind buckets limit
//!   parallel execution (PI-Desktop §2.1).
//! - One JSON object per LF-delimited line; U+2028 / U+2029 in string
//!   bodies are payload, never frame delimiters.
//! - Frame size capped at `crate::MAX_STDIN_LINE_BYTES` (1 MiB).
//! - Method names live in `dispatch::METHODS`. Capability modules register
//!   handlers via `register` at startup; Phase 0 only registers `app.*`.

pub mod admission;
pub mod dispatch;
pub mod error;
pub mod transport;

use std::sync::Arc;

use anyhow::Result;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::state::AppState;

/// JSON-RPC 2.0 request envelope as accepted on stdin.
#[derive(Debug, Deserialize)]
pub struct JsonRpcRequest {
    pub jsonrpc: String,
    #[serde(default)]
    pub id: Value,
    pub method: String,
    #[serde(default)]
    pub params: Value,
}

/// JSON-RPC 2.0 successful response written to stdout.
#[derive(Debug, Serialize)]
pub struct JsonRpcResponse {
    pub jsonrpc: &'static str,
    pub id: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<error::JsonRpcError>,
}

/// JSON-RPC 2.0 notification (no `id`).
#[derive(Debug, Serialize)]
pub struct JsonRpcNotification {
    pub jsonrpc: &'static str,
    pub method: String,
    pub params: Value,
}

/// Spawn the RPC server: stdin reader thread + stdout writer thread + tokio
/// dispatcher. Blocks until stdin closes or the dispatcher returns an error.
pub async fn serve(state: Arc<AppState>) -> Result<()> {
    let admission = Arc::new(admission::Admission::new());

    // Spawn the dispatcher.
    let (tx, rx) = tokio::sync::mpsc::channel::<transport::DispatchEvent>(1024);
    let dispatcher = tokio::spawn(dispatch::run(state.clone(), admission.clone(), rx));

    // Wire transport.
    transport::run(tx).await?;

    // Once transport closes, the dispatcher will see channel close and return.
    let _ = dispatcher.await;
    Ok(())
}

/// Helper used by `dispatch` to build a structured success response.
pub fn ok(id: Value, result: Value) -> JsonRpcResponse {
    JsonRpcResponse {
        jsonrpc: "2.0",
        id,
        result: Some(result),
        error: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ok_response_carries_id_and_result() {
        let resp = ok(serde_json::json!(1), serde_json::json!({"ok": true}));
        let json = serde_json::to_string(&resp).unwrap();
        assert!(json.contains("\"result\":{\"ok\":true}"));
        assert!(!json.contains("\"error\""));
    }
}
