//! Per-app CPU and memory, the way Task Manager adds them up: processes with the same image
//! are summed, CPU is normalised to all logical processors, memory is the private working set.
//! Sampled every 2 s while `system/procs` has subscribers (Top CPU / Top RAM tiles).

use std::collections::HashMap;
use std::ffi::c_void;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use windows::core::{HSTRING, PWSTR};
use windows::Win32::Foundation::{CloseHandle, FILETIME, HANDLE};
use windows::Win32::Storage::FileSystem::{GetFileVersionInfoSizeW, GetFileVersionInfoW, VerQueryValueW};
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};
use windows::Win32::System::ProcessStatus::{GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS, PROCESS_MEMORY_COUNTERS_EX2};
use windows::Win32::System::Threading::{
    GetProcessTimes, OpenProcess, QueryFullProcessImageNameW, PROCESS_ACCESS_RIGHTS, PROCESS_NAME_WIN32,
    PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_VM_READ,
};

use crate::error::SvcResult;

const TOP_N: usize = 8;
const STALE_AFTER: Duration = Duration::from_secs(8);

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AppUsage {
    /// Friendly name (the file description), e.g. "Google Chrome".
    pub name: String,
    /// Image name, e.g. "chrome.exe".
    pub exe: String,
    /// 0-100 of the whole machine.
    pub cpu: f32,
    /// Private working set in bytes, summed over the app's processes.
    pub memory: u64,
    pub processes: u32,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ProcSample {
    /// Busiest first. Empty on the very first sample (CPU needs two readings).
    pub cpu: Vec<AppUsage>,
    /// Biggest first.
    pub ram: Vec<AppUsage>,
    pub process_count: u32,
    pub at: i64,
}

struct Known {
    created: u64,
    cpu_time: u64,
    key: String,
}

struct State {
    at: Option<Instant>,
    procs: HashMap<u32, Known>,
    /// image path (lower case) -> display name
    names: HashMap<String, String>,
}

static STATE: Mutex<Option<State>> = Mutex::new(None);

fn ft(f: FILETIME) -> u64 {
    ((f.dwHighDateTime as u64) << 32) | f.dwLowDateTime as u64
}

struct Proc {
    pid: u32,
    exe: String,
}

fn list() -> SvcResult<Vec<Proc>> {
    let mut out = Vec::new();
    unsafe {
        let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)?;
        let mut entry = PROCESSENTRY32W { dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32, ..Default::default() };
        if Process32FirstW(snap, &mut entry).is_ok() {
            loop {
                if entry.th32ProcessID != 0 {
                    out.push(Proc { pid: entry.th32ProcessID, exe: super::util::from_wide(&entry.szExeFile) });
                }
                if Process32NextW(snap, &mut entry).is_err() {
                    break;
                }
            }
        }
        let _ = CloseHandle(snap);
    }
    Ok(out)
}

fn image_path(h: HANDLE) -> Option<String> {
    let mut buf = [0u16; 1024];
    let mut len = buf.len() as u32;
    unsafe { QueryFullProcessImageNameW(h, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len) }.ok()?;
    Some(String::from_utf16_lossy(&buf[..len as usize]))
}

/// The FileDescription from the executable's version resource.
fn file_description(path: &str) -> Option<String> {
    let wpath = HSTRING::from(path);
    unsafe {
        let size = GetFileVersionInfoSizeW(&wpath, None);
        if size == 0 {
            return None;
        }
        let mut data = vec![0u8; size as usize];
        GetFileVersionInfoW(&wpath, None, size, data.as_mut_ptr() as *mut c_void).ok()?;
        let mut ptr: *mut c_void = std::ptr::null_mut();
        let mut len: u32 = 0;
        let mut lang: (u16, u16) = (0x0409, 0x04B0);
        let translation = HSTRING::from("\\VarFileInfo\\Translation");
        if VerQueryValueW(data.as_ptr() as *const c_void, &translation, &mut ptr, &mut len).as_bool() && len >= 4 && !ptr.is_null() {
            let words = ptr as *const u16;
            lang = (*words, *words.add(1));
        }
        let sub = HSTRING::from(format!("\\StringFileInfo\\{:04x}{:04x}\\FileDescription", lang.0, lang.1));
        ptr = std::ptr::null_mut();
        len = 0;
        if !VerQueryValueW(data.as_ptr() as *const c_void, &sub, &mut ptr, &mut len).as_bool() || len == 0 || ptr.is_null() {
            return None;
        }
        let chars = std::slice::from_raw_parts(ptr as *const u16, len as usize);
        let text = super::util::from_wide(chars).trim().to_string();
        if text.is_empty() {
            None
        } else {
            Some(text)
        }
    }
}

fn stem(exe: &str) -> String {
    let s = exe.strip_suffix(".exe").or_else(|| exe.strip_suffix(".EXE")).unwrap_or(exe);
    let mut c = s.chars();
    match c.next() {
        Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
        None => exe.to_string(),
    }
}

