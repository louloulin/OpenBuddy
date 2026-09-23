//! Method dispatch — Phase 0 wires only `app.handshake`; Phase 1 adds the
//! capability-specific method namespaces.
//!
//! Handlers are async functions that take the `AppState` plus the JSON
//! params and return either a result value or an `RpcError`. The dispatcher
//! is responsible for translating the latter into a JSON-RPC error envelope.

use std::collections::HashMap;
use std::sync::Arc;
use std::sync::OnceLock;

use anyhow::Result;
use openbuddy_error_codes::RpcError;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::state::AppState;

use super::admission::Admission;
use super::error::JsonRpcError;
use super::transport::{submit_notification, submit_response, DispatchEvent};
use super::JsonRpcResponse;

/// One async handler. Returns `Ok(value)` for success or `Err(RpcError)`
/// (translated to a JSON-RPC error envelope).
pub type Handler =
    Arc<dyn Fn(AppStateClone, Value) -> BoxFuture<Result<Value, RpcError>> + Send + Sync>;

pub type AppStateClone = Arc<AppState>;
pub type BoxFuture<T> = std::pin::Pin<Box<dyn std::future::Future<Output = T> + Send>>;

/// Static handler registry. Phase 0 registers `app.handshake`; Phase 1
/// extends it via `register` from capability initialisation.
static HANDLERS: OnceLock<parking_lot::RwLock<HashMap<&'static str, Handler>>> = OnceLock::new();
fn handlers() -> &'static parking_lot::RwLock<HashMap<&'static str, Handler>> {
    HANDLERS.get_or_init(|| parking_lot::RwLock::new(HashMap::new()))
}

/// Register a method handler. Returns the previous handler (if any) so
/// initialisation code can detect duplicate registrations.
pub fn register(method: &'static str, handler: Handler) -> Option<Handler> {
    handlers().write().insert(method, handler)
}

/// Snapshot of registered method names — used by tests and by `app.listMethods`.
pub fn registered_methods() -> Vec<&'static str> {
    handlers().read().keys().copied().collect()
}

#[derive(Debug, Deserialize)]
struct HandshakeParams {
    #[serde(rename = "protocolVersion")]
    protocol_version: u32,
    #[serde(rename = "hostVersion", default)]
    host_version: Option<String>,
    #[serde(rename = "dataDir", default)]
    data_dir: Option<String>,
}

#[derive(Debug, Serialize)]
struct HandshakeResult {
    #[serde(rename = "protocolVersion")]
    protocol_version: u32,
    #[serde(rename = "hostVersion")]
    host_version: &'static str,
    #[serde(rename = "supports")]
    supports: Vec<&'static str>,
    #[serde(rename = "dataDir")]
    data_dir: String,
    #[serde(rename = "capabilities")]
    capabilities: Vec<&'static str>,
}

/// Install the `app.*` method family. Idempotent.
pub fn install_app_handlers() {
    register(
        "app.handshake",
        Arc::new(|state, params| {
            Box::pin(async move {
                let parsed: HandshakeParams = serde_json::from_value(params)
                    .map_err(|err| RpcError::InvalidParams(err.to_string()))?;
                if parsed.protocol_version != crate::PROTOCOL_VERSION {
                    return Err(RpcError::HandshakeFailed(format!(
                        "protocol_version mismatch: host={} client={}",
                        crate::PROTOCOL_VERSION,
                        parsed.protocol_version
                    )));
                }
                let supports = vec!["stdio-jsonrpc", "ndjson", "method-namespaces"];
                let capabilities: Vec<&'static str> = if std::env::var("OPENBUDDY_PHASE0_ONLY").is_ok()
                {
                    vec!["app.handshake", "app.listMethods"]
                } else {
                    vec![
                        "app.handshake",
                        "app.listMethods",
                        "secrets.set",
                        "secrets.get",
                        "secrets.delete",
                        "secrets.list",
                        "permissions.evaluate",
                        "permissions.list",
                        "session.search",
                        "workspace.resolve",
                        "workspace.check",
                        "audit.append",
                        "audit.tail",
                    ]
                };
                let result = HandshakeResult {
                    protocol_version: crate::PROTOCOL_VERSION,
                    host_version: crate::HOST_VERSION,
                    supports,
                    data_dir: state.data_dir_path().display().to_string(),
                    capabilities,
                };
                Ok(serde_json::to_value(result).unwrap())
            })
        }),
    );

    register(
        "app.listMethods",
        Arc::new(|_state, _params| {
            Box::pin(async move {
                let methods = registered_methods();
                Ok(serde_json::json!({ "methods": methods }))
            })
        }),
    );

    register(
        "app.shutdown",
        Arc::new(|_state, _params| {
            Box::pin(async move {
                let _ = submit_notification("app.shutdownAck".to_string(), serde_json::json!({}));
                tokio::time::sleep(std::time::Duration::from_millis(20)).await;
                std::process::exit(0);
            })
        }),
    );
}

