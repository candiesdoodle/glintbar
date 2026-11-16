//! SHAppBarMessage wrappers: reserve the dock strip so maximised windows stop at it.
//! All functions are unsafe Win32 calls; call them on the main thread.

use windows::Win32::Foundation::{HWND, RECT};
use windows::Win32::UI::Shell::{
    SHAppBarMessage, ABE_BOTTOM, ABE_TOP, ABM_ACTIVATE, ABM_NEW, ABM_QUERYPOS, ABM_REMOVE, ABM_SETPOS,
    ABM_WINDOWPOSCHANGED, APPBARDATA,
};

use super::model::Edge;

fn data(hwnd: HWND) -> APPBARDATA {
    APPBARDATA { cbSize: std::mem::size_of::<APPBARDATA>() as u32, hWnd: hwnd, ..Default::default() }
}

fn edge_code(edge: Edge) -> u32 {
    match edge {
        Edge::Top => ABE_TOP,
        Edge::Bottom => ABE_BOTTOM,
    }
}

fn fit(rc: &mut RECT, edge: Edge, thickness: i32) {
    match edge {
        Edge::Top => rc.bottom = rc.top + thickness,
        Edge::Bottom => rc.top = rc.bottom - thickness,
    }
}

/// ABM_NEW. `callback` is the message the shell sends us (ABN_POSCHANGED, ABN_FULLSCREENAPP, ...).
pub unsafe fn register(hwnd: HWND, callback: u32) -> bool {
    let mut abd = data(hwnd);
    abd.uCallbackMessage = callback;
    unsafe { SHAppBarMessage(ABM_NEW, &mut abd) != 0 }
}

/// ABM_REMOVE: gives the reserved space back.
pub unsafe fn unregister(hwnd: HWND) {
    let mut abd = data(hwnd);
    unsafe {
        SHAppBarMessage(ABM_REMOVE, &mut abd);
    }
}

/// ABM_QUERYPOS + ABM_SETPOS for a strip `thickness` px tall on `edge` of `monitor`.
/// Skips ABM_SETPOS when the result equals `last` (avoids a work-area-changed feedback loop).
/// Returns the strip the shell granted.
pub unsafe fn reserve(hwnd: HWND, edge: Edge, monitor: RECT, thickness: i32, last: Option<RECT>) -> RECT {
    let mut abd = data(hwnd);
    abd.uEdge = edge_code(edge);
    abd.rc = monitor;
    unsafe {
        SHAppBarMessage(ABM_QUERYPOS, &mut abd);
    }
    fit(&mut abd.rc, edge, thickness);
    if last == Some(abd.rc) {
        return abd.rc;
    }
    unsafe {
        SHAppBarMessage(ABM_SETPOS, &mut abd);
    }
    fit(&mut abd.rc, edge, thickness);
    abd.rc
}

pub unsafe fn notify_window_pos_changed(hwnd: HWND) {
    let mut abd = data(hwnd);
    unsafe {
        SHAppBarMessage(ABM_WINDOWPOSCHANGED, &mut abd);
    }
}

pub unsafe fn notify_activate(hwnd: HWND) {
    let mut abd = data(hwnd);
    unsafe {
        SHAppBarMessage(ABM_ACTIVATE, &mut abd);
    }
}
