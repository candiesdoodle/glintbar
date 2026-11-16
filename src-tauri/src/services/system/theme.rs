//! Light / dark mode: the two Personalize registry values, then WM_SETTINGCHANGE
//! "ImmersiveColorSet" so Explorer and apps repaint.

use serde::{Deserialize, Serialize};
use windows::core::w;
use windows::Win32::Foundation::{LPARAM, WPARAM};
use windows::Win32::System::Registry::HKEY_CURRENT_USER;
use windows::Win32::UI::WindowsAndMessaging::{SendMessageTimeoutW, HWND_BROADCAST, SMTO_ABORTIFHUNG, WM_SETTINGCHANGE};

use crate::error::SvcResult;

const KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize";

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Theme {
    /// Apps use the light theme.
    pub apps_light: bool,
    /// Taskbar, Start and the shell use the light theme.
    pub system_light: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetArgs {
    pub light: bool,
    /// Change apps (default true).
    #[serde(default = "yes")]
    pub apps: bool,
    /// Change the shell (default true).
    #[serde(default = "yes")]
    pub system: bool,
}

fn yes() -> bool {
    true
}

pub fn get() -> SvcResult<Theme> {
    Ok(Theme {
        apps_light: crate::win::reg_dword(HKEY_CURRENT_USER, KEY, "AppsUseLightTheme").map(|v| v != 0).unwrap_or(false),
        system_light: crate::win::reg_dword(HKEY_CURRENT_USER, KEY, "SystemUsesLightTheme").map(|v| v != 0).unwrap_or(false),
    })
}

pub fn set(args: SetArgs) -> SvcResult<Theme> {
    let value: u32 = if args.light { 1 } else { 0 };
    if args.apps {
        super::util::reg_set_dword(HKEY_CURRENT_USER, KEY, "AppsUseLightTheme", value)?;
    }
    if args.system {
        super::util::reg_set_dword(HKEY_CURRENT_USER, KEY, "SystemUsesLightTheme", value)?;
    }
    // Broadcasting can take a moment while every window repaints: don't hold the caller.
    let _ = std::thread::Builder::new().name("glintbar-theme-broadcast".into()).spawn(|| unsafe {
        let text = w!("ImmersiveColorSet");
        let _ = SendMessageTimeoutW(
            HWND_BROADCAST,
            WM_SETTINGCHANGE,
            WPARAM(0),
            LPARAM(text.as_ptr() as isize),
            SMTO_ABORTIFHUNG,
            500,
            None,
        );
    });
    get()
}
