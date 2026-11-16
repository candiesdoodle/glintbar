//! Smoke-test support for the CI harness (.github/workflows/build.yml, scripts/smoke/drive.ps1).
//!
//! Everything here is inert unless the app was started with GLINTBAR_SMOKE=1:
//! - `smoke.status`   {enabled, noCaptureExclude, dir, pid} (always answers, so the UI can ask)
//! - `smoke.methods` / `smoke.topics`  every registered "service.method" / "service/topic"
//!   (from the live ServiceRegistry)
//! - `smoke.window {label}`  the window's outer/inner rect in physical px, scale, and the
//!   native facts screenshots depend on (display affinity, ex-style, window region box)
//! - `smoke.read {name}` / `smoke.write {name, text, append}`  plain files in
//!   %APPDATA%\\GlintBar\\smoke only (command.json from the driver, results written by the UI)
//! - `smoke.blocked`  side effects refused because of smoke mode (see `guard`)
//! - `smoke.allow_launch {seconds}`  lets `shell.open` (launch::open, e.g. the Apps tile opening
//!   File Explorer) through the guard for a few seconds (max 60; 0 closes the window again)
//! - `smoke.capture_override {seconds}`  lets live glass exclude the dock from capture for a few
//!   seconds although smoke mode normally forbids it (appearance/capture.rs asks
//!   `capture_exclusion_allowed`); the driver checks frames and display affinity meanwhile
//!
//! `guard(what)` is called by the core services that change the machine (shell.open and every
//! Rust caller of launch::open, shell.run, autostart, relaunch, secrets writes) so a scripted
//! click in CI never launches programs or writes credentials.

use std::io::Write;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::error::{SvcError, SvcResult};
use crate::paths;
use crate::registry::{NoArgs, Registrar, ServiceRegistry};

const MAX_WRITE: usize = 8 * 1024 * 1024;
const MAX_READ: u64 = 2 * 1024 * 1024;
const MAX_BLOCKED: usize = 500;

static ENABLED: OnceLock<bool> = OnceLock::new();
static BLOCKED: Mutex<Vec<String>> = Mutex::new(Vec::new());
/// Until when `shell.open` may pass the guard (smoke.allow_launch).
static LAUNCH_UNTIL: Mutex<Option<Instant>> = Mutex::new(None);
/// Until when live glass may exclude the dock from capture (smoke.capture_override).
static CAPTURE_UNTIL: Mutex<Option<Instant>> = Mutex::new(None);
const MAX_WINDOW_SECS: u64 = 60;

fn env_flag(name: &str) -> bool {
    match std::env::var(name) {
        Ok(v) => {
            let v = v.trim().to_ascii_lowercase();
            v == "1" || v == "true" || v == "yes"
        }
        Err(_) => false,
    }
}

/// True when the app was started by the smoke harness (GLINTBAR_SMOKE=1).
pub fn enabled() -> bool {
    *ENABLED.get_or_init(|| env_flag("GLINTBAR_SMOKE"))
}

fn window_open(slot: &Mutex<Option<Instant>>) -> bool {
    let until: Option<Instant> = *slot.lock().unwrap_or_else(|p| p.into_inner());
    match until {
        Some(t) => Instant::now() < t,
        None => false,
    }
}

/// Opens (or with 0 closes) a time window; returns the seconds granted.
fn set_window(slot: &Mutex<Option<Instant>>, seconds: u64) -> u64 {
    let secs = seconds.min(MAX_WINDOW_SECS);
    let mut until = slot.lock().unwrap_or_else(|p| p.into_inner());
    *until = if secs == 0 { None } else { Some(Instant::now() + Duration::from_secs(secs)) };
    secs
}

/// Smoke mode only: true while the driver's live-glass check allows capture exclusion.
/// Always false outside smoke mode (the normal rules apply there).
pub fn capture_exclusion_allowed() -> bool {
    enabled() && window_open(&CAPTURE_UNTIL)
}

