//! Do not disturb. Windows has no public API for it; it is kept in the shell's "quiet hours"
//! notification state (a WNF state name), which ntdll lets a desktop app read and write.
//! Every write is checked by reading it back; callers fall back to opening Settings when this
//! doesn't work on a given Windows build.

use std::ffi::c_void;

use windows::core::{s, w};
use windows::Win32::System::LibraryLoader::{GetModuleHandleW, GetProcAddress};

/// WNF_SHEL_QUIETHOURS_ACTIVE_PROFILE_CHANGED
const QUIET_HOURS: u64 = 0x0D83_063E_A3BF_1C75;
/// 0 = off, 1 = priority only, 2 = alarms only.
const PRIORITY_ONLY: u32 = 1;

type QueryFn = unsafe extern "system" fn(
    state_name: *const u64,
    type_id: *const c_void,
    explicit_scope: *const c_void,
    change_stamp: *mut u32,
    buffer: *mut c_void,
    buffer_size: *mut u32,
) -> i32;

type UpdateFn = unsafe extern "system" fn(
    state_name: *const u64,
    buffer: *const c_void,
    length: u32,
    type_id: *const c_void,
    explicit_scope: *const c_void,
    matching_change_stamp: u32,
    check_stamp: u32,
) -> i32;

fn functions() -> Option<(QueryFn, UpdateFn)> {
    unsafe {
        let ntdll = GetModuleHandleW(w!("ntdll.dll")).ok()?;
        let query = GetProcAddress(ntdll, s!("NtQueryWnfStateData"))?;
        let update = GetProcAddress(ntdll, s!("NtUpdateWnfStateData"))?;
        let query: QueryFn = std::mem::transmute::<unsafe extern "system" fn() -> isize, QueryFn>(query);
        let update: UpdateFn = std::mem::transmute::<unsafe extern "system" fn() -> isize, UpdateFn>(update);
        Some((query, update))
    }
}

/// (profile, change stamp), or None when the state can't be read on this Windows build
/// (including a payload of an unexpected size, which reads as an error status).
fn read_state(query: QueryFn) -> Option<(u32, u32)> {
    let name = QUIET_HOURS;
    let mut stamp: u32 = 0;
    let mut value: u32 = 0;
    let mut size: u32 = 4;
    let status = unsafe {
        query(&name, std::ptr::null(), std::ptr::null(), &mut stamp, &mut value as *mut u32 as *mut c_void, &mut size)
    };
    if status < 0 || size > 4 {
        return None;
    }
    // An empty state (never set since sign-in) means off.
    Some((if size == 4 { value } else { 0 }, stamp))
}

/// None when the state can't be read on this Windows build.
pub fn is_on() -> Option<bool> {
    let (query, _) = functions()?;
    read_state(query).map(|(value, _)| value != 0)
}

/// True when the new state reads back as asked. Never writes a state it couldn't read first,
/// only writes if nobody changed it in between (change-stamp check), and puts the old value
/// back when the shell didn't keep the new one.
pub fn set(on: bool) -> bool {
    let Some((query, update)) = functions() else { return false };
    let Some((before, stamp)) = read_state(query) else { return false };
    if (before != 0) == on {
        return true;
    }
    let name = QUIET_HOURS;
    let value: u32 = if on { PRIORITY_ONLY } else { 0 };
    let status = unsafe { update(&name, &value as *const u32 as *const c_void, 4, std::ptr::null(), std::ptr::null(), stamp, 1) };
    if status < 0 {
        return false;
    }
    std::thread::sleep(std::time::Duration::from_millis(300));
    match read_state(query) {
        Some((now, _)) if (now != 0) == on => true,
        _ => {
            let _ = unsafe { update(&name, &before as *const u32 as *const c_void, 4, std::ptr::null(), std::ptr::null(), 0, 0) };
            false
        }
    }
}
