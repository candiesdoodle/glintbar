//! Win32 pieces of the live glass: a GDI capturer for a screen rectangle (downscaled in the same
//! blit with StretchBlt + HALFTONE, so the big screen area is never copied at full size), the
//! capture exclusion of the dock window, and the pause checks (hidden, fullscreen, battery saver,
//! locked session).

use std::ffi::c_void;
use std::sync::OnceLock;

use windows::Win32::Foundation::{HWND, RECT};
use windows::Win32::Graphics::Gdi::{
    CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, GdiFlush, GetDC, GetMonitorInfoW, MonitorFromWindow,
    ReleaseDC, SelectObject, SetBrushOrgEx, SetStretchBltMode, StretchBlt, BITMAPINFO, BITMAPINFOHEADER, BI_RGB,
    DIB_RGB_COLORS, HALFTONE, HBITMAP, HDC, HGDIOBJ, MONITORINFO, MONITOR_DEFAULTTONEAREST, SRCCOPY,
};
use windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};
use windows::Win32::System::Registry::HKEY_LOCAL_MACHINE;
use windows::Win32::System::Threading::GetCurrentThreadId;
use windows::Win32::System::StationsAndDesktops::{
    CloseDesktop, OpenInputDesktop, SwitchDesktop, DESKTOP_CONTROL_FLAGS, DESKTOP_SWITCHDESKTOP,
};
use windows::Win32::UI::HiDpi::GetDpiForWindow;
use windows::Win32::UI::Shell::{
    SHQueryUserNotificationState, QUNS_BUSY, QUNS_PRESENTATION_MODE, QUNS_RUNNING_D3D_FULL_SCREEN,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GetWindowDisplayAffinity, GetWindowRect, GetWindowThreadProcessId, IsIconic, IsWindowVisible, SetWindowDisplayAffinity,
    WDA_EXCLUDEFROMCAPTURE, WDA_NONE,
};

use super::glass::GlassConfig;

pub fn hwnd_from_raw(raw: isize) -> HWND {
    HWND(raw as *mut c_void)
}

/// GLINTBAR_NO_CAPTURE_EXCLUDE=1 or GLINTBAR_SMOKE=1 (test runs that screenshot the desktop): the dock
/// is never excluded from capture; live glass falls back to the wallpaper.
pub fn exclusion_blocked_by_env() -> bool {
    // The smoke driver's live-glass check lifts this for a few seconds (smoke mode only).
    if crate::services::core::smoke::capture_exclusion_allowed() {
        return false;
    }
    let on = |name: &str| std::env::var(name).map(|v| v.trim() == "1").unwrap_or(false);
    on("GLINTBAR_NO_CAPTURE_EXCLUDE") || on("GLINTBAR_SMOKE")
}

/// GetWindowDisplayAffinity value of a window excluded from capture (WDA_EXCLUDEFROMCAPTURE).
pub const AFFINITY_EXCLUDE: u32 = 0x11;

static OS_BUILD: OnceLock<u32> = OnceLock::new();

