//! Total CPU load from GetSystemTimes, sampled once a second while `system/cpu` has subscribers.
//! Keeps the last 60 samples so a card opened later still shows a minute of history.

use std::collections::VecDeque;
use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::error::SvcResult;

pub const HISTORY_LEN: usize = 60;
/// After a pause longer than this the old history no longer describes "the last minute".
const STALE_AFTER: Duration = Duration::from_secs(5);

#[derive(Clone, Copy, Debug)]
struct Times {
    idle: u64,
    kernel: u64,
    user: u64,
}

struct Sampler {
    prev: Option<Times>,
    last_at: Option<Instant>,
    last_usage: Option<f32>,
    history: VecDeque<f32>,
}

static SAMPLER: Mutex<Sampler> =
    Mutex::new(Sampler { prev: None, last_at: None, last_usage: None, history: VecDeque::new() });

fn lock() -> MutexGuard<'static, Sampler> {
    SAMPLER.lock().unwrap_or_else(|p| p.into_inner())
}

/// Payload of the `svc://system/cpu` event.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CpuSample {
    /// 0-100
    pub usage: f32,
    /// Oldest first, one value per second, at most 60.
    pub history: Vec<f32>,
    /// Unix ms
    pub at: i64,
}

/// Result of `system.cpu_info`.
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CpuInfo {
    pub name: String,
    pub logical_cores: usize,
    pub base_mhz: Option<u32>,
    pub uptime_secs: u64,
    pub usage: Option<f32>,
}

fn usage_between(a: Times, b: Times) -> Option<f32> {
    let idle = b.idle.saturating_sub(a.idle);
    // Kernel time includes idle time.
    let total = b.kernel.saturating_sub(a.kernel) + b.user.saturating_sub(a.user);
    if total == 0 {
        return None;
    }
    let busy = total.saturating_sub(idle);
    Some(((busy as f64 / total as f64) * 100.0).clamp(0.0, 100.0) as f32)
}

fn is_stale(last_at: Option<Instant>) -> bool {
    match last_at {
        Some(t) => t.elapsed() > STALE_AFTER,
        None => true,
    }
}

pub async fn sample() -> SvcResult<CpuSample> {
    let needs_baseline = {
        let s = lock();
        s.prev.is_none() || is_stale(s.last_at)
    };
    if needs_baseline {
        let base = read_times()?;
        {
            let mut s = lock();
            s.prev = Some(base);
            s.last_at = Some(Instant::now());
            s.history.clear();
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
    let now = read_times()?;
    let mut s = lock();
    let usage = s.prev.and_then(|p| usage_between(p, now)).or(s.last_usage).unwrap_or(0.0);
    s.prev = Some(now);
    s.last_at = Some(Instant::now());
    s.last_usage = Some(usage);
    s.history.push_back(usage);
    while s.history.len() > HISTORY_LEN {
        s.history.pop_front();
    }
    Ok(CpuSample { usage, history: s.history.iter().copied().collect(), at: chrono::Utc::now().timestamp_millis() })
}

pub fn info() -> SvcResult<CpuInfo> {
    Ok(CpuInfo {
        name: cpu_name().unwrap_or_else(|| "Processor".to_string()),
        logical_cores: std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1),
        base_mhz: cpu_mhz(),
        uptime_secs: uptime_secs(),
        usage: lock().last_usage,
    })
}

#[cfg(windows)]
fn read_times() -> SvcResult<Times> {
    use windows::Win32::Foundation::FILETIME;
    use windows::Win32::System::Threading::GetSystemTimes;

    fn to_u64(f: FILETIME) -> u64 {
        ((f.dwHighDateTime as u64) << 32) | f.dwLowDateTime as u64
    }

    let mut idle = FILETIME::default();
    let mut kernel = FILETIME::default();
    let mut user = FILETIME::default();
    unsafe {
        GetSystemTimes(
            Some(&mut idle as *mut FILETIME),
            Some(&mut kernel as *mut FILETIME),
            Some(&mut user as *mut FILETIME),
        )?;
    }
    Ok(Times { idle: to_u64(idle), kernel: to_u64(kernel), user: to_u64(user) })
}

#[cfg(not(windows))]
fn read_times() -> SvcResult<Times> {
    Err(crate::error::SvcError::unsupported("CPU readings need Windows"))
}

#[cfg(windows)]
const CPU_KEY: &str = r"HARDWARE\DESCRIPTION\System\CentralProcessor\0";

#[cfg(windows)]
fn cpu_name() -> Option<String> {
    use windows::Win32::System::Registry::HKEY_LOCAL_MACHINE;
    crate::win::reg_string(HKEY_LOCAL_MACHINE, CPU_KEY, "ProcessorNameString")
}

#[cfg(windows)]
fn cpu_mhz() -> Option<u32> {
    use windows::Win32::System::Registry::HKEY_LOCAL_MACHINE;
    crate::win::reg_dword(HKEY_LOCAL_MACHINE, CPU_KEY, "~MHz")
}

#[cfg(windows)]
fn uptime_secs() -> u64 {
    unsafe { windows::Win32::System::SystemInformation::GetTickCount64() / 1000 }
}

#[cfg(not(windows))]
fn cpu_name() -> Option<String> {
    None
}

#[cfg(not(windows))]
fn cpu_mhz() -> Option<u32> {
    None
}

#[cfg(not(windows))]
fn uptime_secs() -> u64 {
    0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn usage_is_busy_share_of_total() {
        let a = Times { idle: 100, kernel: 200, user: 100 };
        // +60 idle, +100 kernel (incl. idle), +100 user => busy 140 of 200 = 70 %
        let b = Times { idle: 160, kernel: 300, user: 200 };
        assert_eq!(usage_between(a, b), Some(70.0));
        assert_eq!(usage_between(a, a), None);
    }
}
