//! Small Win32 helpers used across the system slice.

use std::ffi::c_void;

use windows::core::HSTRING;
use windows::Win32::Foundation::ERROR_SUCCESS;
use windows::Win32::System::Registry::{RegSetKeyValueW, HKEY, REG_DWORD, REG_SZ};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_EXTENDEDKEY, KEYEVENTF_KEYUP,
    VIRTUAL_KEY, VK_LWIN,
};

use crate::error::{SvcError, SvcResult};

/// A UTF-16 buffer up to its first NUL.
pub fn from_wide(buf: &[u16]) -> String {
    let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    String::from_utf16_lossy(&buf[..end])
}

pub fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

fn key_input(vk: VIRTUAL_KEY, up: bool, extended: bool) -> INPUT {
    let mut flags: u32 = 0;
    if up {
        flags |= KEYEVENTF_KEYUP.0;
    }
    if extended {
        flags |= KEYEVENTF_EXTENDEDKEY.0;
    }
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT { wVk: vk, wScan: 0, dwFlags: KEYBD_EVENT_FLAGS(flags), time: 0, dwExtraInfo: 0 },
        },
    }
}

/// Presses a key combination: every key down in order, then up in reverse order.
pub fn send_combo(keys: &[VIRTUAL_KEY]) -> SvcResult<()> {
    let mut inputs: Vec<INPUT> = Vec::with_capacity(keys.len() * 2);
    for k in keys {
        inputs.push(key_input(*k, false, *k == VK_LWIN));
    }
    for k in keys.iter().rev() {
        inputs.push(key_input(*k, true, *k == VK_LWIN));
    }
    let sent = unsafe { SendInput(&inputs, std::mem::size_of::<INPUT>() as i32) };
    if sent as usize == inputs.len() {
        Ok(())
    } else {
        Err(SvcError::Denied("Windows refused the simulated key press".into()))
    }
}

/// Windows + a letter key (e.g. 'N', 'D', 'A', 'P').
pub fn win_plus(letter: char) -> SvcResult<()> {
    send_combo(&[VK_LWIN, VIRTUAL_KEY(letter.to_ascii_uppercase() as u16)])
}

pub fn reg_set_dword(root: HKEY, subkey: &str, name: &str, value: u32) -> SvcResult<()> {
    let data = value.to_le_bytes();
    let status = unsafe {
        RegSetKeyValueW(
            root,
            &HSTRING::from(subkey),
            &HSTRING::from(name),
            REG_DWORD.0,
            Some(data.as_ptr() as *const c_void),
            data.len() as u32,
        )
    };
    if status == ERROR_SUCCESS {
        Ok(())
    } else {
        Err(SvcError::Denied(format!("the setting was not saved (error {})", status.0)))
    }
}

pub fn reg_set_string(root: HKEY, subkey: &str, name: &str, value: &str) -> SvcResult<()> {
    let mut wide: Vec<u16> = value.encode_utf16().collect();
    wide.push(0);
    let status = unsafe {
        RegSetKeyValueW(
            root,
            &HSTRING::from(subkey),
            &HSTRING::from(name),
            REG_SZ.0,
            Some(wide.as_ptr() as *const c_void),
            (wide.len() * 2) as u32,
        )
    };
    if status == ERROR_SUCCESS {
        Ok(())
    } else {
        Err(SvcError::Denied(format!("the setting was not saved (error {})", status.0)))
    }
}

/// The Windows build number (22000+ is Windows 11).
pub fn windows_build() -> u32 {
    use windows::Win32::System::Registry::HKEY_LOCAL_MACHINE;
    crate::win::reg_string(HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows NT\CurrentVersion", "CurrentBuildNumber")
        .and_then(|s| s.trim().parse::<u32>().ok())
        .unwrap_or(0)
}

/// Opens a URL / ms-settings: link / program with the shell.
pub fn open(target: &str) -> SvcResult<()> {
    crate::services::core::launch::open_target(target)
}
