//! Network throughput from GetIfTable2 octet counters, summed over physical adapters that are
//! up. Sampled every second while `system/network` has subscribers; one minute of history.

use std::collections::VecDeque;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use windows::Win32::Foundation::ERROR_SUCCESS;
use windows::Win32::NetworkManagement::IpHelper::{
    FreeMibTable, GetIfTable2, IF_TYPE_ETHERNET_CSMACD, IF_TYPE_IEEE80211, IF_TYPE_SOFTWARE_LOOPBACK, MIB_IF_ROW2,
    MIB_IF_TABLE2,
};
use windows::Win32::NetworkManagement::Ndis::IfOperStatusUp;

use crate::error::{SvcError, SvcResult};

const HISTORY_LEN: usize = 60;
const STALE_AFTER: Duration = Duration::from_secs(5);
/// IF_TYPE_WWANPP / IF_TYPE_WWANPP2 (mobile broadband).
const IF_TYPE_WWAN: [u32; 2] = [243, 244];

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Adapter {
    pub name: String,
    pub description: String,
    /// "wifi", "ethernet", "cellular" or "other".
    pub kind: String,
    pub up: bool,
    /// Link speed in bits per second.
    pub link_bps: u64,
    pub received: u64,
    pub sent: u64,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NetSample {
    /// Bytes per second.
    pub down: f64,
    pub up: f64,
    /// Oldest first, one per second, at most 60.
    pub down_history: Vec<f64>,
    pub up_history: Vec<f64>,
    /// Kind of the busiest adapter that is up ("wifi", "ethernet", ...), or "none".
    pub kind: String,
    pub at: i64,
}

struct State {
    prev: Option<(Instant, u64, u64)>,
    down: VecDeque<f64>,
    up: VecDeque<f64>,
}

static STATE: Mutex<State> = Mutex::new(State { prev: None, down: VecDeque::new(), up: VecDeque::new() });

fn kind_of(if_type: u32) -> &'static str {
    if if_type == IF_TYPE_IEEE80211 {
        "wifi"
    } else if if_type == IF_TYPE_ETHERNET_CSMACD {
        "ethernet"
    } else if IF_TYPE_WWAN.contains(&if_type) {
        "cellular"
    } else {
        "other"
    }
}

/// Physical adapters (hardware, not filter drivers, not loopback).
pub fn adapters() -> SvcResult<Vec<Adapter>> {
    let mut table: *mut MIB_IF_TABLE2 = std::ptr::null_mut();
    let status = unsafe { GetIfTable2(&mut table) };
    if status != ERROR_SUCCESS || table.is_null() {
        return Err(SvcError::Internal(format!("network counters unavailable (error {})", status.0)));
    }
    let mut out = Vec::new();
    unsafe {
        let count = (*table).NumEntries as usize;
        let rows: &[MIB_IF_ROW2] = std::slice::from_raw_parts((*table).Table.as_ptr(), count);
        for row in rows {
            let flags = row.InterfaceAndOperStatusFlags._bitfield;
            let hardware = flags & 0x01 != 0;
            let filter = flags & 0x02 != 0;
            if !hardware || filter || row.Type == IF_TYPE_SOFTWARE_LOOPBACK {
                continue;
            }
            out.push(Adapter {
                name: super::util::from_wide(&row.Alias),
                description: super::util::from_wide(&row.Description),
                kind: kind_of(row.Type).to_string(),
                up: row.OperStatus == IfOperStatusUp,
                link_bps: row.ReceiveLinkSpeed,
                received: row.InOctets,
                sent: row.OutOctets,
            });
        }
        FreeMibTable(table as *const core::ffi::c_void);
    }
    Ok(out)
}

pub fn sample() -> SvcResult<NetSample> {
    let list = adapters()?;
    let mut rx: u64 = 0;
    let mut tx: u64 = 0;
    let mut busiest: Option<(&Adapter, u64)> = None;
    for a in list.iter().filter(|a| a.up) {
        rx = rx.wrapping_add(a.received);
        tx = tx.wrapping_add(a.sent);
        let total = a.received.wrapping_add(a.sent);
        if busiest.map(|(_, t)| total > t).unwrap_or(true) {
            busiest = Some((a, total));
        }
    }
    let kind = busiest.map(|(a, _)| a.kind.clone()).unwrap_or_else(|| "none".to_string());
    let now = Instant::now();
    let mut s = STATE.lock().unwrap_or_else(|p| p.into_inner());
    let prev = s.prev;
    let (down, up) = match prev {
        Some((t, prx, ptx)) if t.elapsed() <= STALE_AFTER => {
            let secs = now.duration_since(t).as_secs_f64().max(0.05);
            // A counter that went backwards (adapter reset) reads as zero, not a huge spike.
            let d = if rx >= prx { (rx - prx) as f64 / secs } else { 0.0 };
            let u = if tx >= ptx { (tx - ptx) as f64 / secs } else { 0.0 };
            (d, u)
        }
        _ => {
            s.down.clear();
            s.up.clear();
            (0.0, 0.0)
        }
    };
    let first = s.prev.map(|(t, _, _)| t.elapsed() > STALE_AFTER).unwrap_or(true);
    s.prev = Some((now, rx, tx));
    if !first {
        s.down.push_back(down.round());
        s.up.push_back(up.round());
        while s.down.len() > HISTORY_LEN {
            s.down.pop_front();
        }
        while s.up.len() > HISTORY_LEN {
            s.up.pop_front();
        }
    }
    Ok(NetSample {
        down: down.round(),
        up: up.round(),
        down_history: s.down.iter().copied().collect(),
        up_history: s.up.iter().copied().collect(),
        kind,
        at: super::util::now_ms(),
    })
}
