//! One-click shell actions: Notification Center, the on-screen keyboard.

use windows::core::{w, PCWSTR};
use windows::Win32::Foundation::{LPARAM, WPARAM};
use windows::Win32::UI::WindowsAndMessaging::{FindWindowW, IsWindowVisible, PostMessageW, WM_CLOSE};

use crate::error::SvcResult;

/// Opens (or closes, if open) Windows' notifications: Win+N on Windows 11, Win+A on Windows 10.
pub fn toggle_notifications() -> SvcResult<()> {
    if super::util::windows_build() >= 22000 {
        super::util::win_plus('N')
    } else {
        super::util::win_plus('A')
    }
}

/// Quick Settings (Windows 11) / Action Center (Windows 10).
pub fn open_quick_settings() -> SvcResult<()> {
    super::util::win_plus('A')
}

/// Win+P: Windows' own display-mode chooser.
pub fn open_project() -> SvcResult<()> {
    super::util::win_plus('P')
}

pub fn keyboard_open() -> bool {
    unsafe {
        match FindWindowW(w!("OSKMainClass"), PCWSTR::null()) {
            Ok(h) => IsWindowVisible(h).as_bool(),
            Err(_) => false,
        }
    }
}

/// Opens the On-Screen Keyboard, or closes it when it is open. Returns whether it is open now.
pub fn toggle_keyboard() -> SvcResult<bool> {
    let existing = unsafe { FindWindowW(w!("OSKMainClass"), PCWSTR::null()) };
    match existing {
        Ok(h) => {
            unsafe { PostMessageW(Some(h), WM_CLOSE, WPARAM(0), LPARAM(0))? };
            Ok(false)
        }
        Err(_) => {
            super::util::open("osk.exe")?;
            Ok(true)
        }
    }
}
