//! Mobile hotspot (tethering the current internet connection). Call from the COM worker.

use windows::Networking::Connectivity::NetworkInformation;
use windows::Networking::NetworkOperators::{
    NetworkOperatorTetheringManager, TetheringCapability, TetheringOperationStatus, TetheringOperationalState,
};

use crate::error::{SvcError, SvcResult};

#[derive(Default, Clone, Debug)]
pub struct Hotspot {
    pub capable: bool,
    pub on: bool,
    pub clients: u32,
}

pub fn read() -> Option<Hotspot> {
    let profile = NetworkInformation::GetInternetConnectionProfile().ok()?;
    let capability = NetworkOperatorTetheringManager::GetTetheringCapabilityFromConnectionProfile(&profile).ok()?;
    if capability != TetheringCapability::Enabled {
        return Some(Hotspot { capable: false, on: false, clients: 0 });
    }
    let manager = NetworkOperatorTetheringManager::CreateFromConnectionProfile(&profile).ok()?;
    let on = manager.TetheringOperationalState().map(|s| s == TetheringOperationalState::On).unwrap_or(false);
    let clients = if on { manager.ClientCount().unwrap_or(0) } else { 0 };
    Some(Hotspot { capable: true, on, clients })
}

pub fn set(on: bool) -> SvcResult<()> {
    let profile = NetworkInformation::GetInternetConnectionProfile()
        .map_err(|_| SvcError::Offline("there is no internet connection to share".into()))?;
    let manager = NetworkOperatorTetheringManager::CreateFromConnectionProfile(&profile)
        .map_err(|_| SvcError::Unsupported("Windows can't share this connection as a hotspot".into()))?;
    let op = if on { manager.StartTetheringAsync()? } else { manager.StopTetheringAsync()? };
    let result = op.join()?;
    let status = result.Status()?;
    if status == TetheringOperationStatus::Success || status == TetheringOperationStatus::AlreadyOn {
        Ok(())
    } else if status == TetheringOperationStatus::WiFiDeviceOff {
        Err(SvcError::Unsupported("Wi-Fi must be on for the hotspot".into()))
    } else {
        Err(SvcError::Io(format!("the hotspot change failed (Windows status {})", status.0)))
    }
}