pub fn sample() -> SvcResult<ProcSample> {
    let procs = list()?;
    let cores = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1) as f64;
    let mut guard = STATE.lock().unwrap_or_else(|p| p.into_inner());
    let state = guard.get_or_insert_with(|| State { at: None, procs: HashMap::new(), names: HashMap::new() });
    let now = Instant::now();
    let elapsed = match state.at {
        Some(t) if t.elapsed() <= STALE_AFTER => Some(now.duration_since(t)),
        _ => None,
    };

    struct Row {
        name: String,
        exe: String,
        cpu: f64,
        memory: u64,
        processes: u32,
    }
    let mut apps: HashMap<String, Row> = HashMap::new();
    let mut next: HashMap<u32, Known> = HashMap::with_capacity(procs.len());

    for p in &procs {
        // Memory counters want VM_READ too; elevated or protected processes only allow the
        // limited right, which still gives CPU times.
        let full = PROCESS_ACCESS_RIGHTS(PROCESS_QUERY_LIMITED_INFORMATION.0 | PROCESS_VM_READ.0);
        let handle = match unsafe { OpenProcess(full, false, p.pid) } {
            Ok(h) => h,
            Err(_) => match unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, p.pid) } {
                Ok(h) => h,
                Err(_) => continue,
            },
        };
        let mut created = FILETIME::default();
        let mut exited = FILETIME::default();
        let mut kernel = FILETIME::default();
        let mut user = FILETIME::default();
        let times_ok = unsafe { GetProcessTimes(handle, &mut created, &mut exited, &mut kernel, &mut user) }.is_ok();
        let mut counters = PROCESS_MEMORY_COUNTERS_EX2 { cb: std::mem::size_of::<PROCESS_MEMORY_COUNTERS_EX2>() as u32, ..Default::default() };
        let memory = unsafe {
            if GetProcessMemoryInfo(
                handle,
                &mut counters as *mut PROCESS_MEMORY_COUNTERS_EX2 as *mut PROCESS_MEMORY_COUNTERS,
                std::mem::size_of::<PROCESS_MEMORY_COUNTERS_EX2>() as u32,
            )
            .is_ok()
            {
                counters.PrivateWorkingSetSize as u64
            } else {
                // Windows 10 before 1809 has no private working set: fall back to the working set.
                let mut basic = PROCESS_MEMORY_COUNTERS { cb: std::mem::size_of::<PROCESS_MEMORY_COUNTERS>() as u32, ..Default::default() };
                if GetProcessMemoryInfo(handle, &mut basic, std::mem::size_of::<PROCESS_MEMORY_COUNTERS>() as u32).is_ok() {
                    basic.WorkingSetSize as u64
                } else {
                    0
                }
            }
        };
        let created_at = ft(created);
        let cpu_time = ft(kernel) + ft(user);

        let previous = state.procs.get(&p.pid).filter(|k| k.created == created_at);
        let key = match previous {
            Some(k) => k.key.clone(),
            None => match image_path(handle) {
                Some(path) => path.to_lowercase(),
                None => p.exe.to_lowercase(),
            },
        };
        if !state.names.contains_key(&key) {
            let name = if key.contains('\\') { file_description(&key) } else { None };
            let name = name.unwrap_or_else(|| stem(&p.exe));
            if state.names.len() > 2000 {
                state.names.clear();
            }
            state.names.insert(key.clone(), name);
        }
        let cpu = match (elapsed, previous, times_ok) {
            (Some(dt), Some(k), true) => {
                let wall = dt.as_nanos() as f64 / 100.0 * cores;
                if wall > 0.0 {
                    (cpu_time.saturating_sub(k.cpu_time) as f64 / wall * 100.0).clamp(0.0, 100.0)
                } else {
                    0.0
                }
            }
            _ => 0.0,
        };
        unsafe {
            let _ = CloseHandle(handle);
        }
        if times_ok {
            next.insert(p.pid, Known { created: created_at, cpu_time, key: key.clone() });
        }
        let name = state.names.get(&key).cloned().unwrap_or_else(|| stem(&p.exe));
        let row = apps.entry(key).or_insert_with(|| Row { name, exe: p.exe.clone(), cpu: 0.0, memory: 0, processes: 0 });
        row.cpu += cpu;
        row.memory += memory;
        row.processes += 1;
    }
    state.procs = next;
    state.at = Some(now);
    let have_cpu = elapsed.is_some();
    drop(guard);

    let mut rows: Vec<Row> = apps.into_values().collect();
    let to_usage = |r: &Row| AppUsage {
        name: r.name.clone(),
        exe: r.exe.clone(),
        cpu: ((r.cpu.min(100.0) * 10.0).round() / 10.0) as f32,
        memory: r.memory,
        processes: r.processes,
    };
    let mut ram: Vec<AppUsage> = Vec::new();
    rows.sort_by(|a, b| b.memory.cmp(&a.memory));
    for r in rows.iter().take(TOP_N) {
        ram.push(to_usage(r));
    }
    let mut cpu: Vec<AppUsage> = Vec::new();
    if have_cpu {
        rows.sort_by(|a, b| b.cpu.partial_cmp(&a.cpu).unwrap_or(std::cmp::Ordering::Equal));
        for r in rows.iter().take(TOP_N) {
            cpu.push(to_usage(r));
        }
    }
    Ok(ProcSample { cpu, ram, process_count: procs.len() as u32, at: super::util::now_ms() })
}

#[cfg(test)]
mod tests {
    use super::stem;

    #[test]
    fn stems_are_capitalised() {
        assert_eq!(stem("chrome.exe"), "Chrome");
        assert_eq!(stem("Code.exe"), "Code");
    }
}
