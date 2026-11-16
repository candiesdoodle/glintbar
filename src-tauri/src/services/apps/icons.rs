//! App, file and folder icons (IShellItemImageFactory: Store logos, shortcut and program icons,
//! file thumbnails) as PNG data URLs cached under %APPDATA%\\GlintBar\\icons, and window
//! previews (PrintWindow) as small JPEG data URLs, throttled per window.

use std::collections::HashMap;
use std::ffi::c_void;
use std::path::Path;
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime};

use windows::core::Interface;
use windows::Win32::Foundation::{RECT, SIZE};
use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_EXTENDED_FRAME_BOUNDS};
use windows::Win32::Graphics::Gdi::{
    CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC, ReleaseDC, SelectObject, HGDIOBJ,
};
use windows::Win32::Storage::Xps::{PrintWindow, PRINT_WINDOW_FLAGS};
use windows::Win32::UI::Shell::{IShellItemImageFactory, SIIGBF, SIIGBF_BIGGERSIZEOK, SIIGBF_ICONONLY, SIIGBF_RESIZETOFIT};
use windows::Win32::UI::WindowsAndMessaging::{GetWindowRect, IsHungAppWindow, IsIconic, IsWindow, PW_RENDERFULLCONTENT};

use super::util::{
    bgra_to_rgb, bgra_to_rgba, bitmap_bgra, cache_dir, com_init, data_url, encode_jpeg, encode_png, fnv1a, shell_item,
    shrink_rgb, shrink_rgba,
};
use super::wnd::to_hwnd;
use crate::error::{SvcError, SvcResult};

const ICON_MAX_AGE: Duration = Duration::from_secs(3 * 24 * 3600);
const PREVIEW_FRESH: Duration = Duration::from_millis(1200);

/// IconFile=... from an internet shortcut (.url), e.g. a Steam game's .ico.
fn url_icon_file(path: &str) -> Option<String> {
    let text = std::fs::read(path).ok()?;
    let text = String::from_utf8_lossy(&text);
    for line in text.lines() {
        let line = line.trim();
        if let Some(rest) = line.strip_prefix("IconFile=") {
            let file = rest.trim().trim_matches('"').to_string();
            if !file.is_empty() && Path::new(&file).exists() {
                return Some(file);
            }
        }
    }
    None
}

/// "aumid:<id>" -> the Start entry, "thumb:<path>" -> a thumbnail, a .url -> its icon file.
fn parsing_for(source: &str) -> (String, bool) {
    if let Some(id) = source.strip_prefix("aumid:") {
        return (format!("shell:AppsFolder\\{id}"), false);
    }
    if let Some(path) = source.strip_prefix("thumb:") {
        return (path.to_string(), true);
    }
    if source.to_lowercase().ends_with(".url") {
        if let Some(icon) = url_icon_file(source) {
            return (icon, false);
        }
    }
    (source.to_string(), false)
}

fn extract(source: &str, size: u32) -> Option<Vec<u8>> {
    com_init();
    let (parsing, thumbnail) = parsing_for(source);
    let item = shell_item(&parsing)?;
    unsafe {
        let factory: IShellItemImageFactory = item.cast().ok()?;
        let want = SIZE { cx: size as i32, cy: size as i32 };
        let flags: SIIGBF = if thumbnail { SIIGBF_RESIZETOFIT } else { SIIGBF_ICONONLY | SIIGBF_BIGGERSIZEOK };
        let bitmap = match factory.GetImage(want, flags) {
            Ok(b) => b,
            Err(_) => factory.GetImage(want, SIIGBF_RESIZETOFIT).ok()?,
        };
        let pixels = bitmap_bgra(bitmap);
        let _ = DeleteObject(HGDIOBJ(bitmap.0));
        let (w, h, bgra) = pixels?;
        let (w, h, rgba) = shrink_rgba(w, h, bgra_to_rgba(bgra), size)?;
        encode_png(w, h, rgba)
    }
}

fn modified(path: &Path) -> Option<SystemTime> {
    std::fs::metadata(path).ok().and_then(|m| m.modified().ok())
}

/// The icon for `source` as a PNG data URL, or None when Windows has none.
pub fn icon(source: &str, size: u32) -> SvcResult<Option<String>> {
    let source = source.trim();
    if source.is_empty() {
        return Err(SvcError::bad_args("nothing to take an icon from"));
    }
    let size = size.clamp(16, 256);
    let file = cache_dir("icons").join(format!("{:016x}.png", fnv1a(&format!("{source}|{size}"))));
    if let Some(cached_at) = modified(&file) {
        let young = cached_at.elapsed().map(|age| age < ICON_MAX_AGE).unwrap_or(false);
        let plain = source.strip_prefix("thumb:").unwrap_or(source);
        let source_newer = modified(Path::new(plain)).map(|m| m > cached_at).unwrap_or(false);
        if young && !source_newer {
            if let Ok(bytes) = std::fs::read(&file) {
                return Ok(Some(data_url("image/png", &bytes)));
            }
        }
    }
    match extract(source, size) {
        Some(png) => {
            let _ = std::fs::write(&file, &png);
            Ok(Some(data_url("image/png", &png)))
        }
        None => Ok(None),
    }
}

