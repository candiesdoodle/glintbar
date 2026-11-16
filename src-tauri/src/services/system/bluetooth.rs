//! Paired Bluetooth devices, whether each is connected, and its battery where Windows knows it
//! (the level Settings shows, DEVPKEY_Bluetooth_Battery). Call from the COM worker; slow-ish
//! (a few hundred ms with several devices), so the UI asks only while the card is open.

use serde::Serialize;
use windows::core::{Interface, GUID, HSTRING};
use windows::Devices::Enumeration::{DeviceInformation, DeviceInformationKind};
use windows::Foundation::IReference;
use windows_collections::IIterable;

use crate::error::SvcResult;

const CLASSIC: &str = "{e0cbf06c-cd8b-4647-bb8a-263b43f0f974}";
const LOW_ENERGY: &str = "{bb7bb05e-5972-42b5-94fc-76eaa7084d49}";
const IS_CONNECTED: &str = "System.Devices.Aep.IsConnected";
const CONTAINER: &str = "System.Devices.Aep.ContainerId";
const MAJOR_CLASS: &str = "System.Devices.Aep.Bluetooth.Cod.Major";
const BATTERY: &str = "{104EA319-6EE2-4701-BD47-8DDBF425BBE5} 2";

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BtDevice {
    pub id: String,
    pub name: String,
    pub connected: bool,
    /// 0-100 when the device reports it.
    pub battery: Option<u8>,
    /// "audio", "input", "phone", "computer" or "other".
    pub kind: String,
}

fn props(names: &[&str]) -> IIterable<HSTRING> {
    let list: Vec<HSTRING> = names.iter().map(|n| HSTRING::from(*n)).collect();
    IIterable::<HSTRING>::from(list)
}

fn prop_bool(info: &DeviceInformation, name: &str) -> Option<bool> {
    let value = info.Properties().ok()?.Lookup(&HSTRING::from(name)).ok()?;
    value.cast::<IReference<bool>>().ok()?.Value().ok()
}

fn prop_u32(info: &DeviceInformation, name: &str) -> Option<u32> {
    let value = info.Properties().ok()?.Lookup(&HSTRING::from(name)).ok()?;
    value.cast::<IReference<u32>>().ok()?.Value().ok()
}

fn prop_u8(info: &DeviceInformation, name: &str) -> Option<u8> {
    let value = info.Properties().ok()?.Lookup(&HSTRING::from(name)).ok()?;
    value.cast::<IReference<u8>>().ok()?.Value().ok()
}

fn prop_guid(info: &DeviceInformation, name: &str) -> Option<GUID> {
    let value = info.Properties().ok()?.Lookup(&HSTRING::from(name)).ok()?;
    value.cast::<IReference<GUID>>().ok()?.Value().ok()
}

fn battery_of(container: &GUID) -> Option<u8> {
    let aqs = HSTRING::from(format!("System.Devices.ContainerId:=\"{{{container:?}}}\""));
    let nodes = DeviceInformation::FindAllAsyncWithKindAqsFilterAndAdditionalProperties(&aqs, &props(&[BATTERY]), DeviceInformationKind::Device)
        .ok()?
        .join()
        .ok()?;
    let count = nodes.Size().ok()?;
    for i in 0..count {
        if let Ok(node) = nodes.GetAt(i) {
            if let Some(level) = prop_u8(&node, BATTERY) {
                return Some(level.min(100));
            }
        }
    }
    None
}

fn kind_of(major: Option<u32>) -> &'static str {
    match major {
        Some(1) => "computer",
        Some(2) => "phone",
        Some(4) => "audio",
        Some(5) => "input",
        _ => "other",
    }
}

pub fn devices() -> SvcResult<Vec<BtDevice>> {
    let aqs = HSTRING::from(format!(
        "(System.Devices.Aep.ProtocolId:=\"{CLASSIC}\" OR System.Devices.Aep.ProtocolId:=\"{LOW_ENERGY}\") AND System.Devices.Aep.IsPaired:=System.StructuredQueryType.Boolean#True"
    ));
    let found = DeviceInformation::FindAllAsyncWithKindAqsFilterAndAdditionalProperties(
        &aqs,
        &props(&[IS_CONNECTED, CONTAINER, MAJOR_CLASS]),
        DeviceInformationKind::AssociationEndpoint,
    )?
    .join()?;
    // A dual-mode device shows up once per protocol: merge them by container.
    let mut merged: Vec<(Option<GUID>, BtDevice)> = Vec::new();
    for i in 0..found.Size()? {
        let info = match found.GetAt(i) {
            Ok(d) => d,
            Err(_) => continue,
        };
        let name = info.Name().map(|n| n.to_string()).unwrap_or_default();
        if name.trim().is_empty() {
            continue;
        }
        let connected = prop_bool(&info, IS_CONNECTED).unwrap_or(false);
        let container = prop_guid(&info, CONTAINER);
        let kind = kind_of(prop_u32(&info, MAJOR_CLASS));
        let existing = merged.iter_mut().find(|(c, d)| (container.is_some() && *c == container) || (container.is_none() && d.name == name));
        match existing {
            Some((_, d)) => {
                d.connected = d.connected || connected;
                if d.kind == "other" {
                    d.kind = kind.to_string();
                }
            }
            None => merged.push((
                container,
                BtDevice {
                    id: info.Id().map(|s| s.to_string()).unwrap_or_default(),
                    name,
                    connected,
                    battery: None,
                    kind: kind.to_string(),
                },
            )),
        }
    }
    let mut out = Vec::new();
    for (container, mut d) in merged {
        if d.connected {
            if let Some(c) = container.as_ref() {
                d.battery = battery_of(c);
            }
        }
        out.push(d);
    }
    out.sort_by(|a, b| b.connected.cmp(&a.connected).then(a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(out)
}