/// The Windows build number (CurrentBuildNumber), 0 when unknown. Read once.
pub fn os_build() -> u32 {
    *OS_BUILD.get_or_init(|| {
        crate::win::reg_string(HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows NT\CurrentVersion", "CurrentBuildNumber")
            .and_then(|s| s.trim().parse::<u32>().ok())
            .unwrap_or(0)
    })
}

/// WDA_EXCLUDEFROMCAPTURE exists from Windows 10 2004 (build 19041). Older builds treat it like
/// WDA_MONITOR, which would capture the dock as a black box, so never use it there.
pub fn os_supports_exclusion() -> bool {
    os_build() >= 19041
}

/// GetWindowDisplayAffinity: 0 none, 17 excluded from capture, -1 unknown.
pub fn display_affinity(h: HWND) -> i64 {
    let mut v: u32 = 0;
    match unsafe { GetWindowDisplayAffinity(h, &mut v as *mut u32) } {
        Ok(()) => v as i64,
        Err(_) => -1,
    }
}

/// Keeps the dock out of every screen capture (ours included), so capturing the strip behind it
/// never sees the dock itself. Must run on the thread that owns the window (the main thread):
/// SetWindowDisplayAffinity fails with ERROR_ACCESS_DENIED from any other thread or process.
/// Returns the affinity read back afterwards (17 excluded, 0 none).
pub fn set_exclude_from_capture(raw: isize, on: bool) -> Result<u32, String> {
    if on && exclusion_blocked_by_env() {
        return Err("blocked by GLINTBAR_SMOKE / GLINTBAR_NO_CAPTURE_EXCLUDE (no smoke override open)".to_string());
    }
    let h = hwnd_from_raw(raw);
    let owner_thread = unsafe { GetWindowThreadProcessId(h, None) };
    let this_thread = unsafe { GetCurrentThreadId() };
    let affinity = if on { WDA_EXCLUDEFROMCAPTURE } else { WDA_NONE };
    let result = unsafe { SetWindowDisplayAffinity(h, affinity) };
    let now = display_affinity(h);
    match result {
        Ok(()) => {
            tracing::info!(
                on,
                affinity_now = now,
                hwnd = raw as i64,
                owner_thread,
                this_thread,
                "live glass: SetWindowDisplayAffinity({}) ok",
                if on { "WDA_EXCLUDEFROMCAPTURE" } else { "WDA_NONE" }
            );
            if now < 0 {
                Err("SetWindowDisplayAffinity succeeded but GetWindowDisplayAffinity failed".to_string())
            } else {
                Ok(now as u32)
            }
        }
        Err(e) => {
            let hr = e.code().0;
            let msg = format!(
                "SetWindowDisplayAffinity({}) failed: {} (HRESULT {:#010x}, GetLastError {}; window thread {}, calling thread {}, build {}, affinity now {})",
                if on { "WDA_EXCLUDEFROMCAPTURE" } else { "WDA_NONE" },
                e.message(),
                hr as u32,
                hr & 0xffff,
                owner_thread,
                this_thread,
                os_build(),
                now
            );
            tracing::warn!("live glass: {msg}");
            Err(msg)
        }
    }
}

pub fn window_visible(h: HWND) -> bool {
    unsafe { IsWindowVisible(h).as_bool() && !IsIconic(h).as_bool() }
}

/// A full-screen game, video or presentation is in front.
pub fn fullscreen_app_running() -> bool {
    match unsafe { SHQueryUserNotificationState() } {
        Ok(state) => state == QUNS_BUSY || state == QUNS_RUNNING_D3D_FULL_SCREEN || state == QUNS_PRESENTATION_MODE,
        Err(_) => false,
    }
}

pub fn battery_saver_on() -> bool {
    let mut status = SYSTEM_POWER_STATUS::default();
    match unsafe { GetSystemPowerStatus(&mut status as *mut SYSTEM_POWER_STATUS) } {
        Ok(()) => status.SystemStatusFlag == 1,
        Err(_) => false,
    }
}

/// The lock screen (or UAC's secure desktop) owns input: the capture would only be black.
pub fn session_locked() -> bool {
    unsafe {
        match OpenInputDesktop(DESKTOP_CONTROL_FLAGS(0), false, DESKTOP_SWITCHDESKTOP) {
            Ok(desk) => {
                let switched = SwitchDesktop(desk).is_ok();
                let _ = CloseDesktop(desk);
                !switched
            }
            Err(_) => true,
        }
    }
}

/// Where to capture and how big the output is.
#[derive(Clone, Copy, Debug)]
pub struct Geometry {
    /// Screen rectangle in physical px, clamped to the dock's monitor.
    pub src: RECT,
    pub monitor: RECT,
    /// Physical px per CSS px.
    pub scale: f64,
    pub out_w: i32,
    pub out_h: i32,
    /// The captured area in client CSS px: left, top, right, bottom.
    pub css: [f32; 4],
}

fn window_rect(h: HWND) -> Option<RECT> {
    let mut r = RECT::default();
    unsafe { GetWindowRect(h, &mut r as *mut RECT) }.ok()?;
    Some(r)
}

fn monitor_rect(h: HWND) -> Option<RECT> {
    unsafe {
        let mon = MonitorFromWindow(h, MONITOR_DEFAULTTONEAREST);
        if mon.is_invalid() {
            return None;
        }
        let mut info = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
        if !GetMonitorInfoW(mon, &mut info as *mut MONITORINFO).as_bool() {
            return None;
        }
        Some(info.rcMonitor)
    }
}

pub fn geometry(h: HWND, cfg: &GlassConfig) -> Option<Geometry> {
    let win = window_rect(h)?;
    let monitor = monitor_rect(h)?;
    let dpi = unsafe { GetDpiForWindow(h) };
    let scale = if dpi == 0 { 1.0 } else { dpi as f64 / 96.0 };
    let r = cfg.rect;
    let m = cfg.margin;
    let left = ((win.left as f64 + (r.x - m) * scale).floor() as i32).max(monitor.left);
    let top = ((win.top as f64 + (r.y - m) * scale).floor() as i32).max(monitor.top);
    let right = ((win.left as f64 + (r.x + r.width + m) * scale).ceil() as i32).min(monitor.right);
    let bottom = ((win.top as f64 + (r.y + r.height + m) * scale).ceil() as i32).min(monitor.bottom);
    if right - left < 2 || bottom - top < 2 {
        return None;
    }
    let out_w = (((right - left) as f64 / scale) * cfg.scale).round().clamp(1.0, 2048.0) as i32;
    let out_h = (((bottom - top) as f64 / scale) * cfg.scale).round().clamp(1.0, 512.0) as i32;
    let css = [
        ((left - win.left) as f64 / scale) as f32,
        ((top - win.top) as f64 / scale) as f32,
        ((right - win.left) as f64 / scale) as f32,
        ((bottom - win.top) as f64 / scale) as f32,
    ];
    Some(Geometry { src: RECT { left, top, right, bottom }, monitor, scale, out_w, out_h, css })
}

/// A 32-bit top-down DIB the screen is stretched into. Lives on the glass thread only.
pub struct Capturer {
    screen: HDC,
    mem: HDC,
    bitmap: HBITMAP,
    old: HGDIOBJ,
    bits: *mut c_void,
    pub width: i32,
    pub height: i32,
}

impl Capturer {
    pub fn new(width: i32, height: i32) -> Option<Capturer> {
        if width <= 0 || height <= 0 {
            return None;
        }
        unsafe {
            let screen = GetDC(None);
            if screen.is_invalid() {
                return None;
            }
            let mem = CreateCompatibleDC(Some(screen));
            if mem.is_invalid() {
                ReleaseDC(None, screen);
                return None;
            }
            let mut info = BITMAPINFO::default();
            info.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
            info.bmiHeader.biWidth = width;
            info.bmiHeader.biHeight = -height; // negative = top-down rows
            info.bmiHeader.biPlanes = 1;
            info.bmiHeader.biBitCount = 32;
            info.bmiHeader.biCompression = BI_RGB.0;
            let mut bits: *mut c_void = std::ptr::null_mut();
            let bitmap = match CreateDIBSection(
                Some(screen),
                &info as *const BITMAPINFO,
                DIB_RGB_COLORS,
                &mut bits as *mut *mut c_void,
                None,
                0,
            ) {
                Ok(b) => b,
                Err(e) => {
                    tracing::warn!("CreateDIBSection failed: {e}");
                    let _ = DeleteDC(mem);
                    ReleaseDC(None, screen);
                    return None;
                }
            };
            if bits.is_null() {
                let _ = DeleteObject(bitmap.into());
                let _ = DeleteDC(mem);
                ReleaseDC(None, screen);
                return None;
            }
            let old = SelectObject(mem, bitmap.into());
            SetStretchBltMode(mem, HALFTONE);
            let _ = SetBrushOrgEx(mem, 0, 0, None);
            Some(Capturer { screen, mem, bitmap, old, bits, width, height })
        }
    }

    /// Copies `src` (physical screen px) into the bitmap, scaled to width × height.
    pub fn grab(&mut self, src: RECT) -> bool {
        unsafe {
            let ok = StretchBlt(
                self.mem,
                0,
                0,
                self.width,
                self.height,
                Some(self.screen),
                src.left,
                src.top,
                src.right - src.left,
                src.bottom - src.top,
                SRCCOPY,
            )
            .as_bool();
            let _ = GdiFlush();
            ok
        }
    }

    /// BGRA rows, top first.
    pub fn pixels(&self) -> &[u8] {
        let len = (self.width as usize) * (self.height as usize) * 4;
        unsafe { std::slice::from_raw_parts(self.bits as *const u8, len) }
    }
}

impl Drop for Capturer {
    fn drop(&mut self) {
        unsafe {
            let _ = SelectObject(self.mem, self.old);
            let _ = DeleteObject(self.bitmap.into());
            let _ = DeleteDC(self.mem);
            ReleaseDC(None, self.screen);
        }
    }
}
