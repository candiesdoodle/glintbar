//! Physical memory in use (GlobalMemoryStatusEx), sampled every 2 s while `system/memory` has
//! subscribers. Keeps two minutes of history.

use std::collections::VecDeque;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use windows::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};

use crate::error::SvcResult;

const HISTORY_LEN: usize = 60;
const STALE_AFTER: Duration = Duration::from_secs(10);

struct State {
    history: VecDeque<f32>,
    last_at: Option<Instant>,
}

static STATE: Mutex<State> = Mutex::new(State { history: VecDeque::new(), last_at: None });

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MemorySample {
    /// 0-100, physical memory in use.
    pub usage: f32,
    pub used: u64,
    pub total: u64,
    pub available: u64,
    pub commit_used: u64,
    pub commit_limit: u64,
    /// Oldest first, one value every 2 s, at most 60.
    pub history: Vec<f32>,
    pub at: i64,
}

pub fn read() -> SvcResult<MEMORYSTATUSEX> {
    let mut m = MEMORYSTATUSEX { dwLength: std::mem::size_of::<MEMORYSTATUSEX>() as u32, ..Default::default() };
    unsafe { GlobalMemoryStatusEx(&mut m)? };
    Ok(m)
}

pub fn sample() -> SvcResult<MemorySample> {
    let m = read()?;
    let total = m.ullTotalPhys;
    let available = m.ullAvailPhys;
    let used = total.saturating_sub(available);
    let usage = if total > 0 { ((used as f64 / total as f64) * 100.0) as f32 } else { 0.0 };
    let mut s = STATE.lock().unwrap_or_else(|p| p.into_inner());
    if s.last_at.map(|t| t.elapsed() > STALE_AFTER).unwrap_or(true) {
        s.history.clear();
    }
    s.last_at = Some(Instant::now());
    s.history.push_back((usage * 10.0).round() / 10.0);
    while s.history.len() > HISTORY_LEN {
        s.history.pop_front();
    }
    Ok(MemorySample {
        usage,
        used,
        total,
        available,
        commit_used: m.ullTotalPageFile.saturating_sub(m.ullAvailPageFile),
        commit_limit: m.ullTotalPageFile,
        history: s.history.iter().copied().collect(),
        at: super::util::now_ms(),
    })
}
