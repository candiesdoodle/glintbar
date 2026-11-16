//! HICON -> PNG data URL (for tray icons).

use std::ffi::c_void;

use base64::Engine;
use windows::Win32::Graphics::Gdi::{
    CreateCompatibleDC, DeleteDC, DeleteObject, GetDIBits, GetObjectW, BITMAP, BITMAPINFO, BITMAPINFOHEADER, BI_RGB,
    DIB_RGB_COLORS, HBITMAP, HDC, HGDIOBJ,
};
use windows::Win32::UI::WindowsAndMessaging::{GetIconInfo, HICON, ICONINFO};

fn bits(dc: HDC, bitmap: HBITMAP, w: i32, h: i32) -> Option<Vec<u8>> {
    let mut info = BITMAPINFO::default();
    info.bmiHeader = BITMAPINFOHEADER {
        biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
        biWidth: w,
        // Negative height = top-down rows.
        biHeight: -h,
        biPlanes: 1,
        biBitCount: 32,
        biCompression: BI_RGB.0,
        ..Default::default()
    };
    let mut pixels = vec![0u8; (w as usize) * (h as usize) * 4];
    let lines = unsafe { GetDIBits(dc, bitmap, 0, h as u32, Some(pixels.as_mut_ptr() as *mut c_void), &mut info, DIB_RGB_COLORS) };
    if lines == 0 {
        None
    } else {
        Some(pixels)
    }
}

/// A PNG `data:` URL for the icon, or None when it can't be read (monochrome icons, gone handles).
pub fn to_data_url(icon: HICON) -> Option<String> {
    if icon.is_invalid() {
        return None;
    }
    let mut info = ICONINFO::default();
    unsafe { GetIconInfo(icon, &mut info) }.ok()?;
    let color = info.hbmColor;
    let mask = info.hbmMask;
    let result = encode(color, mask);
    unsafe {
        if !color.is_invalid() {
            let _ = DeleteObject(HGDIOBJ(color.0));
        }
        if !mask.is_invalid() {
            let _ = DeleteObject(HGDIOBJ(mask.0));
        }
    }
    result
}

fn encode(color: HBITMAP, mask: HBITMAP) -> Option<String> {
    if color.is_invalid() {
        return None;
    }
    let mut bm = BITMAP::default();
    let got = unsafe { GetObjectW(HGDIOBJ(color.0), std::mem::size_of::<BITMAP>() as i32, Some(&mut bm as *mut BITMAP as *mut c_void)) };
    if got == 0 {
        return None;
    }
    let (w, h) = (bm.bmWidth, bm.bmHeight);
    if w <= 0 || h <= 0 || w > 256 || h > 256 {
        return None;
    }
    let dc = unsafe { CreateCompatibleDC(None) };
    if dc.0.is_null() {
        return None;
    }
    let mut pixels = bits(dc, color, w, h);
    if let Some(px) = pixels.as_mut() {
        // Old-style icons have no alpha channel: take transparency from the mask instead.
        if !px.chunks(4).any(|p| p[3] != 0) {
            let mask_px = if mask.is_invalid() { None } else { bits(dc, mask, w, h) };
            for (i, p) in px.chunks_mut(4).enumerate() {
                let transparent = mask_px.as_ref().map(|m| m[i * 4] > 127).unwrap_or(false);
                p[3] = if transparent { 0 } else { 255 };
            }
        }
        // BGRA -> RGBA
        for p in px.chunks_mut(4) {
            p.swap(0, 2);
        }
    }
    unsafe {
        let _ = DeleteDC(dc);
    }
    let px = pixels?;
    let img = image::RgbaImage::from_raw(w as u32, h as u32, px)?;
    let mut out = std::io::Cursor::new(Vec::new());
    image::DynamicImage::ImageRgba8(img).write_to(&mut out, image::ImageFormat::Png).ok()?;
    Some(format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(out.into_inner())))
}
