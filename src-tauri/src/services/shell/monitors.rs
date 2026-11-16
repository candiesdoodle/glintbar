//! The monitors Windows reports: device name, rectangles, DPI. Safe to call from any thread.

use serde::Serialize;
use windows::core::BOOL;
use windows::Win32::Foundation::{HWND, LPARAM, POINT, RECT};
use windows::Win32::Graphics::Gdi::{
    EnumDisplayMonitors, GetMonitorInfoW, MonitorFromPoint, MonitorFromWindow, HDC, HMONITOR, MONITORINFO,
    MONITORINFOEXW, MONITOR_DEFAULTTONEAREST, MONITOR_DEFAULTTOPRIMARY,
};
use windows::Win32::UI::HiDpi::{GetDpiForMonitor, MDT_EFFECTIVE_DPI};
use windows::Win32::UI::WindowsAndMessaging::MONITORINFOF_PRIMARY;

use super::model::Rect;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorInfo {
    /// Device name, e.g. "\\\\.\\DISPLAY1". Stable while the monitor stays on the same port.
    pub id: String,
    pub primary: bool,
    pub monitor: Rect,
    pub work: Rect,
    pub dpi: u32,
}

impl MonitorInfo {
    pub fn scale(&self) -> f64 {
        self.dpi as f64 / 96.0
    }
}

fn rect(r: RECT) -> Rect {
    Rect::new(r.left, r.top, r.right, r.bottom)
}

pub fn info_for(hmon: HMONITOR) -> Option<MonitorInfo> {
    if hmon.is_invalid() {
        return None;
    }
    unsafe {
        let mut ex = MONITORINFOEXW::default();
        ex.monitorInfo.cbSize = std::mem::size_of::<MONITORINFOEXW>() as u32;
        if !GetMonitorInfoW(hmon, &mut ex as *mut MONITORINFOEXW as *mut MONITORINFO).as_bool() {
            return None;
        }
        let len = ex.szDevice.iter().position(|c| *c == 0).unwrap_or(ex.szDevice.len());
        let id = String::from_utf16_lossy(&ex.szDevice[..len]);
        let mut dpi_x: u32 = 96;
        let mut dpi_y: u32 = 96;
        if GetDpiForMonitor(hmon, MDT_EFFECTIVE_DPI, &mut dpi_x, &mut dpi_y).is_err() {
            dpi_x = 96;
        }
        Some(MonitorInfo {
            id,
            primary: ex.monitorInfo.dwFlags & MONITORINFOF_PRIMARY != 0,
            monitor: rect(ex.monitorInfo.rcMonitor),
            work: rect(ex.monitorInfo.rcWork),
            dpi: dpi_x.clamp(48, 960),
        })
    }
}

unsafe extern "system" fn collect(hmon: HMONITOR, _hdc: HDC, _clip: *mut RECT, data: LPARAM) -> BOOL {
    let list = unsafe { &mut *(data.0 as *mut Vec<MonitorInfo>) };
    if let Some(m) = info_for(hmon) {
        list.push(m);
    }
    BOOL(1)
}

/// Every monitor, primary first.
pub fn all() -> Vec<MonitorInfo> {
    let mut list: Vec<MonitorInfo> = Vec::new();
    unsafe {
        let _ = EnumDisplayMonitors(None, None, Some(collect), LPARAM(&mut list as *mut Vec<MonitorInfo> as isize));
    }
    list.sort_by_key(|m| (!m.primary, m.monitor.left, m.monitor.top));
    if list.is_empty() {
        if let Some(p) = primary() {
            list.push(p);
        }
    }
    list
}

pub fn primary() -> Option<MonitorInfo> {
    unsafe { info_for(MonitorFromPoint(POINT { x: 0, y: 0 }, MONITOR_DEFAULTTOPRIMARY)) }
}

pub fn by_id(id: &str) -> Option<MonitorInfo> {
    if id.is_empty() {
        return None;
    }
    all().into_iter().find(|m| m.id == id)
}

pub fn at_point(x: i32, y: i32) -> Option<MonitorInfo> {
    unsafe { info_for(MonitorFromPoint(POINT { x, y }, MONITOR_DEFAULTTONEAREST)) }
}

/// The monitor a window is (mostly) on.
pub fn for_window(hwnd: HWND) -> Option<MonitorInfo> {
    info_for(unsafe { MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST) })
}

/// Device name of the monitor a window is on ("" when unknown). Compare monitors by this, never
/// by HMONITOR: handles change when a display is added, removed, re-ordered or woken up.
pub fn id_for_window(hwnd: HWND) -> String {
    for_window(hwnd).map(|m| m.id).unwrap_or_default()
}