/// Install the Phase 1 capability handlers. Idempotent. Wired from
/// `state::AppState::open` so all capability entry points are live by the
/// time the dispatcher starts processing the first request.
pub fn install_capability_handlers() {
    use crate::secrets::{DeleteParams, GetParams, SetParams};

    register(
        "secrets.set",
        Arc::new(|state, params| {
            Box::pin(async move {
                let parsed: SetParams = serde_json::from_value(params)
                    .map_err(|err| RpcError::InvalidParams(err.to_string()))?;
                let result = state
                    .secrets
                    .set(parsed)
                    .map_err(|err| map_capability_error("secrets.set", err))?;
                serde_json::to_value(result).map_err(|e| RpcError::Internal(e.to_string()))
            })
        }),
    );

    register(
        "secrets.get",
        Arc::new(|state, params| {
            Box::pin(async move {
                let parsed: GetParams = serde_json::from_value(params)
                    .map_err(|err| RpcError::InvalidParams(err.to_string()))?;
                let result = state
                    .secrets
                    .get(parsed)
                    .map_err(|err| map_capability_error("secrets.get", err))?;
                serde_json::to_value(result).map_err(|e| RpcError::Internal(e.to_string()))
            })
        }),
    );

    register(
        "secrets.delete",
        Arc::new(|state, params| {
            Box::pin(async move {
                let parsed: DeleteParams = serde_json::from_value(params)
                    .map_err(|err| RpcError::InvalidParams(err.to_string()))?;
                state
                    .secrets
                    .delete(parsed)
                    .map_err(|err| map_capability_error("secrets.delete", err))?;
                Ok(serde_json::json!({ "ok": true }))
            })
        }),
    );

    register(
        "secrets.list",
        Arc::new(|state, _params| {
            Box::pin(async move {
                let result = state
                    .secrets
                    .list()
                    .map_err(|err| map_capability_error("secrets.list", err))?;
                serde_json::to_value(result).map_err(|e| RpcError::Internal(e.to_string()))
            })
        }),
    );

    use crate::audit::{AppendParams, TailParams};

    register(
        "audit.append",
        Arc::new(|state, params| {
            Box::pin(async move {
                let parsed: AppendParams = serde_json::from_value(params)
                    .map_err(|err| RpcError::InvalidParams(err.to_string()))?;
                let result = state
                    .audit
                    .append(parsed)
                    .map_err(|err| map_capability_error("audit.append", err))?;
                serde_json::to_value(result).map_err(|e| RpcError::Internal(e.to_string()))
            })
        }),
    );

    register(
        "audit.tail",
        Arc::new(|state, params| {
            Box::pin(async move {
                let parsed: TailParams = serde_json::from_value(params)
                    .map_err(|err| RpcError::InvalidParams(err.to_string()))?;
                let result = state
                    .audit
                    .tail(parsed)
                    .map_err(|err| map_capability_error("audit.tail", err))?;
                serde_json::to_value(result).map_err(|e| RpcError::Internal(e.to_string()))
            })
        }),
    );
}

/// Translate an `anyhow::Error` from a capability handler into the right
/// JSON-RPC error code. The capability modules raise typed errors via
/// `openbuddy_error_codes::RpcError` for invalid params / not found; anything
/// else is treated as `INTERNAL_ERROR` so the renderer can render a sane
/// message without exposing internal paths.
fn map_capability_error(method: &'static str, err: anyhow::Error) -> RpcError {
    use openbuddy_error_codes::RpcError as E;
    if let Some(rpc) = err.downcast_ref::<E>() {
        return match rpc {
            E::SecretNotFound(_) => E::SecretNotFound(err.to_string()),
            E::SecretBackendUnavailable(_) => E::SecretBackendUnavailable(err.to_string()),
            E::InvalidParams(_) => E::InvalidParams(err.to_string()),
            other => {
                // Log and bubble up as INTERNAL_ERROR so capability
                // errors that escape their namespace never poison the
                // renderer with internals.
                tracing::error!(target: "openbuddy.host.rpc", method, error = %err, "capability handler error");
                E::Internal(format!("{other}: {err}"))
            }
        };
    }
    tracing::error!(target: "openbuddy.host.rpc", method, error = %err, "capability handler error");
    RpcError::Internal(err.to_string())
}

