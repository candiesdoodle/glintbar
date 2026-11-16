//! One-time carry-over of data from this app's earlier name ("Glint"), which only its owner ever
//! installed. This is the only place the old name may appear in code.
//!
//! - `copy_old_data` runs first thing on start, before anything creates or reads the data folder:
//!   if %APPDATA%\\GlintBar does not exist and %APPDATA%\\Glint does, the old folder's contents
//!   (store.json, screentime, caches, ...) are copied across, except logs and the smoke folder.
//!   The copy goes to a temporary folder that is renamed into place only when complete. The old
//!   folder is never deleted or changed.
//! - `copy_old_credentials` then copies every Credential Manager entry saved under the old
//!   service name ("<key>.dev.glint.dock") to the new one, unless the new entry already exists.

use std::path::{Path, PathBuf};

const OLD_DIR: &str = "Glint";
const NEW_DIR: &str = "GlintBar";
#[cfg(windows)]
const OLD_SERVICE: &str = "dev.glint.dock";

/// What happened, for one log line once logging is up. None: nothing to migrate.
pub enum DataMigration {
    Copied { files: u32 },
    Failed(String),
}

/// Copies %APPDATA%\\Glint into a new %APPDATA%\\GlintBar. Must run before `paths::data_dir` is
/// first called (it creates the new folder). Never panics.
pub fn copy_old_data() -> Option<DataMigration> {
    let base = PathBuf::from(std::env::var_os("APPDATA")?);
    let old = base.join(OLD_DIR);
    let new = base.join(NEW_DIR);
    if new.exists() || !old.is_dir() {
        return None;
    }
    let staging = base.join(format!("{NEW_DIR}.migrating"));
    let _ = std::fs::remove_dir_all(&staging);
    let mut files: u32 = 0;
    let result = copy_dir(&old, &staging, true, &mut files).and_then(|_| std::fs::rename(&staging, &new));
    match result {
        Ok(()) => Some(DataMigration::Copied { files }),
        Err(e) => {
            let _ = std::fs::remove_dir_all(&staging);
            Some(DataMigration::Failed(e.to_string()))
        }
    }
}

fn copy_dir(from: &Path, to: &Path, top: bool, files: &mut u32) -> std::io::Result<()> {
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let name = entry.file_name();
        if top {
            let lower = name.to_string_lossy().to_lowercase();
            if lower == "logs" || lower == "smoke" {
                continue;
            }
        }
        let src = entry.path();
        let dst = to.join(&name);
        let kind = entry.file_type()?;
        if kind.is_dir() {
            copy_dir(&src, &dst, false, files)?;
        } else if kind.is_file() {
            std::fs::copy(&src, &dst)?;
            *files += 1;
        }
    }
    Ok(())
}

/// Logs the outcome of `copy_old_data` (call after `logging::init`).
pub fn log_data_migration(outcome: &DataMigration) {
    match outcome {
        DataMigration::Copied { files } => {
            tracing::info!(files = *files, "copied settings and data from the app's earlier name's folder")
        }
        DataMigration::Failed(e) => tracing::warn!("could not copy data from the app's earlier name's folder: {e}"),
    }
}

/// Copies saved keys from the old Credential Manager service name to the new one, skipping keys
/// the new name already has. Blocking but quick; runs once, right after `copy_old_data` copied.
#[cfg(windows)]
pub fn copy_old_credentials() {
    use crate::services::core::secrets;

    let keys = old_credential_keys();
    let mut copied: u32 = 0;
    let mut failed: u32 = 0;
    for key in &keys {
        let old = match keyring::Entry::new(OLD_SERVICE, key) {
            Ok(entry) => entry,
            Err(_) => {
                failed += 1;
                continue;
            }
        };
        let value = match old.get_password() {
            Ok(value) => value,
            Err(_) => {
                failed += 1;
                continue;
            }
        };
        match secrets::read(key) {
            Ok(None) => match secrets::write(key, &value) {
                Ok(()) => copied += 1,
                Err(_) => failed += 1,
            },
            Ok(Some(_)) => {}
            Err(_) => failed += 1,
        }
    }
    tracing::info!(found = keys.len(), copied, failed, "copied saved keys from the app's earlier name");
}

#[cfg(not(windows))]
pub fn copy_old_credentials() {}

/// Keys (the part before ".<old service>") of every credential saved under the old service name.
/// CredEnumerateW only filters by prefix, so all of the user's credentials are listed and filtered here.
#[cfg(windows)]
fn old_credential_keys() -> Vec<String> {
    use windows::core::PCWSTR;
    use windows::Win32::Security::Credentials::{CredEnumerateW, CredFree, CREDENTIALW};

    let suffix = format!(".{OLD_SERVICE}");
    let mut keys: Vec<String> = Vec::new();
    let mut count: u32 = 0;
    let mut creds: *mut *mut CREDENTIALW = std::ptr::null_mut();
    // Fails with ERROR_NOT_FOUND when the user has no credentials at all.
    if unsafe { CredEnumerateW(PCWSTR::null(), None, &mut count, &mut creds) }.is_err() || creds.is_null() {
        return keys;
    }
    let list: &[*mut CREDENTIALW] = unsafe { std::slice::from_raw_parts(creds, count as usize) };
    for &cred in list {
        if cred.is_null() {
            continue;
        }
        let target = unsafe { &(*cred).TargetName };
        if target.is_null() {
            continue;
        }
        let name: String = unsafe { target.to_string() }.unwrap_or_default();
        if let Some(key) = name.strip_suffix(suffix.as_str()) {
            if !key.is_empty() {
                keys.push(key.to_string());
            }
        }
    }
    unsafe { CredFree(creds as *const std::ffi::c_void) };
    keys
}
