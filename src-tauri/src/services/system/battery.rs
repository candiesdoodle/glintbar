//! Battery state from GetSystemPowerStatus, every 5 s while `system/battery` has subscribers.

use serde::Serialize;
use windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};

use crate::error::SvcResult;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BatteryState {
    /// False on desktops (no system battery).
    pub present: bool,
    /// 0-100, None when Windows doesn't know.
    pub percent: Option<u8>,
    pub charging: bool,
    pub plugged_in: bool,
    /// Estimated seconds left on battery.
    pub seconds_left: Option<u32>,
    /// Battery saver / energy saver is on.
    pub saver: bool,
    pub at: i64,
}

const NO_BATTERY: u8 = 128;
const UNKNOWN: u8 = 255;
const CHARGING: u8 = 8;

pub fn read() -> SvcResult<BatteryState> {
    let mut s = SYSTEM_POWER_STATUS::default();
    unsafe { GetSystemPowerStatus(&mut s)? };
    Ok(from_status(&s))
}

fn from_status(s: &SYSTEM_POWER_STATUS) -> BatteryState {
    let present = s.BatteryFlag != UNKNOWN && (s.BatteryFlag & NO_BATTERY) == 0;
    let percent = if present && s.BatteryLifePercent <= 100 { Some(s.BatteryLifePercent) } else { None };
    let plugged_in = s.ACLineStatus == 1;
    BatteryState {
        present,
        percent,
        charging: present && plugged_in && (s.BatteryFlag & CHARGING) != 0,
        plugged_in,
        seconds_left: if present && !plugged_in && s.BatteryLifeTime != u32::MAX { Some(s.BatteryLifeTime) } else { None },
        saver: s.SystemStatusFlag == 1,
        at: super::util::now_ms(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn desktop_has_no_battery() {
        let s = SYSTEM_POWER_STATUS { ACLineStatus: 1, BatteryFlag: 128, BatteryLifePercent: 255, ..Default::default() };
        let b = from_status(&s);
        assert!(!b.present);
        assert_eq!(b.percent, None);
    }

    #[test]
    fn charging_laptop() {
        let s = SYSTEM_POWER_STATUS { ACLineStatus: 1, BatteryFlag: 8, BatteryLifePercent: 64, BatteryLifeTime: u32::MAX, ..Default::default() };
        let b = from_status(&s);
        assert!(b.present && b.charging && b.plugged_in);
        assert_eq!(b.percent, Some(64));
        assert_eq!(b.seconds_left, None);
    }
}
