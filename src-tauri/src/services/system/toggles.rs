//! Quick Toggles: one snapshot of every switch, and `toggle_set` to flip one. Switches with no
//! public API open the matching Settings page instead (`ToggleResult.openedSettings`).

use std::time::Duration;

use serde::{Deserialize, Serialize};
use windows::Devices::Radios::RadioKind;
use windows::System::Power::{EnergySaverStatus, PowerManager};
use windows::Win32::System::Registry::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};

use super::{audio, awake, com, connectivity, desktop, display, dnd, hotspot, network, radios, shell_actions, util};
use crate::error::{SvcError, SvcResult};

const CAMERA_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\webcam";
/// Airplane mode is the default value of this key: 1 = on, 0 = off.
const AIRPLANE_KEY: &str = r"SYSTEM\CurrentControlSet\Control\RadioManagement\SystemRadioState";
const AIRPLANE_PARENT: &str = r"SYSTEM\CurrentControlSet\Control\RadioManagement";

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct WifiToggle {
    pub on: bool,
    pub connected: bool,
    pub online: bool,
    pub ssid: Option<String>,
    pub signal: Option<u8>,
}

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct HotspotToggle {
    pub capable: bool,
    pub on: bool,
    pub clients: u32,
}

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct EthernetToggle {
    pub connected: bool,
    pub name: Option<String>,
}

/// Every field is None when this PC doesn't have that switch.
#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ToggleState {
    pub online: bool,
    pub wifi: Option<WifiToggle>,
    pub bluetooth: Option<bool>,
    pub cellular: Option<bool>,
    pub airplane: Option<bool>,
    pub hotspot: Option<HotspotToggle>,
    pub ethernet: Option<EthernetToggle>,
    pub energy_saver: Option<bool>,
    pub dnd: Option<bool>,
    pub keep_awake: bool,
    pub desktop_icons: Option<bool>,
    pub display_mode: Option<String>,
    /// True = the microphone is live (not muted).
    pub microphone: Option<bool>,
    /// True = apps may use the camera.
    pub camera: Option<bool>,
    pub at: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetArgs {
    pub id: String,
    #[serde(default)]
    pub on: bool,
    /// For "displayMode": "internal" | "clone" | "extend" | "external"
    #[serde(default)]
    pub mode: Option<String>,
}

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ToggleResult {
    /// Windows has no switch for it: its Settings page (or flyout) was opened instead.
    pub opened_settings: bool,
}

fn camera_allowed() -> Option<bool> {
    let user = crate::win::reg_string(HKEY_CURRENT_USER, CAMERA_KEY, "Value");
    let machine = crate::win::reg_string(HKEY_LOCAL_MACHINE, CAMERA_KEY, "Value");
    if user.is_none() && machine.is_none() {
        return None;
    }
    let denied = |v: &Option<String>| v.as_deref().map(|s| s.eq_ignore_ascii_case("Deny")).unwrap_or(false);
    Some(!denied(&user) && !denied(&machine))
}

fn energy_saver() -> Option<bool> {
    match PowerManager::EnergySaverStatus() {
        Ok(s) if s == EnergySaverStatus::Disabled => None,
        Ok(s) => Some(s == EnergySaverStatus::On),
        Err(_) => super::battery::read().ok().map(|b| b.saver),
    }
}

fn read_all() -> SvcResult<ToggleState> {
    let r = radios::read().unwrap_or_default();
    let (online, wifi_conn) = connectivity::read();
    let adapters = network::adapters().unwrap_or_default();
    let ethernet: Vec<&network::Adapter> = adapters.iter().filter(|a| a.kind == "ethernet").collect();
    let has_wifi_adapter = adapters.iter().any(|a| a.kind == "wifi");
    let wifi = match r.wifi {
        Some(on) => Some(WifiToggle {
            on,
            connected: wifi_conn.connected,
            online: wifi_conn.online,
            ssid: wifi_conn.ssid.clone(),
            signal: wifi_conn.signal,
        }),
        None if has_wifi_adapter => Some(WifiToggle {
            on: wifi_conn.connected,
            connected: wifi_conn.connected,
            online: wifi_conn.online,
            ssid: wifi_conn.ssid.clone(),
            signal: wifi_conn.signal,
        }),
        None => None,
    };
    let ethernet = if ethernet.is_empty() {
        None
    } else {
        let up = ethernet.iter().find(|a| a.up);
        Some(EthernetToggle { connected: up.is_some(), name: up.map(|a| a.name.clone()) })
    };
    Ok(ToggleState {
        online,
        wifi,
        bluetooth: r.bluetooth,
        cellular: r.cellular,
        airplane: crate::win::reg_dword(HKEY_LOCAL_MACHINE, AIRPLANE_KEY, "")
            .or_else(|| crate::win::reg_dword(HKEY_LOCAL_MACHINE, AIRPLANE_PARENT, "SystemRadioState"))
            .map(|v| v == 1),
        hotspot: hotspot::read().map(|h| HotspotToggle { capable: h.capable, on: h.on, clients: h.clients }),
        ethernet,
        energy_saver: energy_saver(),
        dnd: dnd::is_on(),
        keep_awake: awake::is_on(),
        desktop_icons: desktop::icons_visible(),
        display_mode: display::mode(),
        microphone: audio::muted().map(|m| !m),
        camera: camera_allowed(),
        at: util::now_ms(),
    })
}

pub fn state() -> SvcResult<ToggleState> {
    com::COM.run(Duration::from_secs(15), read_all)
}

fn settings(page: &str) -> SvcResult<ToggleResult> {
    util::open(page)?;
    Ok(ToggleResult { opened_settings: true })
}

const DONE: ToggleResult = ToggleResult { opened_settings: false };

pub fn set(args: SetArgs) -> SvcResult<ToggleResult> {
    let on = args.on;
    match args.id.as_str() {
        "wifi" => com::COM.run(Duration::from_secs(15), move || radios::set(RadioKind::WiFi, on)).map(|_| DONE),
        "bluetooth" => com::COM.run(Duration::from_secs(15), move || radios::set(RadioKind::Bluetooth, on)).map(|_| DONE),
        "cellular" => com::COM.run(Duration::from_secs(15), move || radios::set(RadioKind::MobileBroadband, on)).map(|_| DONE),
        "hotspot" => com::COM.run(Duration::from_secs(30), move || hotspot::set(on)).map(|_| DONE),
        "microphone" => com::COM.run(Duration::from_secs(10), move || audio::set_muted(!on)).map(|_| DONE),
        "airplane" => settings("ms-settings:network-airplanemode"),
        "ethernet" => settings("ms-settings:network-ethernet"),
        "energySaver" => settings("ms-settings:batterysaver"),
        "dnd" => {
            if dnd::set(on) {
                Ok(DONE)
            } else {
                settings("ms-settings:notifications")
            }
        }
        "keepAwake" => awake::set(on).map(|_| DONE),
        "desktopIcons" => desktop::toggle_icons().map(|_| DONE),
        "camera" => {
            util::reg_set_string(HKEY_CURRENT_USER, CAMERA_KEY, "Value", if on { "Allow" } else { "Deny" }).map(|_| DONE)
        }
        "displayMode" => match args.mode.as_deref() {
            Some(mode) => display::set_mode(mode).map(|_| DONE),
            None => shell_actions::open_project().map(|_| ToggleResult { opened_settings: true }),
        },
        other => Err(SvcError::bad_args(format!("unknown toggle {other}"))),
    }
}
