//! Screenshots: the screen under the pointer, or the window in front, saved as PNG and/or put
//! on the clipboard. A region uses Windows' own snipping overlay (ms-screenclip:).

use std::ffi::c_void;
use std::path::PathBuf;

use serde::Deserialize;
use tauri::{AppHandle, Manager};
use windows::Win32::Foundation::{GlobalFree, HANDLE, POINT, RECT};
use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_EXTENDED_FRAME_BOUNDS};
use windows::Win32::Graphics::Gdi::{
    BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC, GetMonitorInfoW,
    MonitorFromPoint, ReleaseDC, SelectObject, BITMAPINFOHEADER, BI_RGB, CAPTUREBLT, HGDIOBJ, MONITORINFO,
    MONITOR_DEFAULTTONEAREST, SRCCOPY,
};
use windows::Win32::System::DataExchange::{CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData};
use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};
use windows::Win32::System::Ole::CF_DIB;
use windows::Win32::UI::Shell::{FOLDERID_Pictures, FOLDERID_Screenshots};
use windows::Win32::UI::WindowsAndMessaging::{GetCursorPos, GetForegroundWindow, GetWindowThreadProcessId, IsIconic};

use super::model::Capture;
use super::util::{bgra_to_rgb, bitmap_bgra, data_url, encode_jpeg, encode_png, known_folder, shrink_rgb};
use crate::error::{SvcError, SvcResult};
use crate::services::core::fs::expand;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureArgs {
    /// "screen" or "window".
    #[serde(default = "screen")]
    pub mode: String,
    #[serde(default)]
    pub folder: Option<String>,
    #[serde(default = "yes")]
    pub save: bool,
    #[serde(default = "yes")]
    pub clipboard: bool,
    #[serde(default)]
    pub delay_ms: u64,
}

fn screen() -> String {
    "screen".into()
}

fn yes() -> bool {
    true
}

fn monitor_under_cursor() -> RECT {
    unsafe {
        let mut pt = POINT::default();
        let _ = GetCursorPos(&mut pt as *mut POINT);
        let monitor = MonitorFromPoint(pt, MONITOR_DEFAULTTONEAREST);
        let mut info = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
        if GetMonitorInfoW(monitor, &mut info as *mut MONITORINFO).as_bool() {
            info.rcMonitor
        } else {
            RECT { left: 0, top: 0, right: 1920, bottom: 1080 }
        }
    }
}

/// The front window's visible frame, unless it is ours, minimized or the desktop.
fn front_window_rect() -> Option<RECT> {
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.is_invalid() || IsIconic(hwnd).as_bool() {
            return None;
        }
        let mut pid: u32 = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut pid as *mut u32));
        if pid == std::process::id() {
            return None;
        }
        let mut rect = RECT::default();
        DwmGetWindowAttribute(
            hwnd,
            DWMWA_EXTENDED_FRAME_BOUNDS,
            &mut rect as *mut RECT as *mut c_void,
            std::mem::size_of::<RECT>() as u32,
        )
        .ok()?;
        if rect.right - rect.left < 8 || rect.bottom - rect.top < 8 {
            return None;
        }
        Some(rect)
    }
}

/// Copies a rectangle of the screen as top-down BGRA.
fn grab(rect: RECT) -> SvcResult<(u32, u32, Vec<u8>)> {
    let w = rect.right - rect.left;
    let h = rect.bottom - rect.top;
    if w <= 0 || h <= 0 || w > 16384 || h > 16384 {
        return Err(SvcError::bad_args("found no screen area to capture"));
    }
    unsafe {
        let screen = GetDC(None);
        let mem = CreateCompatibleDC(Some(screen));
        let bitmap = CreateCompatibleBitmap(screen, w, h);
        let old = SelectObject(mem, HGDIOBJ(bitmap.0));
        let copied = BitBlt(mem, 0, 0, w, h, Some(screen), rect.left, rect.top, SRCCOPY | CAPTUREBLT);
        SelectObject(mem, old);
        let _ = DeleteDC(mem);
        ReleaseDC(None, screen);
        let pixels = if copied.is_ok() { bitmap_bgra(bitmap) } else { None };
        let _ = DeleteObject(HGDIOBJ(bitmap.0));
        pixels.ok_or_else(|| SvcError::Internal("reading the screen pixels failed".into()))
    }
}