/// In smoke mode: refuses an action that would change the machine, and remembers it.
/// Outside smoke mode: Ok(()).
pub fn guard(what: &str) -> SvcResult<()> {
    if !enabled() {
        return Ok(());
    }
    if what == "shell.open" && window_open(&LAUNCH_UNTIL) {
        tracing::info!("smoke mode: allowed {what} (launch window opened by the driver)");
        return Ok(());
    }
    {
        let mut list = BLOCKED.lock().unwrap_or_else(|p| p.into_inner());
        if list.len() < MAX_BLOCKED {
            list.push(what.chars().take(200).collect());
        }
    }
    tracing::info!("smoke mode: blocked {what}");
    Err(SvcError::Denied(format!("{what} is blocked in smoke mode")))
}

/// %APPDATA%\\GlintBar\\smoke (created on first use).
pub fn smoke_dir() -> PathBuf {
    let dir = paths::data_dir().join("smoke");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

/// A plain file name inside the smoke folder: letters, digits, '-', '_' and '.', no "..".
fn smoke_file(name: &str) -> SvcResult<PathBuf> {
    let ok = !name.is_empty()
        && name.len() <= 80
        && !name.starts_with('.')
        && !name.contains("..")
        && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.');
    if !ok {
        return Err(SvcError::bad_args("smoke files are plain names such as layout.json"));
    }
    Ok(smoke_dir().join(name))
}

fn require_smoke() -> SvcResult<()> {
    if enabled() {
        Ok(())
    } else {
        Err(SvcError::Denied("smoke mode is off".into()))
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Status {
    enabled: bool,
    no_capture_exclude: bool,
    dir: String,
    pid: u32,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct SecondsArgs {
    seconds: u64,
}

#[derive(Deserialize)]
struct NameArgs {
    name: String,
}

#[derive(Deserialize)]
struct WriteArgs {
    name: String,
    text: String,
    #[serde(default)]
    append: bool,
}

fn main_label() -> String {
    "main".to_string()
}

#[derive(Deserialize)]
struct LabelArgs {
    #[serde(default = "main_label")]
    label: String,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct NativeInfo {
    hwnd: i64,
    /// GetWindowDisplayAffinity: 0 none, 1 monitor, 17 (0x11) excluded from capture; -1 unknown.
    display_affinity: i64,
    ex_style: i64,
    style: i64,
    visible: bool,
    /// GetWindowRect in physical px.
    rect: [i32; 4],
    /// GetWindowRgnBox: 0 error / no region, 1 empty, 2 simple, 3 complex.
    region_kind: i32,
    /// The region's bounding box, window-relative physical px.
    region_box: [i32; 4],
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WindowRect {
    label: String,
    visible: bool,
    scale: f64,
    outer_x: i32,
    outer_y: i32,
    outer_width: u32,
    outer_height: u32,
    inner_x: i32,
    inner_y: i32,
    inner_width: u32,
    inner_height: u32,
    native: Option<NativeInfo>,
}

fn write_file(name: &str, text: &str, append: bool) -> SvcResult<u64> {
    require_smoke()?;
    if text.len() > MAX_WRITE {
        return Err(SvcError::bad_args("smoke files are limited to 8 MB"));
    }
    let path = smoke_file(name)?;
    if append {
        let mut f = std::fs::OpenOptions::new().create(true).append(true).open(&path)?;
        f.write_all(text.as_bytes())?;
        return Ok(text.len() as u64);
    }
    // Atomic replace so the PowerShell driver never reads half a file. The driver may hold the
    // file open for a moment; retry, then fall back to a direct write.
    let tmp = smoke_dir().join(format!("{name}.tmp"));
    std::fs::write(&tmp, text.as_bytes())?;
    let mut last_err: Option<std::io::Error> = None;
    for _ in 0..5 {
        match std::fs::rename(&tmp, &path) {
            Ok(()) => return Ok(text.len() as u64),
            Err(e) => {
                last_err = Some(e);
                std::thread::sleep(Duration::from_millis(40));
            }
        }
    }
    let _ = std::fs::remove_file(&tmp);
    match std::fs::write(&path, text.as_bytes()) {
        Ok(()) => Ok(text.len() as u64),
        Err(e) => {
            let first = last_err.map(|x| x.to_string()).unwrap_or_default();
            Err(SvcError::Io(format!("could not write {name}: {e} (rename: {first})")))
        }
    }
}

fn read_file(name: &str) -> SvcResult<Option<String>> {
    require_smoke()?;
    let path = smoke_file(name)?;
    let meta = match std::fs::metadata(&path) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(SvcError::from(e)),
    };
    if meta.len() > MAX_READ {
        return Err(SvcError::bad_args("smoke file is too big to read"));
    }
    match std::fs::read(&path) {
        Ok(bytes) => Ok(Some(String::from_utf8_lossy(&bytes).into_owned())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(SvcError::from(e)),
    }
}

fn method_list(app: &AppHandle) -> Vec<String> {
    match app.try_state::<Arc<ServiceRegistry>>() {
        Some(registry) => registry.methods(),
        None => Vec::new(),
    }
}

fn blocked_list() -> Vec<String> {
    BLOCKED.lock().unwrap_or_else(|p| p.into_inner()).clone()
}

#[cfg(windows)]
fn native_info(raw: isize) -> NativeInfo {
    use std::ffi::c_void;
    use windows::Win32::Foundation::{HWND, RECT};
    use windows::Win32::Graphics::Gdi::GetWindowRgnBox;
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowDisplayAffinity, GetWindowLongPtrW, GetWindowRect, IsWindowVisible, GWL_EXSTYLE, GWL_STYLE,
    };

    let h = HWND(raw as *mut c_void);
    let mut affinity: u32 = 0;
    let display_affinity = match unsafe { GetWindowDisplayAffinity(h, &mut affinity as *mut u32) } {
        Ok(()) => affinity as i64,
        Err(_) => -1,
    };
    let ex_style = unsafe { GetWindowLongPtrW(h, GWL_EXSTYLE) } as i64;
    let style = unsafe { GetWindowLongPtrW(h, GWL_STYLE) } as i64;
    let visible = unsafe { IsWindowVisible(h) }.as_bool();
    let mut wr = RECT::default();
    let rect = match unsafe { GetWindowRect(h, &mut wr as *mut RECT) } {
        Ok(()) => [wr.left, wr.top, wr.right, wr.bottom],
        Err(_) => [0, 0, 0, 0],
    };
    let mut rb = RECT::default();
    let kind = unsafe { GetWindowRgnBox(h, &mut rb as *mut RECT) };
    NativeInfo {
        hwnd: raw as i64,
        display_affinity,
        ex_style,
        style,
        visible,
        rect,
        region_kind: kind.0,
        region_box: [rb.left, rb.top, rb.right, rb.bottom],
    }
}

fn window_rect(app: &AppHandle, label: &str) -> SvcResult<WindowRect> {
    let w = app
        .get_webview_window(label)
        .ok_or_else(|| SvcError::NotFound(format!("window {label}")))?;
    let outer = w.outer_position()?;
    let inner = w.inner_position()?;
    let outer_size = w.outer_size()?;
    let inner_size = w.inner_size()?;
    let scale = w.scale_factor()?;
    let visible = w.is_visible().unwrap_or(false);
    #[cfg(windows)]
    let native = match w.hwnd() {
        Ok(h) => Some(native_info(h.0 as isize)),
        Err(_) => None,
    };
    #[cfg(not(windows))]
    let native: Option<NativeInfo> = None;
    Ok(WindowRect {
        label: label.to_string(),
        visible,
        scale,
        outer_x: outer.x,
        outer_y: outer.y,
        outer_width: outer_size.width,
        outer_height: outer_size.height,
        inner_x: inner.x,
        inner_y: inner.y,
        inner_width: inner_size.width,
        inner_height: inner_size.height,
        native,
    })
}

pub fn register(reg: &mut Registrar) {
    if enabled() {
        reg.on_setup(|_app: &AppHandle| {
            tracing::info!(
                dir = %smoke_dir().display(),
                no_capture_exclude = env_flag("GLINTBAR_NO_CAPTURE_EXCLUDE"),
                "smoke mode is on: side effects are blocked"
            );
        });
    }
    reg.add("smoke", "status", |_app: AppHandle, _: NoArgs| async move {
        let on = enabled();
        Ok(Status {
            enabled: on,
            no_capture_exclude: env_flag("GLINTBAR_NO_CAPTURE_EXCLUDE"),
            dir: if on { smoke_dir().to_string_lossy().into_owned() } else { String::new() },
            pid: std::process::id(),
        })
    });
    reg.add_blocking("smoke", "methods", |app: AppHandle, _: NoArgs| -> SvcResult<Vec<String>> {
        require_smoke()?;
        Ok(method_list(&app))
    });
    reg.add_blocking("smoke", "topics", |app: AppHandle, _: NoArgs| -> SvcResult<Vec<String>> {
        require_smoke()?;
        Ok(crate::registry::list_topics(&app))
    });
    reg.add_blocking("smoke", "window", |app: AppHandle, a: LabelArgs| -> SvcResult<WindowRect> {
        require_smoke()?;
        window_rect(&app, &a.label)
    });
    reg.add_blocking("smoke", "read", |_app: AppHandle, a: NameArgs| -> SvcResult<Option<String>> { read_file(&a.name) });
    reg.add_blocking("smoke", "write", |_app: AppHandle, a: WriteArgs| -> SvcResult<u64> {
        write_file(&a.name, &a.text, a.append)
    });
    reg.add("smoke", "blocked", |_app: AppHandle, _: NoArgs| async move {
        require_smoke()?;
        Ok::<Vec<String>, SvcError>(blocked_list())
    });
    reg.add("smoke", "allow_launch", |_app: AppHandle, a: SecondsArgs| async move {
        require_smoke()?;
        let secs = set_window(&LAUNCH_UNTIL, a.seconds);
        tracing::info!(seconds = secs, "smoke mode: launches allowed for a while");
        Ok::<u64, SvcError>(secs)
    });
    reg.add("smoke", "capture_override", |_app: AppHandle, a: SecondsArgs| async move {
        require_smoke()?;
        let secs = set_window(&CAPTURE_UNTIL, a.seconds);
        tracing::info!(seconds = secs, "smoke mode: capture exclusion allowed for a while");
        // The live-glass loop decides about the exclusion on its own schedule; make it look now.
        crate::services::appearance::wake_glass();
        Ok::<u64, SvcError>(secs)
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn smoke_file_names_stay_in_the_folder() {
        assert!(smoke_file("layout.json").is_ok());
        assert!(smoke_file("command-result.json").is_ok());
        assert!(smoke_file("../store.json").is_err());
        assert!(smoke_file("a/b.json").is_err());
        assert!(smoke_file("a\\b.json").is_err());
        assert!(smoke_file(".hidden").is_err());
        assert!(smoke_file("").is_err());
        assert!(smoke_file("C:x.json").is_err());
    }

    #[test]
    fn time_windows_open_and_close() {
        static SLOT: Mutex<Option<Instant>> = Mutex::new(None);
        assert!(!window_open(&SLOT));
        assert_eq!(set_window(&SLOT, 5), 5);
        assert!(window_open(&SLOT));
        assert_eq!(set_window(&SLOT, 0), 0);
        assert!(!window_open(&SLOT));
        assert_eq!(set_window(&SLOT, 999), MAX_WINDOW_SECS);
    }
}
