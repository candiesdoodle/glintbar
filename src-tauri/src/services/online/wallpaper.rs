//! `online.set_wallpaper {url, id}`: downloads the picture into %APPDATA%\\GlintBar\\wallpapers and
//! makes it the desktop wallpaper with SystemParametersInfoW(SPI_SETDESKWALLPAPER). Keeps the
//! newest few files so a rotation does not fill the disk.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use base64::Engine;
use serde::{Deserialize, Serialize};

use crate::error::{SvcError, SvcResult};
use crate::paths;
use crate::registry::run_blocking;
use crate::services::core::http::{self, FetchArgs};

const KEEP_FILES: usize = 8;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetWallpaperArgs {
    pub url: String,
    /// The photo's id; used as the file name.
    pub id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetWallpaperResult {
    pub path: String,
}

fn safe_name(id: &str) -> String {
    let cleaned: String = id
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .take(64)
        .collect();
    if cleaned.is_empty() {
        "wallpaper".to_string()
    } else {
        cleaned
    }
}

fn prune(dir: &Path, keep: &Path) {
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    let mut files: Vec<(std::time::SystemTime, PathBuf)> = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path == keep || !path.is_file() {
            continue;
        }
        let modified = entry
            .metadata()
            .and_then(|m| m.modified())
            .unwrap_or(std::time::SystemTime::UNIX_EPOCH);
        files.push((modified, path));
    }
    files.sort_by(|a, b| b.0.cmp(&a.0));
    for (_, path) in files.into_iter().skip(KEEP_FILES.saturating_sub(1)) {
        let _ = std::fs::remove_file(path);
    }
}

#[cfg(windows)]
fn apply_system(path: &Path) -> SvcResult<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows::Win32::UI::WindowsAndMessaging::{
        SystemParametersInfoW, SPIF_SENDWININICHANGE, SPIF_UPDATEINIFILE, SPI_SETDESKWALLPAPER,
    };
    let mut wide: Vec<u16> = path.as_os_str().encode_wide().collect();
    wide.push(0);
    unsafe {
        SystemParametersInfoW(
            SPI_SETDESKWALLPAPER,
            0,
            Some(wide.as_mut_ptr() as *mut std::ffi::c_void),
            SPIF_UPDATEINIFILE | SPIF_SENDWININICHANGE,
        )
    }
    .map_err(|e| SvcError::Internal(format!("Windows refused to set the wallpaper: {e}")))
}

#[cfg(not(windows))]
fn apply_system(_path: &Path) -> SvcResult<()> {
    Err(SvcError::unsupported("wallpapers can only be set on Windows"))
}

/// The file extension for a picture Windows can use as wallpaper, judged from its bytes.
fn picture_ext(bytes: &[u8]) -> Option<&'static str> {
    match image::guess_format(bytes).ok()? {
        image::ImageFormat::Jpeg => Some("jpg"),
        image::ImageFormat::Png => Some("png"),
        image::ImageFormat::Bmp => Some("bmp"),
        _ => None,
    }
}

fn save_and_apply(bytes: Vec<u8>, id: String) -> SvcResult<SetWallpaperResult> {
    let ext = picture_ext(&bytes).ok_or_else(|| SvcError::Http("the downloaded file is not a JPEG, PNG or BMP image".into()))?;
    let dir = paths::data_dir().join("wallpapers");
    std::fs::create_dir_all(&dir).map_err(SvcError::from)?;
    let path = dir.join(format!("{}.{ext}", safe_name(&id)));
    std::fs::write(&path, &bytes).map_err(SvcError::from)?;
    apply_system(&path)?;
    prune(&dir, &path);
    Ok(SetWallpaperResult { path: path.to_string_lossy().into_owned() })
}

pub async fn set_wallpaper(a: SetWallpaperArgs) -> SvcResult<SetWallpaperResult> {
    let url = a.url.trim().to_string();
    if !url.to_ascii_lowercase().starts_with("https://") {
        return Err(SvcError::bad_args("only https:// picture addresses are allowed"));
    }
    let res = http::fetch(FetchArgs {
        url,
        method: Some("GET".into()),
        headers: HashMap::new(),
        body: None,
        body_base64: None,
        timeout_ms: Some(90_000),
        response_type: Some("base64".into()),
        max_bytes: Some(30 * 1024 * 1024),
    })
    .await?;
    if !res.ok {
        return Err(SvcError::Http(format!("downloading the picture failed ({})", res.status)));
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(res.body.as_bytes())
        .map_err(|e| SvcError::Internal(format!("picture data: {e}")))?;
    if bytes.len() < 1024 {
        return Err(SvcError::Http("the downloaded file is not an image".into()));
    }
    let id = a.id.clone();
    run_blocking(move || save_and_apply(bytes, id)).await
}
