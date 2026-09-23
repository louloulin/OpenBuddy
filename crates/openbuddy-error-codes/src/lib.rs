//! OpenBuddy error codes — mirror of `@openbuddy/shared/error-codes`.
//!
//! JSON-RPC error codes follow PI-Desktop §06-host-rpc-protocol.md / 08-error-codes.md.
//! Each constant has the same integer as the TS source so the TS ↔ Rust
//! contract stays a single source of truth.

use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Numeric error codes used in JSON-RPC `error.code`.
///
/// TS-equivalent: `packages/shared/openbuddy-error-codes/src/index.ts`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[repr(i64)]
pub enum ErrorCode {
    ParseError = -32700,
    InvalidRequest = -32600,
    MethodNotFound = -32601,
    InvalidParams = -32602,
    InternalError = -32603,

    // OpenBuddy-specific (1000+).
    HostUnavailable = 1001,
    HostOverloaded = 1002,
    SecretNotFound = 1003,
    SecretBackendUnavailable = 1004,
    PermissionDenied = 1005,
    PermissionTimeout = 1006,
    PermissionInvalid = 1007,
    PathOutsideWorkspace = 1008,
    WorkspaceIgnoreError = 1009,
    AuditAppendFailed = 1010,
    AuditExhausted = 1011,
    SessionSearchFailed = 1012,
    DbMigrationRequired = 1013,
    HandshakeFailed = 1014,
}

impl ErrorCode {
    pub fn as_i64(self) -> i64 {
        self as i64
    }

    pub fn from_i64(v: i64) -> Option<Self> {
        Some(match v {
            -32700 => Self::ParseError,
            -32600 => Self::InvalidRequest,
            -32601 => Self::MethodNotFound,
            -32602 => Self::InvalidParams,
            -32603 => Self::InternalError,
            1001 => Self::HostUnavailable,
            1002 => Self::HostOverloaded,
            1003 => Self::SecretNotFound,
            1004 => Self::SecretBackendUnavailable,
            1005 => Self::PermissionDenied,
            1006 => Self::PermissionTimeout,
            1007 => Self::PermissionInvalid,
            1008 => Self::PathOutsideWorkspace,
            1009 => Self::WorkspaceIgnoreError,
            1010 => Self::AuditAppendFailed,
            1011 => Self::AuditExhausted,
            1012 => Self::SessionSearchFailed,
            1013 => Self::DbMigrationRequired,
            1014 => Self::HandshakeFailed,
            _ => return None,
        })
    }
}

/// Structured error payload returned in JSON-RPC `error.data.errorCode`.
#[derive(Debug, Error)]
pub enum RpcError {
    #[error("parse error: {0}")]
    Parse(String),
    #[error("invalid request: {0}")]
    InvalidRequest(String),
    #[error("method not found: {0}")]
    MethodNotFound(String),
    #[error("invalid params: {0}")]
    InvalidParams(String),
    #[error("internal error: {0}")]
    Internal(String),

    #[error("host unavailable: {0}")]
    HostUnavailable(String),
    #[error("host overloaded")]
    HostOverloaded,
    #[error("secret not found: {0}")]
    SecretNotFound(String),
    #[error("secret backend unavailable: {0}")]
    SecretBackendUnavailable(String),
    #[error("permission denied: {0}")]
    PermissionDenied(String),
    #[error("permission timeout: {0}")]
    PermissionTimeout(String),
    #[error("permission invalid: {0}")]
    PermissionInvalid(String),
    #[error("path outside workspace: {0}")]
    PathOutsideWorkspace(String),
    #[error("workspace ignore error: {0}")]
    WorkspaceIgnoreError(String),
    #[error("audit append failed: {0}")]
    AuditAppendFailed(String),
    #[error("audit exhausted")]
    AuditExhausted,
    #[error("session search failed: {0}")]
    SessionSearchFailed(String),
    #[error("db migration required: {0}")]
    DbMigrationRequired(String),
    #[error("handshake failed: {0}")]
    HandshakeFailed(String),
}

impl RpcError {
    pub fn code(&self) -> ErrorCode {
        match self {
            Self::Parse(_) => ErrorCode::ParseError,
            Self::InvalidRequest(_) => ErrorCode::InvalidRequest,
            Self::MethodNotFound(_) => ErrorCode::MethodNotFound,
            Self::InvalidParams(_) => ErrorCode::InvalidParams,
            Self::Internal(_) => ErrorCode::InternalError,
            Self::HostUnavailable(_) => ErrorCode::HostUnavailable,
            Self::HostOverloaded => ErrorCode::HostOverloaded,
            Self::SecretNotFound(_) => ErrorCode::SecretNotFound,
            Self::SecretBackendUnavailable(_) => ErrorCode::SecretBackendUnavailable,
            Self::PermissionDenied(_) => ErrorCode::PermissionDenied,
            Self::PermissionTimeout(_) => ErrorCode::PermissionTimeout,
            Self::PermissionInvalid(_) => ErrorCode::PermissionInvalid,
            Self::PathOutsideWorkspace(_) => ErrorCode::PathOutsideWorkspace,
            Self::WorkspaceIgnoreError(_) => ErrorCode::WorkspaceIgnoreError,
            Self::AuditAppendFailed(_) => ErrorCode::AuditAppendFailed,
            Self::AuditExhausted => ErrorCode::AuditExhausted,
            Self::SessionSearchFailed(_) => ErrorCode::SessionSearchFailed,
            Self::DbMigrationRequired(_) => ErrorCode::DbMigrationRequired,
            Self::HandshakeFailed(_) => ErrorCode::HandshakeFailed,
        }
    }

    pub fn message(&self) -> String {
        match self {
            Self::HostOverloaded => "HOST_OVERLOADED".to_string(),
            Self::AuditExhausted => "AUDIT_EXHAUSTED".to_string(),
            other => format!("{}", other),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn error_code_round_trip() {
        for code in [
            ErrorCode::ParseError,
            ErrorCode::HostUnavailable,
            ErrorCode::HostOverloaded,
            ErrorCode::SecretNotFound,
            ErrorCode::PermissionDenied,
            ErrorCode::PathOutsideWorkspace,
            ErrorCode::AuditAppendFailed,
            ErrorCode::HandshakeFailed,
        ] {
            let n = code.as_i64();
            assert_eq!(ErrorCode::from_i64(n), Some(code));
        }
    }

    #[test]
    fn rpc_error_code_matches_variant() {
        let err = RpcError::SecretNotFound("foo".into());
        assert_eq!(err.code(), ErrorCode::SecretNotFound);
        assert!(err.message().contains("foo"));
    }

    #[test]
    fn unknown_code_returns_none() {
        assert_eq!(ErrorCode::from_i64(9999), None);
    }
}
