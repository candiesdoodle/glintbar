//! Display brightness: the built-in laptop panel through WMI (WmiMonitorBrightness), external
//! monitors over DDC/CI (VCP code 0x10) through the dxva2 physical-monitor API. All work runs
//! on the WMI worker thread (DDC/CI answers take tens of milliseconds per screen).

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use windows::core::{BSTR, BOOL, HSTRING};
use windows::Win32::Devices::Display::{
    DestroyPhysicalMonitors, GetNumberOfPhysicalMonitorsFromHMONITOR, GetPhysicalMonitorsFromHMONITOR,
    GetVCPFeatureAndVCPFeatureReply, SetVCPFeature, PHYSICAL_MONITOR,
};
use windows::Win32::Foundation::{LPARAM, RECT};
use windows::Win32::Graphics::Gdi::{EnumDisplayMonitors, GetMonitorInfoW, HDC, HMONITOR, MONITORINFO, MONITORINFOEXW};
use windows::Win32::System::Variant::VARIANT;
use windows::Win32::System::Wmi::{IWbemClassObject, WBEM_GENERIC_FLAG_TYPE};

use super::com;
use super::wmi;
use crate::error::{SvcError, SvcResult};

const VCP_BRIGHTNESS: u8 = 0x10;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Display {
    /// "wmi:<instance>" or "ddc:<device>#<n>"
    pub id: String,
    pub name: String,
    /// "internal" or "external"
    pub kind: String,
    /// 0-100, None when the screen can't be dimmed from Windows.
    pub percent: Option<u8>,
    pub primary: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetArgs {
    pub id: String,
    pub percent: u8,
}

/// The DDC maximum per screen, so a slider drag doesn't ask the monitor every time.
static DDC_MAX: Mutex<Option<HashMap<String, u32>>> = Mutex::new(None);

fn remember_max(id: &str, max: u32) {
    let mut g = DDC_MAX.lock().unwrap_or_else(|p| p.into_inner());
    g.get_or_insert_with(HashMap::new).insert(id.to_string(), max);
}

fn known_max(id: &str) -> Option<u32> {
    let g = DDC_MAX.lock().unwrap_or_else(|p| p.into_inner());
    g.as_ref().and_then(|m| m.get(id).copied())
}

pub fn to_percent(current: u32, maximum: u32) -> u8 {
    if maximum == 0 {
        return 0;
    }
    ((current.min(maximum) as u64 * 100 + maximum as u64 / 2) / maximum as u64) as u8
}

pub fn from_percent(percent: u8, maximum: u32) -> u32 {
    ((percent.min(100) as u64 * maximum as u64 + 50) / 100) as u32
}

// ---- built-in panel (WMI) ---------------------------------------------------------------------

fn internal() -> Vec<Display> {
    let services = match wmi::connect("ROOT\\WMI") {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };
    let rows = match wmi::query(&services, "SELECT InstanceName, CurrentBrightness FROM WmiMonitorBrightness WHERE Active=TRUE") {
        Ok(r) => r,
        Err(_) => return Vec::new(),
    };
    let mut out = Vec::new();
    for (i, row) in rows.iter().enumerate() {
        let instance = wmi::get_string(row, "InstanceName").unwrap_or_default();
        let percent = wmi::get_u32(row, "CurrentBrightness").map(|v| v.min(100) as u8);
        out.push(Display {
            id: format!("wmi:{instance}"),
            name: if i == 0 { "Built-in display".to_string() } else { format!("Built-in display {}", i + 1) },
            kind: "internal".to_string(),
            percent,
            primary: i == 0,
        });
    }
    out
}

fn set_internal(instance: &str, percent: u8) -> SvcResult<()> {
    let services = wmi::connect("ROOT\\WMI")?;
    let rows = wmi::query(&services, "SELECT * FROM WmiMonitorBrightnessMethods WHERE Active=TRUE")?;
    let target: Option<&IWbemClassObject> = rows
        .iter()
        .find(|r| wmi::get_string(r, "InstanceName").map(|n| n == instance).unwrap_or(false))
        .or_else(|| rows.first());
    let target = target.ok_or_else(|| SvcError::NotFound("that screen is no longer attached".into()))?;
    let path = wmi::get_string(target, "__PATH").ok_or_else(|| SvcError::Internal("display has no WMI path".into()))?;
    unsafe {
        let mut class: Option<IWbemClassObject> = None;
        services
            .GetObject(&BSTR::from("WmiMonitorBrightnessMethods"), WBEM_GENERIC_FLAG_TYPE(0), None, Some(&mut class as *mut Option<IWbemClassObject>), None)
            .map_err(wmi::map_wmi)?;
        let class = class.ok_or_else(|| SvcError::Internal("brightness class missing".into()))?;
        let mut signature: Option<IWbemClassObject> = None;
        class
            .GetMethod(&HSTRING::from("WmiSetBrightness"), 0, &mut signature, std::ptr::null_mut())
            .map_err(wmi::map_wmi)?;
        let signature = signature.ok_or_else(|| SvcError::Internal("brightness method missing".into()))?;
        let params = signature.SpawnInstance(0).map_err(wmi::map_wmi)?;
        // CIM uint32 travels as VT_I4 in WMI; VT_UI4 is rejected as a type mismatch.
        params.Put(&HSTRING::from("Timeout"), 0, &VARIANT::from(0i32), 0).map_err(wmi::map_wmi)?;
        params.Put(&HSTRING::from("Brightness"), 0, &VARIANT::from(percent.min(100)), 0).map_err(wmi::map_wmi)?;
        services
            .ExecMethod(&BSTR::from(path.as_str()), &BSTR::from("WmiSetBrightness"), WBEM_GENERIC_FLAG_TYPE(0), None, &params, None, None)
            .map_err(wmi::map_wmi)?;
    }
    Ok(())
}

// ---- external monitors (DDC/CI) ---------------------------------------------------------------

struct Screen {
    monitor: HMONITOR,
    device: String,
    primary: bool,
}

unsafe extern "system" fn collect(monitor: HMONITOR, _: HDC, _: *mut RECT, data: LPARAM) -> BOOL {
    let list = unsafe { &mut *(data.0 as *mut Vec<Screen>) };
    let mut info = MONITORINFOEXW::default();
    info.monitorInfo.cbSize = std::mem::size_of::<MONITORINFOEXW>() as u32;
    if unsafe { GetMonitorInfoW(monitor, &mut info as *mut MONITORINFOEXW as *mut MONITORINFO) }.as_bool() {
        list.push(Screen {
            monitor,
            device: super::util::from_wide(&info.szDevice),
            primary: info.monitorInfo.dwFlags & 1 == 1,
        });
    }
    BOOL(1)
}

fn screens() -> Vec<Screen> {
    let mut list: Vec<Screen> = Vec::new();
    unsafe {
        let _ = EnumDisplayMonitors(None, None, Some(collect), LPARAM(&mut list as *mut Vec<Screen> as isize));
    }
    list
}

/// Opens every physical monitor, calls `f` with (id, handle-owner, index, description, primary), closes them.
fn with_physical<F: FnMut(&str, &PHYSICAL_MONITOR, String, bool)>(mut f: F) {
    for screen in screens() {
        let mut count: u32 = 0;
        unsafe {
            if GetNumberOfPhysicalMonitorsFromHMONITOR(screen.monitor, &mut count).is_err() || count == 0 {
                continue;
            }
            let mut monitors = vec![PHYSICAL_MONITOR::default(); count as usize];
            if GetPhysicalMonitorsFromHMONITOR(screen.monitor, &mut monitors).is_err() {
                continue;
            }
            for (i, m) in monitors.iter().enumerate() {
                let id = format!("ddc:{}#{}", screen.device, i);
                let description = m.szPhysicalMonitorDescription;
                f(&id, m, super::util::from_wide(&description), screen.primary);
            }
            let _ = DestroyPhysicalMonitors(&monitors);
        }
    }
}

fn read_ddc(m: &PHYSICAL_MONITOR) -> Option<(u32, u32)> {
    let mut current: u32 = 0;
    let mut maximum: u32 = 0;
    let ok = unsafe { GetVCPFeatureAndVCPFeatureReply(m.hPhysicalMonitor, VCP_BRIGHTNESS, None, &mut current, Some(&mut maximum as *mut u32)) };
    if ok != 0 && maximum > 0 {
        Some((current, maximum))
    } else {
        None
    }
}

fn external(skip_unanswered: bool) -> Vec<Display> {
    let mut out = Vec::new();
    let mut n = 0;
    with_physical(|id, m, description, primary| {
        n += 1;
        let reading = read_ddc(m);
        if let Some((_, max)) = reading {
            remember_max(id, max);
        }
        if reading.is_none() && skip_unanswered {
            return;
        }
        let name = if description.trim().is_empty() || description.eq_ignore_ascii_case("Generic PnP Monitor") {
            format!("Display {n}")
        } else {
            description.trim().to_string()
        };
        out.push(Display {
            id: id.to_string(),
            name,
            kind: "external".to_string(),
            percent: reading.map(|(c, max)| to_percent(c, max)),
            primary,
        });
    });
    out
}

fn set_external(id: &str, percent: u8) -> SvcResult<()> {
    let mut result: SvcResult<()> = Err(SvcError::NotFound("that screen is no longer attached".into()));
    with_physical(|this, m, _, _| {
        if this != id {
            return;
        }
        let max = match known_max(id) {
            Some(max) => Some(max),
            None => read_ddc(m).map(|(_, max)| {
                remember_max(id, max);
                max
            }),
        };
        result = match max {
            Some(max) => {
                let ok = unsafe { SetVCPFeature(m.hPhysicalMonitor, VCP_BRIGHTNESS, from_percent(percent, max)) };
                if ok != 0 {
                    Ok(())
                } else {
                    Err(SvcError::Io("the monitor ignored the new brightness".into()))
                }
            }
            None => Err(SvcError::Unsupported("this monitor rejects brightness commands (DDC/CI is turned off or unsupported)".into())),
        };
    });
    result
}

// ---- service methods --------------------------------------------------------------------------

pub fn list() -> SvcResult<Vec<Display>> {
    com::WMI.run(Duration::from_secs(20), || {
        let mut all = internal();
        // With a built-in panel present, its "Generic PnP Monitor" DDC twin never answers: hide
        // screens that don't answer only then.
        let has_internal = !all.is_empty();
        all.extend(external(has_internal));
        Ok(all)
    })
}

pub fn set(args: SetArgs) -> SvcResult<()> {
    let percent = args.percent.min(100);
    let id = args.id;
    com::WMI.run(Duration::from_secs(10), move || {
        if let Some(instance) = id.strip_prefix("wmi:") {
            set_internal(instance, percent)
        } else if id.starts_with("ddc:") {
            set_external(&id, percent)
        } else {
            Err(SvcError::bad_args("unknown display"))
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn percent_round_trips() {
        assert_eq!(to_percent(128, 255), 50);
        assert_eq!(from_percent(50, 255), 128);
        assert_eq!(to_percent(5, 0), 0);
        assert_eq!(from_percent(150, 100), 100);
    }
}
