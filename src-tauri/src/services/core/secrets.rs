//! Secrets in Windows Credential Manager (target "<key>.dev.glintbar.dock").
//! Values are never logged. Prefer not reading secrets into the UI at all: the http service
//! replaces `{{secret:<key>}}` in url, headers and body on the Rust side.

use serde::Deserialize;
use tauri::AppHandle;

use crate::error::{SvcError, SvcResult};
use crate::registry::Registrar;

const SERVICE: &str = "dev.glintbar.dock";

fn check_key(key: &str) -> SvcResult<()> {
    let ok = !key.is_empty()
        && key.len() <= 128
        && key.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-');
    if ok {
        Ok(())
    } else {
        Err(SvcError::bad_args("a secret key may contain only a-z, 0-9, '.', '_' and '-', up to 128 characters"))
    }
}

fn entry(key: &str) -> SvcResult<keyring::Entry> {
    check_key(key)?;
    keyring::Entry::new(SERVICE, key).map_err(|e| SvcError::Internal(format!("credential store: {e}")))
}

/// Reads a secret. Blocking (Credential Manager call); use from `run_blocking` or `add_blocking`.
pub fn read(key: &str) -> SvcResult<Option<String>> {
    match entry(key)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(SvcError::Internal(format!("credential store: {e}"))),
    }
}

pub fn write(key: &str, value: &str) -> SvcResult<()> {
    if value.len() > 2048 {
        return Err(SvcError::bad_args("the secret exceeds 2048 bytes"));
    }
    entry(key)?.set_password(value).map_err(|e| SvcError::Internal(format!("credential store: {e}")))
}

pub fn delete(key: &str) -> SvcResult<()> {
    match entry(key)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(SvcError::Internal(format!("credential store: {e}"))),
    }
}

#[derive(Deserialize)]
struct KeyArgs {
    key: String,
}

#[derive(Deserialize)]
struct SetArgs {
    key: String,
    value: String,
}

pub fn register(reg: &mut Registrar) {
    reg.add_blocking("secrets", "get", |_app: AppHandle, a: KeyArgs| read(&a.key));
    reg.add_blocking("secrets", "has", |_app: AppHandle, a: KeyArgs| Ok(read(&a.key)?.is_some()));
    reg.add_blocking("secrets", "set", |_app: AppHandle, a: SetArgs| {
        if !a.key.starts_with("smoke.") {
            crate::services::core::smoke::guard("secrets.set")?;
        }
        if a.value.is_empty() {
            delete(&a.key)
        } else {
            write(&a.key, &a.value)
        }
    });
    reg.add_blocking("secrets", "delete", |_app: AppHandle, a: KeyArgs| {
        if !a.key.starts_with("smoke.") {
            crate::services::core::smoke::guard("secrets.delete")?;
        }
        delete(&a.key)
    });
}
