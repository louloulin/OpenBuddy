//! JSON-RPC error envelope.

use openbuddy_error_codes::{ErrorCode, RpcError};
use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Serialize)]
pub struct JsonRpcError {
    pub code: i64,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<ErrorData>,
}

#[derive(Debug, Serialize)]
pub struct ErrorData {
    #[serde(rename = "errorCode")]
    pub error_code: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<Value>,
}

impl JsonRpcError {
    pub fn from_rpc(error: RpcError, details: Option<Value>) -> Self {
        Self {
            code: error.code().as_i64(),
            message: error.message(),
            data: Some(ErrorData {
                error_code: stable_code_name(error.code()),
                details,
            }),
        }
    }

    pub fn method_not_found(method: &str) -> Self {
        Self::from_rpc(RpcError::MethodNotFound(method.to_string()), None)
    }

    pub fn invalid_params(message: impl Into<String>) -> Self {
        Self::from_rpc(RpcError::InvalidParams(message.into()), None)
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self::from_rpc(RpcError::Internal(message.into()), None)
    }

    pub fn host_overloaded() -> Self {
        Self::from_rpc(RpcError::HostOverloaded, None)
    }

    pub fn parse(message: impl Into<String>) -> Self {
        Self::from_rpc(RpcError::Parse(message.into()), None)
    }
}

fn stable_code_name(code: ErrorCode) -> String {
    let n = code.as_i64();
    if n < 0 {
        // JSON-RPC standard codes.
        match code {
            ErrorCode::ParseError => "PARSE_ERROR".into(),
            ErrorCode::InvalidRequest => "INVALID_REQUEST".into(),
            ErrorCode::MethodNotFound => "METHOD_NOT_FOUND".into(),
            ErrorCode::InvalidParams => "INVALID_PARAMS".into(),
            ErrorCode::InternalError => "INTERNAL_ERROR".into(),
            _ => "INTERNAL_ERROR".into(),
        }
    } else {
        match code {
            ErrorCode::HostUnavailable => "HOST_UNAVAILABLE".into(),
            ErrorCode::HostOverloaded => "HOST_OVERLOADED".into(),
            ErrorCode::SecretNotFound => "SECRET_NOT_FOUND".into(),
            ErrorCode::SecretBackendUnavailable => "SECRET_BACKEND_UNAVAILABLE".into(),
            ErrorCode::PermissionDenied => "PERMISSION_DENIED".into(),
            ErrorCode::PermissionTimeout => "PERMISSION_TIMEOUT".into(),
            ErrorCode::PermissionInvalid => "PERMISSION_INVALID".into(),
            ErrorCode::PathOutsideWorkspace => "PATH_OUTSIDE_WORKSPACE".into(),
            ErrorCode::WorkspaceIgnoreError => "WORKSPACE_IGNORE_ERROR".into(),
            ErrorCode::AuditAppendFailed => "AUDIT_APPEND_FAILED".into(),
            ErrorCode::AuditExhausted => "AUDIT_EXHAUSTED".into(),
            ErrorCode::SessionSearchFailed => "SESSION_SEARCH_FAILED".into(),
            ErrorCode::DbMigrationRequired => "DB_MIGRATION_REQUIRED".into(),
            ErrorCode::HandshakeFailed => "HANDSHAKE_FAILED".into(),
            _ => "INTERNAL_ERROR".into(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn method_not_found_uses_method_not_found_code() {
        let err = JsonRpcError::method_not_found("app.does_not_exist");
        assert_eq!(err.code, -32601);
        assert_eq!(err.data.as_ref().unwrap().error_code, "METHOD_NOT_FOUND");
    }

    #[test]
    fn host_overloaded_serializes_stably() {
        let err = JsonRpcError::host_overloaded();
        assert_eq!(err.code, 1002);
        assert_eq!(err.data.as_ref().unwrap().error_code, "HOST_OVERLOADED");
    }
}
