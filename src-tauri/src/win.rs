//! Small Win32 helpers shared by several slices. Slices may call these; add new helpers in
//! your own slice folder instead of editing this file.

use std::ffi::c_void;

use windows::core::HSTRING;
use windows::Win32::Foundation::ERROR_SUCCESS;
use windows::Win32::System::Registry::{RegGetValueW, HKEY, RRF_RT_REG_DWORD, RRF_RT_REG_SZ};

/// Reads a REG_SZ value, e.g. `reg_string(HKEY_LOCAL_MACHINE, r"HARDWARE\DESCRIPTION\System\CentralProcessor\0", "ProcessorNameString")`.
pub fn reg_string(root: HKEY, subkey: &str, value: &str) -> Option<String> {
    let subkey = HSTRING::from(subkey);
    let value = HSTRING::from(value);
    let mut size: u32 = 0;
    unsafe {
        let first = RegGetValueW(root, &subkey, &value, RRF_RT_REG_SZ, None, None, Some(&mut size as *mut u32));
        if first != ERROR_SUCCESS || size == 0 {
            return None;
        }
        let mut buf: Vec<u16> = vec![0u16; (size as usize) / 2 + 1];
        size = (buf.len() * 2) as u32;
        let second = RegGetValueW(
            root,
            &subkey,
            &value,
            RRF_RT_REG_SZ,
            None,
            Some(buf.as_mut_ptr() as *mut c_void),
            Some(&mut size as *mut u32),
        );
        if second != ERROR_SUCCESS {
            return None;
        }
        let len = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
        Some(String::from_utf16_lossy(&buf[..len]).trim().to_string())
    }
}

/// Reads a REG_DWORD value.
pub fn reg_dword(root: HKEY, subkey: &str, value: &str) -> Option<u32> {
    let subkey = HSTRING::from(subkey);
    let value = HSTRING::from(value);
    let mut data: u32 = 0;
    let mut size: u32 = std::mem::size_of::<u32>() as u32;
    let result = unsafe {
        RegGetValueW(
            root,
            &subkey,
            &value,
            RRF_RT_REG_DWORD,
            None,
            Some(&mut data as *mut u32 as *mut c_void),
            Some(&mut size as *mut u32),
        )
    };
    if result == ERROR_SUCCESS {
        Some(data)
    } else {
        None
    }
}
