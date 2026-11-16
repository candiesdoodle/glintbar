//! The wallpaper tier of the glass: when the screen behind the dock can't be captured (Windows 10
//! before 2004, or the user chose it), the desktop picture is placed the way Windows places it
//! (fill, fit, stretch, centre, tile, span) and the part under the dock is sent instead.
//!
//! The decoded picture is cached at the output resolution of the whole monitor (about 1/4 of the
//! pixels of a full-size copy), so moving or resizing the dock only crops; the file is decoded
//! again only when its path, timestamp or placement changes, or after the PC is unlocked.

use std::ffi::c_void;
use std::time::SystemTime;

use image::imageops::{self, FilterType};
use image::{Rgb, RgbImage};
use serde::Serialize;
use windows::Win32::System::Registry::HKEY_CURRENT_USER;
use windows::Win32::UI::WindowsAndMessaging::{
    SystemParametersInfoW, SPI_GETDESKWALLPAPER, SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS,
};

use super::capture::Geometry;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Placement {
    Fill,
    Fit,
    Stretch,
    Center,
    Tile,
    Span,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WallpaperInfo {
    pub path: Option<String>,
    pub placement: Placement,
    pub background: String,
}

/// The current wallpaper file ("" when the desktop is a solid colour).
pub fn wallpaper_path() -> String {
    let mut buf = [0u16; 1024];
    let ok = unsafe {
        SystemParametersInfoW(
            SPI_GETDESKWALLPAPER,
            buf.len() as u32,
            Some(buf.as_mut_ptr() as *mut c_void),
            SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS(0),
        )
    };
    if ok.is_err() {
        return String::new();
    }
    let len = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    String::from_utf16_lossy(&buf[..len]).trim().to_string()
}

pub fn placement() -> Placement {
    let desk = r"Control Panel\Desktop";
    let style = crate::win::reg_string(HKEY_CURRENT_USER, desk, "WallpaperStyle").unwrap_or_default();
    let tile = crate::win::reg_string(HKEY_CURRENT_USER, desk, "TileWallpaper").unwrap_or_default();
    match style.trim() {
        "0" if tile.trim() == "1" => Placement::Tile,
        "0" => Placement::Center,
        "2" => Placement::Stretch,
        "6" => Placement::Fit,
        "22" => Placement::Span,
        _ => Placement::Fill,
    }
}

/// The desktop background colour ("r g b" in the registry), shown around fit/centre pictures.
pub fn background() -> Rgb<u8> {
    let raw = crate::win::reg_string(HKEY_CURRENT_USER, r"Control Panel\Colors", "Background").unwrap_or_default();
    let parts: Vec<u8> = raw.split_whitespace().filter_map(|p| p.parse::<u8>().ok()).collect();
    if parts.len() == 3 {
        Rgb([parts[0], parts[1], parts[2]])
    } else {
        Rgb([0, 0, 0])
    }
}

pub fn info() -> WallpaperInfo {
    let path = wallpaper_path();
    let bg = background();
    WallpaperInfo {
        path: if path.is_empty() { None } else { Some(path) },
        placement: placement(),
        background: format!("#{:02x}{:02x}{:02x}", bg.0[0], bg.0[1], bg.0[2]),
    }
}

fn load(path: &str) -> Option<RgbImage> {
    let reader = match image::ImageReader::open(path) {
        Ok(r) => r,
        Err(e) => {
            tracing::debug!("wallpaper open failed: {e}");
            return None;
        }
    };
    let reader = reader.with_guessed_format().ok()?;
    match reader.decode() {
        Ok(img) => Some(img.to_rgb8()),
        Err(e) => {
            tracing::debug!("wallpaper decode failed: {e}");
            None
        }
    }
}

fn scaled(img: &RgbImage, w: f64, h: f64) -> RgbImage {
    let w = (w.round() as u32).max(1);
    let h = (h.round() as u32).max(1);
    imageops::resize(img, w, h, FilterType::Triangle)
}

/// The whole monitor as Windows shows it, `cw` × `ch` px, `factor` output px per physical px.
fn compose(img: Option<RgbImage>, place: Placement, cw: u32, ch: u32, factor: f64, bg: Rgb<u8>) -> RgbImage {
    let img = match img {
        Some(i) if i.width() > 0 && i.height() > 0 => i,
        _ => return RgbImage::from_pixel(cw, ch, bg),
    };
    let (iw, ih) = (img.width() as f64, img.height() as f64);
    let (fw, fh) = (cw as f64, ch as f64);
    match place {
        Placement::Fill | Placement::Span => {
            let s = (fw / iw).max(fh / ih);
            let big = scaled(&img, iw * s, ih * s);
            let x = big.width().saturating_sub(cw) / 2;
            let y = big.height().saturating_sub(ch) / 2;
            let cropped = imageops::crop_imm(&big, x, y, cw, ch).to_image();
            if cropped.width() == cw && cropped.height() == ch {
                cropped
            } else {
                imageops::resize(&cropped, cw, ch, FilterType::Triangle)
            }
        }
        Placement::Stretch => imageops::resize(&img, cw, ch, FilterType::Triangle),
        Placement::Fit => {
            let s = (fw / iw).min(fh / ih);
            let small = scaled(&img, iw * s, ih * s);
            let mut canvas = RgbImage::from_pixel(cw, ch, bg);
            let x = (cw as i64 - small.width() as i64) / 2;
            let y = (ch as i64 - small.height() as i64) / 2;
            imageops::overlay(&mut canvas, &small, x, y);
            canvas
        }
        Placement::Center => {
            let small = scaled(&img, iw * factor, ih * factor);
            let mut canvas = RgbImage::from_pixel(cw, ch, bg);
            let x = (cw as i64 - small.width() as i64) / 2;
            let y = (ch as i64 - small.height() as i64) / 2;
            imageops::overlay(&mut canvas, &small, x, y);
            canvas
        }
        Placement::Tile => {
            let small = scaled(&img, iw * factor, ih * factor);
            let mut canvas = RgbImage::from_pixel(cw, ch, bg);
            imageops::tile(&mut canvas, &small);
            canvas
        }
    }
}

#[derive(Default)]
pub struct WallpaperCache {
    key: String,
    image: Option<RgbImage>,
    strip_key: String,
}

impl WallpaperCache {
    /// Forget everything (after an unlock the picture may have changed under the same name).
    pub fn invalidate(&mut self) {
        self.key.clear();
        self.strip_key.clear();
        self.image = None;
    }

    /// The RGB strip under the dock (`geo.out_w` × `geo.out_h`) and whether it differs from the
    /// last one returned. `out_per_css` = output px per CSS px (the glass `scale`).
    pub fn strip(&mut self, geo: &Geometry, out_per_css: f64) -> Option<(Vec<u8>, bool)> {
        let path = wallpaper_path();
        let modified: Option<SystemTime> =
            if path.is_empty() { None } else { std::fs::metadata(&path).and_then(|m| m.modified()).ok() };
        let place = placement();
        let bg = background();
        let mon_w = (geo.monitor.right - geo.monitor.left).max(1);
        let mon_h = (geo.monitor.bottom - geo.monitor.top).max(1);
        let factor = out_per_css / geo.scale.max(0.1);
        let cw = ((mon_w as f64 * factor).round() as u32).max(1);
        let ch = ((mon_h as f64 * factor).round() as u32).max(1);
        let key = format!("{path}|{modified:?}|{place:?}|{:?}|{cw}x{ch}", bg.0);
        let mut changed = false;
        if key != self.key || self.image.is_none() {
            let loaded = if path.is_empty() { None } else { load(&path) };
            if !path.is_empty() && loaded.is_none() {
                // Unreadable (e.g. a format we can't decode): let the UI fall back to plain glass.
                self.key = key;
                self.image = None;
                return None;
            }
            self.image = Some(compose(loaded, place, cw, ch, factor, bg));
            self.key = key;
            changed = true;
        }
        let img = self.image.as_ref()?;
        let x = (((geo.src.left - geo.monitor.left) as f64) * factor).round().max(0.0) as u32;
        let y = (((geo.src.top - geo.monitor.top) as f64) * factor).round().max(0.0) as u32;
        let w = (geo.out_w.max(1)) as u32;
        let h = (geo.out_h.max(1)) as u32;
        let strip_key = format!("{x},{y},{w},{h}");
        if strip_key != self.strip_key {
            self.strip_key = strip_key;
            changed = true;
        }
        let mut part = imageops::crop_imm(img, x, y, w, h).to_image();
        if part.width() != w || part.height() != h {
            part = imageops::resize(&part, w, h, FilterType::Triangle);
        }
        Some((part.into_raw(), changed))
    }
}
