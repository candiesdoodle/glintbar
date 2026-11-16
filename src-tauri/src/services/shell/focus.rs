//! Keyboard focus hand-back. The dock never takes focus on a click; it only becomes focusable
//! while a text field (or keyboard navigation) needs the keyboard. When it flips to focusable we
//! remember the window the user was in; when it lets go and is still the foreground window, that
//! window gets the foreground back (or, if it is gone, hidden or minimized, the next normal window
//! in Z order). A window the user has clicked since is never touched.

use std::sync::atomic::{AtomicIsize, Ordering};

use windows::Win32::Foundation::HWND;
use windows::Win32::UI::WindowsAndMessaging::{
    GetForegroundWindow, GetWindow, GetWindowLongW, GetWindowThreadProcessId, IsIconic, IsWindow, IsWindowVisible,
    SetForegroundWindow, GWL_EXSTYLE, GW_HWNDNEXT, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
};

use super::{watch, window};

/// The foreground window (raw HWND) from before the dock took focus; 0 = none.
static PREVIOUS: AtomicIsize = AtomicIsize::new(0);

fn hwnd(raw: isize) -> HWND {
    HWND(raw as *mut core::ffi::c_void)
}

fn is_own(h: HWND) -> bool {
    if h.is_invalid() {
        return false;
    }
    let mut pid: u32 = 0;
    unsafe {
        GetWindowThreadProcessId(h, Some(&mut pid as *mut u32));
    }
    pid == std::process::id()
}

/// True while one of GlintBar's own windows is the foreground window.
pub(super) fn foreground_is_own() -> bool {
    let fg = unsafe { GetForegroundWindow() };
    is_own(fg)
}

/// Exists, is shown, is not minimized or cloaked, and is not ours.
fn usable(h: HWND) -> bool {
    if h.is_invalid() || is_own(h) {
        return false;
    }
    let ok = unsafe { IsWindow(Some(h)).as_bool() && IsWindowVisible(h).as_bool() && !IsIconic(h).as_bool() };
    ok && !watch::is_cloaked(h)
}

/// The dock is about to become focusable: remember who has the foreground (unless it is us).
pub(super) fn remember_foreground() {
    let fg = unsafe { GetForegroundWindow() };
    if fg.is_invalid() || is_own(fg) {
        return;
    }
    PREVIOUS.store(fg.0 as isize, Ordering::SeqCst);
    tracing::info!(previous = %watch::describe_window(fg.0 as isize), "dock takes keyboard focus");
}

/// The dock stopped being focusable. Main thread.
pub(super) fn schedule_hand_back() {
    window::on_main(hand_back);
}

/// The next window below `start` in Z order that a user could be working in.
fn next_in_z_order(start: HWND) -> Option<HWND> {
    let mut cur = start;
    for _ in 0..512 {
        cur = match unsafe { GetWindow(cur, GW_HWNDNEXT) } {
            Ok(h) if !h.is_invalid() => h,
            _ => return None,
        };
        if !usable(cur) {
            continue;
        }
        let ex = unsafe { GetWindowLongW(cur, GWL_EXSTYLE) } as u32;
        if ex & WS_EX_TOOLWINDOW.0 != 0 || ex & WS_EX_NOACTIVATE.0 != 0 {
            continue;
        }
        return Some(cur);
    }
    None
}

fn hand_back() {
    let prev = PREVIOUS.swap(0, Ordering::SeqCst);
    let fg = unsafe { GetForegroundWindow() };
    if !is_own(fg) {
        // The user went somewhere else themselves (or nothing is in front): leave it alone.
        tracing::info!(front = %watch::describe_window(fg.0 as isize), "focus released; another window is already in front");
        return;
    }
    if prev != 0 {
        let p = hwnd(prev);
        if usable(p) {
            let ok = unsafe { SetForegroundWindow(p) }.as_bool();
            if ok {
                tracing::info!(to = %watch::describe_window(prev), "focus handed back to the previous window");
                return;
            }
            tracing::warn!(to = %watch::describe_window(prev), "focus not handed back: SetForegroundWindow refused");
        } else {
            tracing::info!("the previous window is gone, hidden or minimized; activating the next window instead");
        }
    }
    match next_in_z_order(fg) {
        Some(next) => {
            let ok = unsafe { SetForegroundWindow(next) }.as_bool();
            tracing::info!(to = %watch::describe_window(next.0 as isize), ok, "focus handed to the next window in Z order");
        }
        None => tracing::info!("focus released; no other window to activate"),
    }
}
