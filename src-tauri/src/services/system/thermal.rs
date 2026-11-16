//! Temperature sensors through WMI, on the WMI worker thread.
//!
//! 1. `Win32_PerfFormattedData_Counters_ThermalZoneInformation` (root\cimv2) - readable
//!    without administrator rights on most PCs (tenths of a kelvin in HighPrecisionTemperature).
//! 2. `MSAcpi_ThermalZoneTemperature` (root\wmi) - usually needs administrator rights.
//!
//! Sampled every 3 s while `system/thermal` has subscribers; ten minutes of history per sensor.

use std::collections::{HashMap, VecDeque};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;

use super::com;
use super::wmi;
use crate::error::{SvcError, SvcResult};

pub const INTERVAL_SECS: u64 = 3;
const HISTORY_LEN: usize = (600 / INTERVAL_SECS) as usize;
const STALE_AFTER: Duration = Duration::from_secs(60);

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Sensor {
    /// Stable id, e.g. "\\_TZ.CPUZ".
    pub id: String,
    /// What we think it measures: "CPU", "Graphics", "Battery", "Chassis", or "Thermal zone TZ00".
    pub label: String,
    /// True when the firmware names it as the processor's sensor.
    pub is_cpu: bool,
    pub celsius: f32,
    /// Oldest first, one value every 3 s, at most ten minutes.
    pub history: Vec<f32>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ThermalSample {
    pub available: bool,
    /// Plain-language reason when nothing can be read.
    pub reason: Option<String>,
    /// "perf" (no admin needed) or "acpi".
    pub source: String,
    pub sensors: Vec<Sensor>,
    pub interval_secs: u64,
    pub at: i64,
}

struct State {
    history: HashMap<String, VecDeque<f32>>,
    last_at: Option<Instant>,
}

static STATE: Mutex<Option<State>> = Mutex::new(None);
/// When no sensor could be read: (when, reason). WMI is not asked again for a while, so a PC
/// without sensors (desktops, VMs) doesn't run two WMI queries every 3 s for nothing.
static NO_SENSOR: Mutex<Option<(Instant, String)>> = Mutex::new(None);
const RETRY_AFTER: Duration = Duration::from_secs(300);

fn unavailable(reason: String, at: i64) -> ThermalSample {
    ThermalSample { available: false, reason: Some(reason), source: String::new(), sensors: Vec::new(), interval_secs: INTERVAL_SECS, at }
}

struct Reading {
    id: String,
    celsius: f32,
}

fn plausible(c: f32) -> bool {
    c > 1.0 && c < 130.0
}

fn read_perf() -> SvcResult<Vec<Reading>> {
    let services = wmi::connect("ROOT\\CIMV2")?;
    let rows = wmi::query(&services, "SELECT * FROM Win32_PerfFormattedData_Counters_ThermalZoneInformation")?;
    let mut out = Vec::new();
    for row in rows {
        let id = wmi::get_string(&row, "Name").unwrap_or_else(|| "Thermal zone".to_string());
        let celsius = match wmi::get_u32(&row, "HighPrecisionTemperature") {
            Some(t) if t > 0 => t as f32 / 10.0 - 273.15,
            _ => match wmi::get_u32(&row, "Temperature") {
                Some(t) if t > 0 => t as f32 - 273.15,
                _ => continue,
            },
        };
        if plausible(celsius) {
            out.push(Reading { id, celsius });
        }
    }
    Ok(out)
}

fn read_acpi() -> SvcResult<Vec<Reading>> {
    let services = wmi::connect("ROOT\\WMI")?;
    let rows = wmi::query(&services, "SELECT InstanceName, CurrentTemperature FROM MSAcpi_ThermalZoneTemperature")?;
    let mut out = Vec::new();
    for row in rows {
        let id = wmi::get_string(&row, "InstanceName").unwrap_or_else(|| "Thermal zone".to_string());
        if let Some(t) = wmi::get_u32(&row, "CurrentTemperature") {
            let celsius = t as f32 / 10.0 - 273.15;
            if plausible(celsius) {
                out.push(Reading { id, celsius });
            }
        }
    }
    Ok(out)
}

/// "\\_TZ.CPUZ" -> "CPUZ", "ACPI\\ThermalZone\\TZ00_0" -> "TZ00".
fn short_id(id: &str) -> String {
    let last = id.rsplit(|c| c == '.' || c == '\\').next().unwrap_or(id);
    let trimmed = last.strip_suffix("_0").unwrap_or(last);
    trimmed.trim().to_string()
}

pub fn label_for(id: &str) -> (String, bool) {
    let short = short_id(id);
    let up = short.to_ascii_uppercase();
    if up.contains("CPU") || up == "TCPU" || up.contains("PROC") {
        ("CPU".to_string(), true)
    } else if up.contains("GPU") || up.contains("GFX") {
        ("Graphics".to_string(), false)
    } else if up.contains("BAT") {
        ("Battery".to_string(), false)
    } else if up.contains("SKIN") || up.contains("SKN") {
        ("Chassis".to_string(), false)
    } else if up.contains("PCH") {
        ("Chipset".to_string(), false)
    } else if short.is_empty() {
        ("Thermal zone".to_string(), false)
    } else {
        (format!("Thermal zone {short}"), false)
    }
}

fn read_all() -> SvcResult<(String, Vec<Reading>)> {
    if let Ok(list) = read_perf() {
        if !list.is_empty() {
            return Ok(("perf".to_string(), list));
        }
    }
    match read_acpi() {
        Ok(list) if !list.is_empty() => Ok(("acpi".to_string(), list)),
        Ok(_) => Err(SvcError::NotFound("no sensor".into())),
        Err(e) => Err(e),
    }
}

pub fn sample() -> SvcResult<ThermalSample> {
    {
        let cached = NO_SENSOR.lock().unwrap_or_else(|p| p.into_inner());
        if let Some((when, reason)) = cached.as_ref() {
            if when.elapsed() < RETRY_AFTER {
                return Ok(unavailable(reason.clone(), super::util::now_ms()));
            }
        }
    }
    let result = com::WMI.run(Duration::from_secs(15), read_all);
    let at = super::util::now_ms();
    let (source, readings) = match result {
        Ok(r) => {
            *NO_SENSOR.lock().unwrap_or_else(|p| p.into_inner()) = None;
            r
        }
        Err(SvcError::Timeout(m)) => return Err(SvcError::Timeout(m)),
        Err(e) => {
            let reason = match e {
                SvcError::Denied(_) => "Reading this PC's temperature sensor requires administrator rights.",
                _ => "Windows reports no temperature sensor on this PC.",
            };
            *NO_SENSOR.lock().unwrap_or_else(|p| p.into_inner()) = Some((Instant::now(), reason.to_string()));
            return Ok(unavailable(reason.to_string(), at));
        }
    };

    let mut guard = STATE.lock().unwrap_or_else(|p| p.into_inner());
    let state = guard.get_or_insert_with(|| State { history: HashMap::new(), last_at: None });
    if state.last_at.map(|t| t.elapsed() > STALE_AFTER).unwrap_or(true) {
        state.history.clear();
    }
    state.last_at = Some(Instant::now());
    let mut sensors = Vec::new();
    for r in readings {
        let value = (r.celsius * 10.0).round() / 10.0;
        let h = state.history.entry(r.id.clone()).or_default();
        h.push_back(value);
        while h.len() > HISTORY_LEN {
            h.pop_front();
        }
        let (label, is_cpu) = label_for(&r.id);
        sensors.push(Sensor { id: r.id, label, is_cpu, celsius: value, history: h.iter().copied().collect() });
    }
    Ok(ThermalSample { available: true, reason: None, source, sensors, interval_secs: INTERVAL_SECS, at })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn labels_do_not_call_every_zone_the_cpu() {
        assert_eq!(label_for("\\_TZ.CPUZ"), ("CPU".to_string(), true));
        assert_eq!(label_for("\\_TZ.TZ00"), ("Thermal zone TZ00".to_string(), false));
        assert_eq!(label_for("ACPI\\ThermalZone\\BAT0_0").0, "Battery");
    }
}
