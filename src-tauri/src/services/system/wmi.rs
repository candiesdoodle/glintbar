//! Minimal WMI client. Call only from a `com::Worker` thread (COM is initialised there);
//! connections are cached per namespace on that thread.

use std::cell::RefCell;

use windows::core::{BSTR, HSTRING};
use windows::Win32::System::Com::{
    CoCreateInstance, CoSetProxyBlanket, CLSCTX_INPROC_SERVER, EOAC_NONE, RPC_C_AUTHN_LEVEL_CALL,
    RPC_C_IMP_LEVEL_IMPERSONATE,
};
use windows::Win32::System::Variant::VARIANT;
use windows::Win32::System::Wmi::{
    IWbemClassObject, IWbemLocator, IWbemServices, WbemLocator, WBEM_FLAG_FORWARD_ONLY, WBEM_FLAG_RETURN_IMMEDIATELY,
    WBEM_GENERIC_FLAG_TYPE,
};

use crate::error::{SvcError, SvcResult};

thread_local! {
    static CACHE: RefCell<Vec<(String, IWbemServices)>> = const { RefCell::new(Vec::new()) };
}

/// Drops cached connections (the worker calls this before CoUninitialize).
pub fn clear_cache() {
    CACHE.with(|c| c.borrow_mut().clear());
}

/// 10 = RPC_C_AUTHN_WINNT, 0 = RPC_C_AUTHZ_NONE.
const AUTHN_WINNT: u32 = 10;
const AUTHZ_NONE: u32 = 0;

pub fn connect(namespace: &str) -> SvcResult<IWbemServices> {
    let cached = CACHE.with(|c| c.borrow().iter().find(|(n, _)| n == namespace).map(|(_, s)| s.clone()));
    if let Some(s) = cached {
        return Ok(s);
    }
    let services = unsafe {
        let locator: IWbemLocator = CoCreateInstance(&WbemLocator, None, CLSCTX_INPROC_SERVER)
            .map_err(|e| SvcError::Unsupported(format!("WMI unavailable: {e}")))?;
        let services = locator
            .ConnectServer(&BSTR::from(namespace), &BSTR::new(), &BSTR::new(), &BSTR::new(), 0, &BSTR::new(), None)
            .map_err(|e| SvcError::Unsupported(format!("WMI namespace {namespace} unreachable: {e}")))?;
        CoSetProxyBlanket(
            &services,
            AUTHN_WINNT,
            AUTHZ_NONE,
            None,
            RPC_C_AUTHN_LEVEL_CALL,
            RPC_C_IMP_LEVEL_IMPERSONATE,
            None,
            EOAC_NONE,
        )
        .map_err(|e| SvcError::Internal(format!("WMI security: {e}")))?;
        services
    };
    CACHE.with(|c| c.borrow_mut().push((namespace.to_string(), services.clone())));
    Ok(services)
}

/// How long one `Next` may wait for WMI. A finite wait keeps a hung provider from blocking the
/// shared worker thread forever (WBEM_S_TIMEDOUT comes back as success with nothing returned).
const NEXT_TIMEOUT_MS: i32 = 10_000;

/// Runs a WQL query and returns every object (bounded to 64).
pub fn query(services: &IWbemServices, wql: &str) -> SvcResult<Vec<IWbemClassObject>> {
    let flags = WBEM_GENERIC_FLAG_TYPE(WBEM_FLAG_FORWARD_ONLY.0 | WBEM_FLAG_RETURN_IMMEDIATELY.0);
    let list = unsafe { services.ExecQuery(&BSTR::from("WQL"), &BSTR::from(wql), flags, None) }.map_err(map_wmi)?;
    let mut out = Vec::new();
    for _ in 0..64 {
        let mut row: [Option<IWbemClassObject>; 1] = [None];
        let mut returned: u32 = 0;
        let hr = unsafe { list.Next(NEXT_TIMEOUT_MS, &mut row, &mut returned) };
        if hr.is_err() {
            if out.is_empty() {
                return Err(map_wmi(windows::core::Error::from(hr)));
            }
            break;
        }
        if returned == 0 {
            break;
        }
        match row[0].take() {
            Some(obj) => out.push(obj),
            None => break,
        }
    }
    Ok(out)
}

/// Access denied from WMI means "needs administrator".
pub fn map_wmi(e: windows::core::Error) -> SvcError {
    // WBEM_E_ACCESS_DENIED = 0x80041003, E_ACCESSDENIED = 0x80070005
    let code = e.code().0 as u32;
    if code == 0x8004_1003 || code == 0x8007_0005 {
        SvcError::Denied("this needs administrator rights in Windows".into())
    } else if code == 0x8004_1010 || code == 0x8004_1017 {
        // WBEM_E_INVALID_CLASS / WBEM_E_INVALID_QUERY
        SvcError::Unsupported("Windows doesn't provide that data on this PC".into())
    } else {
        SvcError::Internal(format!("WMI: {e}"))
    }
}

pub fn get(obj: &IWbemClassObject, name: &str) -> Option<VARIANT> {
    let mut value = VARIANT::default();
    let n = HSTRING::from(name);
    unsafe { obj.Get(&n, 0, &mut value, None, None) }.ok()?;
    if value.is_empty() {
        return None;
    }
    Some(value)
}

pub fn get_u32(obj: &IWbemClassObject, name: &str) -> Option<u32> {
    let v = get(obj, name)?;
    u32::try_from(&v).ok()
}

pub fn get_bool(obj: &IWbemClassObject, name: &str) -> Option<bool> {
    let v = get(obj, name)?;
    bool::try_from(&v).ok()
}

pub fn get_string(obj: &IWbemClassObject, name: &str) -> Option<String> {
    let v = get(obj, name)?;
    BSTR::try_from(&v).ok().map(|b| b.to_string())
}
