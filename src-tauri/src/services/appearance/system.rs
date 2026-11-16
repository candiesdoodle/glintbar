//! Windows light/dark mode and accent colour, read from the registry (cheap: a few REG_DWORDs).

use std::time::Duration;

use serde::Serialize;
use tauri::AppHandle;

use crate::error::SvcResult;
use crate::registry::{NoArgs, Registrar};

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct SystemTheme {
    /// "Choose your app mode" = Light.
    pub apps_light: bool,
    /// "Choose your Windows mode" = Light (taskbar, Start).
    pub system_light: bool,
    /// The Windows accent colour as "#rrggbb", if set.
    pub accent: Option<String>,
    /// Settings > Personalisation > Colours > Transparency effects.
    pub transparency: bool,
}

pub fn register(reg: &mut Registrar) {
    reg.add_blocking("appearance", "system_theme", |_app: AppHandle, _: NoArgs| read());
    reg.poller("appearance", "system", Duration::from_secs(3), |_app: AppHandle| async move { read() });
}

#[cfg(windows)]
pub fn read() -> SvcResult<SystemTheme> {
    use windows::Win32::System::Registry::HKEY_CURRENT_USER;
    const PERSONALIZE: &str = r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize";
    const DWM: &str = r"Software\Microsoft\Windows\DWM";
    let dword = |key: &str, name: &str| crate::win::reg_dword(HKEY_CURRENT_USER, key, name);
    // AccentColor is 0xAABBGGRR.
    let accent = dword(DWM, "AccentColor").map(|abgr| {
        let r = abgr & 0xff;
        let g = (abgr >> 8) & 0xff;
        let b = (abgr >> 16) & 0xff;
        format!("#{r:02x}{g:02x}{b:02x}")
    });
    Ok(SystemTheme {
        apps_light: dword(PERSONALIZE, "AppsUseLightTheme").map(|v| v != 0).unwrap_or(false),
        system_light: dword(PERSONALIZE, "SystemUsesLightTheme").map(|v| v != 0).unwrap_or(false),
        accent,
        transparency: dword(PERSONALIZE, "EnableTransparency").map(|v| v != 0).unwrap_or(true),
    })
}

#[cfg(not(windows))]
pub fn read() -> SvcResult<SystemTheme> {
    Ok(SystemTheme { transparency: true, ..Default::default() })
}
