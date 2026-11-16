use thiserror::Error;

/// The error every service handler returns.
///
/// It reaches the UI as a string `"<code>: <message>"`; `src/core/backend.ts` parses the code
/// into `BackendError.code`. Keep messages short and free of secrets (they are logged).
#[derive(Debug, Error)]
pub enum SvcError {
    #[error("bad_args: {0}")]
    BadArgs(String),
    #[error("unknown_method: {0}")]
    UnknownMethod(String),
    #[error("not_found: {0}")]
    NotFound(String),
    #[error("denied: {0}")]
    Denied(String),
    #[error("missing_secret: {0}")]
    MissingSecret(String),
    #[error("offline: {0}")]
    Offline(String),
    #[error("timeout: {0}")]
    Timeout(String),
    #[error("http: {0}")]
    Http(String),
    #[error("io: {0}")]
    Io(String),
    #[error("unsupported: {0}")]
    Unsupported(String),
    #[error("internal: {0}")]
    Internal(String),
}

pub type SvcResult<T> = Result<T, SvcError>;

impl SvcError {
    pub fn bad_args(msg: impl Into<String>) -> Self {
        SvcError::BadArgs(msg.into())
    }
    pub fn internal(err: impl std::fmt::Display) -> Self {
        SvcError::Internal(err.to_string())
    }
    pub fn unsupported(msg: impl Into<String>) -> Self {
        SvcError::Unsupported(msg.into())
    }
}

impl From<std::io::Error> for SvcError {
    fn from(e: std::io::Error) -> Self {
        match e.kind() {
            std::io::ErrorKind::NotFound => SvcError::NotFound(e.to_string()),
            std::io::ErrorKind::PermissionDenied => SvcError::Denied(e.to_string()),
            _ => SvcError::Io(e.to_string()),
        }
    }
}

impl From<serde_json::Error> for SvcError {
    fn from(e: serde_json::Error) -> Self {
        SvcError::Internal(format!("json: {e}"))
    }
}

impl From<tauri::Error> for SvcError {
    fn from(e: tauri::Error) -> Self {
        SvcError::Internal(format!("tauri: {e}"))
    }
}

#[cfg(windows)]
impl From<windows::core::Error> for SvcError {
    fn from(e: windows::core::Error) -> Self {
        SvcError::Internal(format!("windows: {e}"))
    }
}