/// Tokio task that consumes `DispatchEvent`s and writes responses / notifications
/// onto the stdout writer thread.
pub fn run_sync(
    state: Arc<AppState>,
    admission: Arc<Admission>,
    rx: std::sync::mpsc::Receiver<DispatchEvent>,
) {
    install_app_handlers();
    install_capability_handlers();
    let rt = match tokio::runtime::Builder::new_current_thread().enable_all().build() {
        Ok(rt) => rt,
        Err(err) => {
            eprintln!("[openbuddy-dispatcher] failed to build runtime: {err}");
            return;
        }
    };
    while let Ok(event) = rx.recv() {
        rt.block_on(dispatch_one_event(state.clone(), admission.clone(), event));
    }
}

async fn dispatch_one_event(
    state: Arc<AppState>,
    admission: Arc<Admission>,
    event: DispatchEvent,
) {
    match event {
        DispatchEvent::Request(req) => {
            let method = req.method.clone();
            let id = req.id.clone();
            let params = req.params.clone();
            let _guard = match admission.acquire().await {
                Some(g) => g,
                None => {
                    let err = JsonRpcError::host_overloaded();
                    let _ = submit_response(JsonRpcResponse {
                        jsonrpc: "2.0",
                        id,
                        result: None,
                        error: Some(err),
                    });
                    return;
                }
            };
            dispatch_one(state, &method, id, params).await;
        }
        DispatchEvent::Oversize { id } => {
            let err = JsonRpcError::invalid_params(format!(
                "frame exceeded {} bytes",
                crate::MAX_STDIN_LINE_BYTES
            ));
            let _ = submit_response(JsonRpcResponse {
                jsonrpc: "2.0",
                id,
                result: None,
                error: Some(err),
            });
        }
        DispatchEvent::StdinError(message) => {
            tracing::warn!(target: "openbuddy.host.rpc", %message, "stdin parse error");
            let err = JsonRpcError::parse(message);
            let _ = submit_response(JsonRpcResponse {
                jsonrpc: "2.0",
                id: Value::Null,
                result: None,
                error: Some(err),
            });
        }
        DispatchEvent::Eof => {
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            tracing::info!(target: "openbuddy.host.rpc", "stdin closed; shutting down");
            std::process::exit(0);
        }
    }
}


async fn dispatch_one(state: Arc<AppState>, method: &str, id: Value, params: Value) {
    let handler = handlers().read().get(method).cloned();
    let response = match handler {
        Some(handler) => match handler(state.clone(), params).await {
            Ok(result) => JsonRpcResponse {
                jsonrpc: "2.0",
                id,
                result: Some(result),
                error: None,
            },
            Err(rpc_err) => JsonRpcResponse {
                jsonrpc: "2.0",
                id,
                result: None,
                error: Some(JsonRpcError::from_rpc(rpc_err, None)),
            },
        },
        None => JsonRpcResponse {
            jsonrpc: "2.0",
            id,
            result: None,
            error: Some(JsonRpcError::method_not_found(method)),
        },
    };
    let _ = submit_response(response);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::{AppState, DataDir};

    fn fixture_state() -> Arc<AppState> {
        let tmp = std::env::temp_dir().join(format!(
            "openbuddy-dispatch-test-{}-{}",
            std::process::id(),
            nanos()
        ));
        std::env::set_var("PI_OPENBUDDY_DATA_DIR", &tmp);
        let data_dir = DataDir::resolve().unwrap();
        AppState::open(data_dir).unwrap()
    }

    fn run_async<F: std::future::Future>(future: F) -> F::Output {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        rt.block_on(future)
    }

    #[test]
    fn handshake_with_matching_protocol_succeeds() {
        install_app_handlers();
        let state = fixture_state();
        let params = serde_json::json!({
            "protocolVersion": crate::PROTOCOL_VERSION,
            "hostVersion": "test",
        });
        let handler = handlers().read().get("app.handshake").cloned().unwrap();
        let result = run_async(handler(state, params)).unwrap();
        assert_eq!(result["protocolVersion"], crate::PROTOCOL_VERSION);
        assert!(result["supports"].is_array());
    }

    #[test]
    fn handshake_with_mismatched_protocol_returns_handshake_failed() {
        install_app_handlers();
        let state = fixture_state();
        let params = serde_json::json!({ "protocolVersion": 999 });
        let handler = handlers().read().get("app.handshake").cloned().unwrap();
        let result = run_async(handler(state, params));
        assert!(matches!(result, Err(RpcError::HandshakeFailed(_))));
    }

    #[test]
    fn list_methods_returns_handshake_and_list_methods_and_shutdown() {
        install_app_handlers();
        let methods = registered_methods();
        assert!(methods.contains(&"app.handshake"));
        assert!(methods.contains(&"app.listMethods"));
        assert!(methods.contains(&"app.shutdown"));
    }

    fn nanos() -> u128 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    }
}