fn target_folder(custom: Option<&str>) -> PathBuf {
    if let Some(dir) = custom.map(|d| d.trim()).filter(|d| !d.is_empty()) {
        return PathBuf::from(expand(dir));
    }
    if let Some(dir) = known_folder(&FOLDERID_Screenshots) {
        return PathBuf::from(dir);
    }
    match known_folder(&FOLDERID_Pictures) {
        Some(p) => PathBuf::from(p).join("Screenshots"),
        None => crate::paths::data_dir().join("Screenshots"),
    }
}

fn save_png(folder: &PathBuf, w: u32, h: u32, bgra: &[u8]) -> SvcResult<String> {
    std::fs::create_dir_all(folder)?;
    let stamp = chrono::Local::now().format("Screenshot %Y-%m-%d %H%M%S").to_string();
    let mut path = folder.join(format!("{stamp}.png"));
    let mut n = 2;
    while path.exists() && n < 100 {
        path = folder.join(format!("{stamp} ({n}).png"));
        n += 1;
    }
    let mut rgba: Vec<u8> = Vec::with_capacity(bgra.len());
    for p in bgra.chunks_exact(4) {
        rgba.extend_from_slice(&[p[2], p[1], p[0], 255]);
    }
    let png = encode_png(w, h, rgba).ok_or_else(|| SvcError::Internal("saving the screenshot as PNG failed".into()))?;
    std::fs::write(&path, png)?;
    Ok(path.to_string_lossy().into_owned())
}

/// Puts the picture on the clipboard as a device-independent bitmap.
fn copy_to_clipboard(app: &AppHandle, w: u32, h: u32, bgra: &[u8]) -> SvcResult<()> {
    let owner = app.get_webview_window("main").and_then(|win| win.hwnd().ok());
    let header = BITMAPINFOHEADER {
        biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
        biWidth: w as i32,
        biHeight: h as i32, // bottom-up rows
        biPlanes: 1,
        biBitCount: 32,
        biCompression: BI_RGB.0,
        biSizeImage: w * h * 4,
        ..Default::default()
    };
    let header_size = std::mem::size_of::<BITMAPINFOHEADER>();
    let row = (w * 4) as usize;
    let total = header_size + row * h as usize;
    unsafe {
        OpenClipboard(owner).map_err(|e| SvcError::Io(format!("another app is holding the clipboard: {e}")))?;
        let result = (|| -> SvcResult<()> {
            EmptyClipboard()?;
            let mem = GlobalAlloc(GMEM_MOVEABLE, total)?;
            let ptr = GlobalLock(mem) as *mut u8;
            if ptr.is_null() {
                let _ = GlobalFree(Some(mem));
                return Err(SvcError::Internal("not enough memory to copy the image".into()));
            }
            std::ptr::copy_nonoverlapping(&header as *const BITMAPINFOHEADER as *const u8, ptr, header_size);
            for y in 0..h as usize {
                let src = &bgra[(h as usize - 1 - y) * row..(h as usize - y) * row];
                std::ptr::copy_nonoverlapping(src.as_ptr(), ptr.add(header_size + y * row), row);
            }
            let _ = GlobalUnlock(mem);
            // On success the clipboard owns the memory; on failure it is still ours to free.
            if let Err(e) = SetClipboardData(CF_DIB.0 as u32, Some(HANDLE(mem.0))) {
                let _ = GlobalFree(Some(mem));
                return Err(SvcError::from(e));
            }
            Ok(())
        })();
        let _ = CloseClipboard();
        result
    }
}

pub fn capture(app: &AppHandle, a: CaptureArgs) -> SvcResult<Capture> {
    if a.delay_ms > 0 {
        std::thread::sleep(std::time::Duration::from_millis(a.delay_ms.min(10_000)));
    }
    let rect = if a.mode == "window" { front_window_rect().unwrap_or_else(monitor_under_cursor) } else { monitor_under_cursor() };
    let (w, h, bgra) = grab(rect)?;
    let path = if a.save { Some(save_png(&target_folder(a.folder.as_deref()), w, h, &bgra)?) } else { None };
    let copied = if a.clipboard { copy_to_clipboard(app, w, h, &bgra).is_ok() } else { false };
    let thumb = shrink_rgb(w, h, bgra_to_rgb(&bgra), 360, 220)
        .and_then(|(tw, th, rgb)| encode_jpeg(tw, th, rgb, 80))
        .map(|jpeg| data_url("image/jpeg", &jpeg));
    Ok(Capture { path, width: w, height: h, copied, thumb })
}
