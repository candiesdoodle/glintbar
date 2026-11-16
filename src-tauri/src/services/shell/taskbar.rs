//! The Windows taskbar while GlintBar runs: hidden, auto-hide, or left alone - and always back.
//!
//! Hidden = auto-hide on (ABM_SETSTATE) + SW_HIDE on the bar of every screen that has a dock
//! (Shell_TrayWnd and the Shell_SecondaryTrayWnd windows). The taskbar's original state is
//! saved to %APPDATA%\\GlintBar\\taskbar-hidden.json before the first change; if GlintBar dies without
//! cleanup (crash, taskkill, installer), the next start finds the file and restores first.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use windows::core::{w, PCWSTR};
use windows::Win32::Foundation::{HWND, LPARAM};
use windows::Win32::UI::Shell::{SHAppBarMessage, ABM_GETSTATE, ABM_SETSTATE, ABS_ALWAYSONTOP, ABS_AUTOHIDE, APPBARDATA};
use windows::Win32::UI::WindowsAndMessaging::{FindWindowExW, FindWindowW, ShowWindowAsync, SW_HIDE, SW_SHOWNA};

use super::model::TaskbarMode;
use super::monitors;
use crate::paths;

/// True while the taskbar is changed from how we found it.
static CHANGED: AtomicBool = AtomicBool::new(false);
/// Bar windows we hid (raw HWNDs), for the "it came back" watchdog.
static HIDDEN_BARS: Mutex<Vec<isize>> = Mutex::new(Vec::new());
/// The last request, so Explorer restarts and resume can re-apply it.
static LAST: Mutex<Option<(TaskbarMode, Vec<String>)>> = Mutex::new(None);

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Saved {
    previous_state: u32,
}

fn flag_path() -> PathBuf {
    paths::data_dir().join("taskbar-hidden.json")
}

fn read_flag() -> Option<Saved> {
    let bytes = std::fs::read(flag_path()).ok()?;
    serde_json::from_slice(&bytes).ok()
}

fn write_flag(previous_state: u32) {
    match serde_json::to_vec(&Saved { previous_state }) {
        Ok(bytes) => {
            if let Err(e) = std::fs::write(flag_path(), bytes) {
                tracing::warn!("could not save the taskbar state: {e}");
            }
        }
        Err(e) => tracing::warn!("could not encode the taskbar state: {e}"),
    }
}

/// Shell_TrayWnd first, then every secondary-monitor taskbar.
fn taskbars() -> Vec<HWND> {
    let mut out = Vec::new();
    unsafe {
        if let Ok(h) = FindWindowW(w!("Shell_TrayWnd"), PCWSTR::null()) {
            if !h.is_invalid() {
                out.push(h);
            }
        }
        let mut after: Option<HWND> = None;
        for _ in 0..16 {
            match FindWindowExW(None, after, w!("Shell_SecondaryTrayWnd"), PCWSTR::null()) {
                Ok(h) if !h.is_invalid() => {
                    out.push(h);
                    after = Some(h);
                }
                _ => break,
            }
        }
    }
    out
}

fn data(hwnd: HWND) -> APPBARDATA {
    APPBARDATA { cbSize: std::mem::size_of::<APPBARDATA>() as u32, hWnd: hwnd, ..Default::default() }
}

fn get_state(tray: HWND) -> u32 {
    let mut abd = data(tray);
    unsafe { SHAppBarMessage(ABM_GETSTATE, &mut abd) as u32 }
}

fn set_state(tray: HWND, state: u32) {
    let mut abd = data(tray);
    abd.lParam = LPARAM(state as isize);
    unsafe {
        SHAppBarMessage(ABM_SETSTATE, &mut abd);
    }
}

pub fn is_hidden() -> bool {
    CHANGED.load(Ordering::SeqCst)
}

/// True for a taskbar window we hid. Never blocks (called from a WinEvent hook).
pub fn is_hidden_bar(hwnd: isize) -> bool {
    match HIDDEN_BARS.try_lock() {
        Ok(list) => list.contains(&hwnd),
        Err(_) => false,
    }
}