static PREVIEWS: Mutex<Option<HashMap<i64, (Instant, u32, String)>>> = Mutex::new(None);

fn frame_rect(raw: i64) -> Option<(RECT, RECT)> {
    let hwnd = to_hwnd(raw);
    let mut window = RECT::default();
    let mut frame = RECT::default();
    unsafe {
        GetWindowRect(hwnd, &mut window as *mut RECT).ok()?;
        let got = DwmGetWindowAttribute(
            hwnd,
            DWMWA_EXTENDED_FRAME_BOUNDS,
            &mut frame as *mut RECT as *mut c_void,
            std::mem::size_of::<RECT>() as u32,
        );
        if got.is_err() {
            frame = window;
        }
    }
    Some((window, frame))
}

fn render(raw: i64, max_w: u32) -> Option<String> {
    let hwnd = to_hwnd(raw);
    unsafe {
        if !IsWindow(Some(hwnd)).as_bool() || IsIconic(hwnd).as_bool() || IsHungAppWindow(hwnd).as_bool() {
            return None;
        }
    }
    let (window, frame) = frame_rect(raw)?;
    let w = window.right - window.left;
    let h = window.bottom - window.top;
    if w <= 0 || h <= 0 || w > 10000 || h > 10000 {
        return None;
    }
    let (bgra_w, bgra_h, bgra) = unsafe {
        let screen = GetDC(None);
        let mem = CreateCompatibleDC(Some(screen));
        let bitmap = CreateCompatibleBitmap(screen, w, h);
        let old = SelectObject(mem, HGDIOBJ(bitmap.0));
        let printed = PrintWindow(hwnd, mem, PRINT_WINDOW_FLAGS(PW_RENDERFULLCONTENT)).as_bool();
        SelectObject(mem, old);
        let _ = DeleteDC(mem);
        ReleaseDC(None, screen);
        let pixels = if printed { bitmap_bgra(bitmap) } else { None };
        let _ = DeleteObject(HGDIOBJ(bitmap.0));
        pixels?
    };
    // Crop the invisible resize borders (the frame bounds sit inside the window rect).
    let left = (frame.left - window.left).clamp(0, bgra_w as i32 - 1) as u32;
    let top = (frame.top - window.top).clamp(0, bgra_h as i32 - 1) as u32;
    let cw = ((frame.right - frame.left).max(1) as u32).min(bgra_w - left);
    let ch = ((frame.bottom - frame.top).max(1) as u32).min(bgra_h - top);
    let mut cropped: Vec<u8> = Vec::with_capacity(cw as usize * ch as usize * 4);
    for y in top..top + ch {
        let start = (y as usize * bgra_w as usize + left as usize) * 4;
        cropped.extend_from_slice(&bgra[start..start + cw as usize * 4]);
    }
    let rgb = bgra_to_rgb(&cropped);
    if rgb.iter().all(|b| *b == 0) {
        // GPU-only or protected content: nothing to show.
        return None;
    }
    let (sw, sh, small) = shrink_rgb(cw, ch, rgb, max_w, (max_w * 3) / 4)?;
    let jpeg = encode_jpeg(sw, sh, small, 78)?;
    Some(data_url("image/jpeg", &jpeg))
}

/// A live picture of a window, at most `max_w` wide; None for minimized or hung windows.
pub fn preview(raw: i64, max_w: u32) -> SvcResult<Option<String>> {
    let max_w = max_w.clamp(80, 640);
    {
        let cache = PREVIEWS.lock().unwrap_or_else(|p| p.into_inner());
        if let Some((at, width, url)) = cache.as_ref().and_then(|m| m.get(&raw)) {
            if at.elapsed() < PREVIEW_FRESH && *width == max_w {
                return Ok(Some(url.clone()));
            }
        }
    }
    let shot = render(raw, max_w);
    let mut cache = PREVIEWS.lock().unwrap_or_else(|p| p.into_inner());
    let map = cache.get_or_insert_with(HashMap::new);
    map.retain(|_, (at, _, _)| at.elapsed() < Duration::from_secs(30));
    if let Some(url) = &shot {
        map.insert(raw, (Instant::now(), max_w, url.clone()));
    }
    Ok(shot)
}
