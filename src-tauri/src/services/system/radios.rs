//! Wi-Fi, Bluetooth and mobile-broadband radios (Windows.Devices.Radios). Call from the COM worker.

use windows::Devices::Radios::{Radio, RadioAccessStatus, RadioKind, RadioState};

use crate::error::{SvcError, SvcResult};

#[derive(Default, Clone, Copy, Debug)]
pub struct Radios {
    /// None = this PC has no such radio.
    pub wifi: Option<bool>,
    pub bluetooth: Option<bool>,
    pub cellular: Option<bool>,
}

pub fn read() -> SvcResult<Radios> {
    let list = Radio::GetRadiosAsync()?.join()?;
    let mut out = Radios::default();
    for i in 0..list.Size()? {
        let radio = match list.GetAt(i) {
            Ok(r) => r,
            Err(_) => continue,
        };
        let on = radio.State().map(|s| s == RadioState::On).unwrap_or(false);
        match radio.Kind() {
            // Several adapters of one kind: on if any is.
            Ok(k) if k == RadioKind::WiFi => out.wifi = Some(out.wifi.unwrap_or(false) || on),
            Ok(k) if k == RadioKind::Bluetooth => out.bluetooth = Some(out.bluetooth.unwrap_or(false) || on),
            Ok(k) if k == RadioKind::MobileBroadband => out.cellular = Some(out.cellular.unwrap_or(false) || on),
            _ => {}
        }
    }
    Ok(out)
}

pub fn set(kind: RadioKind, on: bool) -> SvcResult<()> {
    let access = Radio::RequestAccessAsync()?.join()?;
    if access != RadioAccessStatus::Allowed {
        return Err(SvcError::Denied("Apps are blocked from changing radios. Allow it under Settings > Privacy > Radios.".into()));
    }
    let list = Radio::GetRadiosAsync()?.join()?;
    let mut found = false;
    for i in 0..list.Size()? {
        let radio = match list.GetAt(i) {
            Ok(r) => r,
            Err(_) => continue,
        };
        if radio.Kind().ok() != Some(kind) {
            continue;
        }
        found = true;
        let target = if on { RadioState::On } else { RadioState::Off };
        let status = radio.SetStateAsync(target)?.join()?;
        if status != RadioAccessStatus::Allowed {
            return Err(SvcError::Denied("Windows refused to change the radio".into()));
        }
    }
    if found {
        Ok(())
    } else {
        Err(SvcError::NotFound("no radio of that kind on this PC".into()))
    }
}
