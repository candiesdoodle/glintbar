//! Small Win32 helpers for the apps service: COM, wide strings, shell items, images, caches.

use std::ffi::c_void;
use std::path::PathBuf;

use base64::Engine;
use windows::core::{Interface, GUID, HSTRING, PWSTR};
use windows::Win32::Foundation::PROPERTYKEY;
use windows::Win32::Graphics::Gdi::{
    GetDC, GetDIBits, GetObjectW, ReleaseDC, BITMAP, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HBITMAP,
    HGDIOBJ,
};
use windows::Win32::System::Com::StructuredStorage::{PropVariantClear, PropVariantToBSTR};
use windows::Win32::System::Com::{CoInitializeEx, CoTaskMemFree, COINIT_MULTITHREADED};
use windows::Win32::UI::Shell::PropertiesSystem::IPropertyStore;
use windows::Win32::UI::Shell::{
    IEnumShellItems, IShellItem, IShellItem2, SHCreateItemFromParsingName, SHGetKnownFolderPath, BHID_EnumItems,
    KF_FLAG_DEFAULT, SIGDN, SIGDN_FILESYSPATH, SIGDN_NORMALDISPLAY, SIGDN_PARENTRELATIVEPARSING,
};

/// System.AppUserModel.ID
pub const PKEY_APP_USER_MODEL_ID: PROPERTYKEY =
    PROPERTYKEY { fmtid: GUID::from_u128(0x9F4C2855_9F79_4B39_A8D0_E1D42DE1D5F3), pid: 5 };
/// System.Title
pub const PKEY_TITLE: PROPERTYKEY = PROPERTYKEY { fmtid: GUID::from_u128(0xF29F85E0_4FF9_1068_AB91_08002B27B3D9), pid: 2 };
/// System.Link.TargetParsingPath
pub const PKEY_LINK_TARGET_PARSING_PATH: PROPERTYKEY =
    PROPERTYKEY { fmtid: GUID::from_u128(0xB9B4B3FC_2B51_4A42_B5D8_324146AFCF25), pid: 2 };

/// Shell objects need COM on the calling thread; repeat calls are harmless (S_FALSE, or
/// RPC_E_CHANGED_MODE on a thread that already chose another model, which still works).
pub fn com_init() {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    }
}

pub fn wide_to_string(buf: &[u16]) -> String {
    let len = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    String::from_utf16_lossy(&buf[..len])
}

/// "a\0b\0\0", the list format SHFileOperationW wants.
pub fn double_null_list(paths: &[String]) -> Vec<u16> {
    let mut out: Vec<u16> = Vec::new();
    for p in paths {
        out.extend(p.encode_utf16());
        out.push(0);
    }
    out.push(0);
    out
}

/// Takes a CoTaskMem string from the shell, frees it and returns its text.
pub fn take_pwstr(p: PWSTR) -> Option<String> {
    if p.is_null() {
        return None;
    }
    let text = unsafe { p.to_string() }.ok();
    unsafe { CoTaskMemFree(Some(p.0 as *const c_void)) };
    text.map(|t| t.trim().to_string()).filter(|t| !t.is_empty())
}

pub fn prop_string(store: &IPropertyStore, key: &PROPERTYKEY) -> Option<String> {
    unsafe {
        let mut value = store.GetValue(key).ok()?;
        let text = PropVariantToBSTR(&value).ok().map(|b| b.to_string());
        let _ = PropVariantClear(&mut value);
        text.map(|t| t.trim().to_string()).filter(|t| !t.is_empty())
    }
}

pub fn shell_item(parsing: &str) -> Option<IShellItem> {
    unsafe { SHCreateItemFromParsingName(&HSTRING::from(parsing), None).ok() }
}

pub fn item_name(item: &IShellItem, kind: SIGDN) -> Option<String> {
    unsafe {
        let p = item.GetDisplayName(kind).ok()?;
        take_pwstr(p)
    }
}

pub fn item_prop(item: &IShellItem, key: &PROPERTYKEY) -> Option<String> {
    unsafe {
        let item2: IShellItem2 = item.cast().ok()?;
        let p = item2.GetString(key).ok()?;
        take_pwstr(p)
    }
}

/// A shell folder's children: (display name, parent-relative parsing name, file-system path, item).
pub struct ShellChild {
    pub name: String,
    pub parsing: String,
    pub path: Option<String>,
    pub item: IShellItem,
}

pub fn shell_children(folder: &str, limit: usize) -> Vec<ShellChild> {
    let mut out: Vec<ShellChild> = Vec::new();
    let Some(parent) = shell_item(folder) else {
        return out;
    };
    unsafe {
        let Ok(list) = parent.BindToHandler::<_, IEnumShellItems>(None, &BHID_EnumItems) else {
            return out;
        };
        while out.len() < limit {
            let mut batch: [Option<IShellItem>; 1] = [None];
            let mut fetched: u32 = 0;
            if list.Next(&mut batch, Some(&mut fetched as *mut u32)).is_err() || fetched == 0 {
                break;
            }
            let Some(item) = batch[0].take() else {
                break;
            };
            let name = item_name(&item, SIGDN_NORMALDISPLAY).unwrap_or_default();
            let parsing = item_name(&item, SIGDN_PARENTRELATIVEPARSING).unwrap_or_default();
            if name.is_empty() || parsing.is_empty() {
                continue;
            }
            let path = item_name(&item, SIGDN_FILESYSPATH);
            out.push(ShellChild { name, parsing, path, item });
        }
    }
    out
}

