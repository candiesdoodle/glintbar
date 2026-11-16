//! File helpers for slices that read local app data (CLI histories, configs).
//! Reading file contents is limited to the user profile; listing and stat are not.
//! Paths accept %ENV% variables and a leading ~.

use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::error::{SvcError, SvcResult};
use crate::paths;
use crate::registry::{NoArgs, Registrar};

const DEFAULT_MAX_READ: u64 = 2 * 1024 * 1024;
const HARD_MAX_READ: u64 = 16 * 1024 * 1024;
const MAX_LIST: usize = 2000;

/// Expands `%VAR%` and a leading `~`. Unknown variables are left as they are.
pub fn expand(input: &str) -> String {
    let mut s = input.trim().to_string();
    if s == "~" || s.starts_with("~/") || s.starts_with("~\\") {
        if let Some(home) = paths::user_profile() {
            s = format!("{}{}", home.display(), &s[1..]);
        }
    }
    let mut out = String::with_capacity(s.len());
    let mut rest = s.as_str();
    while let Some(start) = rest.find('%') {
        let after = &rest[start + 1..];
        match after.find('%') {
            Some(end) if end > 0 => {
                let name = &after[..end];
                out.push_str(&rest[..start]);
                match std::env::var(name) {
                    Ok(value) => out.push_str(&value),
                    Err(_) => {
                        out.push('%');
                        out.push_str(name);
                        out.push('%');
                    }
                }
                rest = &after[end + 1..];
            }
            _ => {
                out.push_str(&rest[..=start]);
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

pub fn expand_path(input: &str) -> PathBuf {
    PathBuf::from(expand(input))
}

/// True when `path` (after resolving links and ..) is inside the user profile.
pub fn is_under_profile(path: &Path) -> bool {
    let profile = match paths::user_profile().and_then(|p| p.canonicalize().ok()) {
        Some(p) => p,
        None => return false,
    };
    match path.canonicalize() {
        Ok(p) => p.starts_with(&profile),
        Err(_) => false,
    }
}

fn modified_ms(meta: &std::fs::Metadata) -> Option<i64> {
    meta.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_millis() as i64)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadArgs {
    pub path: String,
    #[serde(default)]
    pub max_bytes: Option<u64>,
    /// Start reading at this byte (for following an append-only log).
    #[serde(default)]
    pub offset: Option<u64>,
    /// When the file is bigger than maxBytes, read its last maxBytes instead of the first.
    #[serde(default)]
    pub tail: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadResult {
    pub text: String,
    pub size: u64,
    pub modified: Option<i64>,
    /// Byte offset just after what was read; pass it back as `offset` next time.
    pub next_offset: u64,
    pub truncated: bool,
}

pub fn read_text(args: &ReadArgs) -> SvcResult<ReadResult> {
    let path = expand_path(&args.path);
    if !is_under_profile(&path) {
        return Err(SvcError::Denied("reading is limited to files in your user folder".into()));
    }
    let mut file = std::fs::File::open(&path)?;
    let meta = file.metadata()?;
    if !meta.is_file() {
        return Err(SvcError::bad_args("the path is not a file"));
    }
    let size = meta.len();
    let cap = args.max_bytes.unwrap_or(DEFAULT_MAX_READ).clamp(1, HARD_MAX_READ);
    let mut start = args.offset.unwrap_or(0).min(size);
    if args.tail && size - start > cap {
        start = size - cap;
    }
    let len = (size - start).min(cap);
    file.seek(SeekFrom::Start(start))?;
    let mut buf = Vec::with_capacity(len as usize);
    file.take(len).read_to_end(&mut buf)?;
    Ok(ReadResult {
        text: String::from_utf8_lossy(&buf).into_owned(),
        size,
        modified: modified_ms(&meta),
        next_offset: start + buf.len() as u64,
        truncated: start + (buf.len() as u64) < size,
    })
}

#[derive(Deserialize)]
struct PathArgs {
    path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stat {
    pub exists: bool,
    pub is_dir: bool,
    pub is_file: bool,
    pub size: u64,
    pub modified: Option<i64>,
}

pub fn stat(path: &Path) -> Stat {
    match std::fs::metadata(path) {
        Ok(m) => Stat { exists: true, is_dir: m.is_dir(), is_file: m.is_file(), size: m.len(), modified: modified_ms(&m) },
        Err(_) => Stat { exists: false, is_dir: false, is_file: false, size: 0, modified: None },
    }
}

#[derive(Deserialize)]
struct ListArgs {
    path: String,
    #[serde(default)]
    limit: Option<usize>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified: Option<i64>,
}

pub fn list_dir(path: &Path, limit: usize) -> SvcResult<Vec<DirEntry>> {
    let mut out = Vec::new();
    for entry in std::fs::read_dir(path)? {
        if out.len() >= limit {
            break;
        }
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        let meta = entry.metadata().ok();
        out.push(DirEntry {
            name: entry.file_name().to_string_lossy().into_owned(),
            path: entry.path().to_string_lossy().into_owned(),
            is_dir: meta.as_ref().map(|m| m.is_dir()).unwrap_or(false),
            size: meta.as_ref().map(|m| m.len()).unwrap_or(0),
            modified: meta.as_ref().and_then(modified_ms),
        });
    }
    Ok(out)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct KnownDirs {
    home: Option<String>,
    app_data: Option<String>,
    local_app_data: Option<String>,
    temp: String,
    glintbar_data: String,
}

fn env_path(name: &str) -> Option<String> {
    std::env::var(name).ok()
}

pub fn register(reg: &mut Registrar) {
    reg.add_blocking("fs", "read_text", |_app: AppHandle, a: ReadArgs| read_text(&a));
    reg.add_blocking("fs", "exists", |_app: AppHandle, a: PathArgs| Ok(expand_path(&a.path).exists()));
    reg.add_blocking("fs", "stat", |_app: AppHandle, a: PathArgs| Ok(stat(&expand_path(&a.path))));
    reg.add_blocking("fs", "list_dir", |_app: AppHandle, a: ListArgs| {
        list_dir(&expand_path(&a.path), a.limit.unwrap_or(500).min(MAX_LIST))
    });
    reg.add("fs", "expand", |_app: AppHandle, a: PathArgs| async move { Ok(expand(&a.path)) });
    reg.add("fs", "known_dirs", |_app: AppHandle, _: NoArgs| async move {
        Ok(KnownDirs {
            home: paths::user_profile().map(|p| p.to_string_lossy().into_owned()),
            app_data: env_path("APPDATA"),
            local_app_data: env_path("LOCALAPPDATA"),
            temp: std::env::temp_dir().to_string_lossy().into_owned(),
            glintbar_data: paths::data_dir().to_string_lossy().into_owned(),
        })
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expands_env_vars() {
        std::env::set_var("GLINTBAR_TEST_DIR", "C:\\x");
        assert_eq!(expand("%GLINTBAR_TEST_DIR%\\a"), "C:\\x\\a");
        assert_eq!(expand("%NOPE_NOT_SET_42%\\a"), "%NOPE_NOT_SET_42%\\a");
        assert_eq!(expand("100%"), "100%");
    }
}