/// Applies `mode`. `dock_monitors` are the device names of the monitors that have a dock: in
/// Hidden mode only their bars are hidden. Idempotent; safe to call again after Explorer restarts.
pub fn apply(mode: TaskbarMode, dock_monitors: &[String]) {
    // After quit/logoff/panic cleanup only GlintBar's restore may touch the taskbar: a late
    // re-layout, resume or "the taskbar showed itself" watchdog must not hide it again.
    if crate::lifecycle::is_cleaning_up() {
        return;
    }
    if let Ok(mut last) = LAST.lock() {
        *last = Some((mode, dock_monitors.to_vec()));
    }
    if mode == TaskbarMode::Normal {
        restore();
        return;
    }
    let bars = taskbars();
    let primary = match bars.first() {
        Some(h) => *h,
        None => {
            tracing::warn!("no Windows taskbar found");
            return;
        }
    };
    let saved = read_flag();
    let previous = match &saved {
        Some(s) => s.previous_state,
        None => {
            let p = get_state(primary);
            write_flag(p);
            p
        }
    };
    set_state(primary, ABS_AUTOHIDE | (previous & ABS_ALWAYSONTOP));

    let mut hidden: Vec<isize> = Vec::new();
    let before: Vec<isize> = HIDDEN_BARS.lock().map(|l| l.clone()).unwrap_or_default();
    for h in &bars {
        let raw = h.0 as isize;
        let bar_monitor = monitors::id_for_window(*h);
        let hide = mode == TaskbarMode::Hidden && !bar_monitor.is_empty() && dock_monitors.iter().any(|m| *m == bar_monitor);
        unsafe {
            if hide {
                let _ = ShowWindowAsync(*h, SW_HIDE);
                hidden.push(raw);
            } else if before.contains(&raw) {
                let _ = ShowWindowAsync(*h, SW_SHOWNA);
            }
        }
    }
    if let Ok(mut list) = HIDDEN_BARS.lock() {
        *list = hidden.clone();
    }
    if !CHANGED.swap(true, Ordering::SeqCst) {
        tracing::info!(?mode, hidden = hidden.len(), bars = bars.len(), "Windows taskbar changed");
    }
}

/// Explorer restarted, the PC resumed, or a bar showed itself again: apply the last request.
pub fn reapply() {
    let last = LAST.lock().ok().and_then(|l| l.clone());
    if let Some((mode, monitors)) = last {
        if mode != TaskbarMode::Normal {
            apply(mode, &monitors);
        }
    }
}

/// Brings the taskbar back exactly as it was. Safe to call any number of times, from any thread.
pub fn restore() {
    let saved = read_flag();
    let was_changed = CHANGED.swap(false, Ordering::SeqCst);
    if !was_changed && saved.is_none() {
        return;
    }
    let previous = saved.map(|s| s.previous_state).unwrap_or(ABS_ALWAYSONTOP);
    let bars = taskbars();
    if let Some(primary) = bars.first() {
        set_state(*primary, previous);
    }
    for h in &bars {
        unsafe {
            let _ = ShowWindowAsync(*h, SW_SHOWNA);
        }
    }
    if let Ok(mut list) = HIDDEN_BARS.try_lock() {
        list.clear();
    }
    if bars.is_empty() {
        // Explorer is not running: nothing could be put back. Keep the saved state so the next
        // apply (Explorer restarted) or the next start still knows how the taskbar really was.
        tracing::warn!("no Windows taskbar to restore (Explorer not running); keeping the saved state");
        return;
    }
    let _ = std::fs::remove_file(flag_path());
    tracing::info!(count = bars.len(), "Windows taskbar restored");
}

/// A previous run left the taskbar changed (it crashed or was killed): put it back first.
pub fn recover_if_needed() {
    if read_flag().is_some() {
        tracing::warn!("the taskbar was left changed by a previous run; restoring it");
        restore();
    }
}