pub fn known_folder(id: &GUID) -> Option<String> {
    unsafe {
        let p = SHGetKnownFolderPath(id, KF_FLAG_DEFAULT, None).ok()?;
        take_pwstr(p)
    }
}

/// "{6D809377-...}\\Mozilla Firefox\\firefox.exe" -> "C:\\Program Files\\Mozilla Firefox\\firefox.exe".
pub fn expand_known_folder_path(s: &str) -> Option<String> {
    let (guid, rest) = super::model::split_known_folder(s)?;
    let id = GUID::try_from(guid.as_str()).ok()?;
    let base = known_folder(&id)?;
    Some(if rest.is_empty() { base } else { format!("{base}\\{rest}") })
}

pub fn fnv1a(text: &str) -> u64 {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in text.as_bytes() {
        h ^= *b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    h
}

pub fn data_url(mime: &str, bytes: &[u8]) -> String {
    format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes))
}

/// %APPDATA%\\GlintBar\\<name>, created on first use.
pub fn cache_dir(name: &str) -> PathBuf {
    let dir = crate::paths::data_dir().join(name);
    let _ = std::fs::create_dir_all(&dir);
    dir
}

pub fn encode_png(width: u32, height: u32, rgba: Vec<u8>) -> Option<Vec<u8>> {
    let img = image::RgbaImage::from_raw(width, height, rgba)?;
    let mut out = std::io::Cursor::new(Vec::new());
    img.write_to(&mut out, image::ImageFormat::Png).ok()?;
    Some(out.into_inner())
}

pub fn encode_jpeg(width: u32, height: u32, rgb: Vec<u8>, quality: u8) -> Option<Vec<u8>> {
    let img = image::RgbImage::from_raw(width, height, rgb)?;
    let mut out: Vec<u8> = Vec::new();
    {
        let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, quality);
        encoder.encode_image(&img).ok()?;
    }
    Some(out)
}

/// Scales RGB pixels down to fit `max_w` x `max_h` (never up).
pub fn shrink_rgb(width: u32, height: u32, rgb: Vec<u8>, max_w: u32, max_h: u32) -> Option<(u32, u32, Vec<u8>)> {
    let img = image::RgbImage::from_raw(width, height, rgb)?;
    let scale = (max_w as f64 / width as f64).min(max_h as f64 / height as f64).min(1.0);
    if scale >= 0.999 {
        return Some((width, height, img.into_raw()));
    }
    let w = ((width as f64 * scale).round() as u32).max(1);
    let h = ((height as f64 * scale).round() as u32).max(1);
    let small = image::imageops::resize(&img, w, h, image::imageops::FilterType::Triangle);
    Some((w, h, small.into_raw()))
}

/// Scales straight RGBA pixels to exactly `size` on the longer side (never up).
pub fn shrink_rgba(width: u32, height: u32, rgba: Vec<u8>, size: u32) -> Option<(u32, u32, Vec<u8>)> {
    let img = image::RgbaImage::from_raw(width, height, rgba)?;
    let longer = width.max(height);
    if longer <= size {
        return Some((width, height, img.into_raw()));
    }
    let scale = size as f64 / longer as f64;
    let w = ((width as f64 * scale).round() as u32).max(1);
    let h = ((height as f64 * scale).round() as u32).max(1);
    let small = image::imageops::resize(&img, w, h, image::imageops::FilterType::Triangle);
    Some((w, h, small.into_raw()))
}

/// A GDI bitmap's pixels as top-down BGRA.
pub fn bitmap_bgra(bitmap: HBITMAP) -> Option<(u32, u32, Vec<u8>)> {
    let mut header = BITMAP::default();
    let got = unsafe {
        GetObjectW(
            HGDIOBJ(bitmap.0),
            std::mem::size_of::<BITMAP>() as i32,
            Some(&mut header as *mut BITMAP as *mut c_void),
        )
    };
    let width = header.bmWidth;
    let height = header.bmHeight.abs();
    if got == 0 || width <= 0 || height <= 0 || width > 16384 || height > 16384 {
        return None;
    }
    let mut info = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: width,
            biHeight: -height,
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..Default::default()
        },
        ..Default::default()
    };
    let mut pixels: Vec<u8> = vec![0u8; width as usize * height as usize * 4];
    let rows = unsafe {
        let dc = GetDC(None);
        let rows = GetDIBits(
            dc,
            bitmap,
            0,
            height as u32,
            Some(pixels.as_mut_ptr() as *mut c_void),
            &mut info as *mut BITMAPINFO,
            DIB_RGB_COLORS,
        );
        ReleaseDC(None, dc);
        rows
    };
    if rows == 0 {
        return None;
    }
    Some((width as u32, height as u32, pixels))
}

/// Premultiplied (or alpha-less) BGRA to straight RGBA.
pub fn bgra_to_rgba(mut px: Vec<u8>) -> Vec<u8> {
    let has_alpha = px.chunks_exact(4).any(|p| p[3] != 0);
    for p in px.chunks_exact_mut(4) {
        p.swap(0, 2);
        if !has_alpha {
            p[3] = 255;
        } else if p[3] > 0 && p[3] < 255 {
            let a = p[3] as u32;
            for c in p[..3].iter_mut() {
                *c = ((*c as u32 * 255 + a / 2) / a).min(255) as u8;
            }
        }
    }
    px
}

/// BGRA to RGB (alpha dropped).
pub fn bgra_to_rgb(px: &[u8]) -> Vec<u8> {
    let mut out: Vec<u8> = Vec::with_capacity(px.len() / 4 * 3);
    for p in px.chunks_exact(4) {
        out.push(p[2]);
        out.push(p[1]);
        out.push(p[0]);
    }
    out
}
