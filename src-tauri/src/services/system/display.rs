//! Display mode (PC screen only / Duplicate / Extend / Second screen only), like Win+P.

use windows::Win32::Devices::Display::{
    GetDisplayConfigBufferSizes, QueryDisplayConfig, SetDisplayConfig, DISPLAYCONFIG_MODE_INFO, DISPLAYCONFIG_PATH_INFO,
    DISPLAYCONFIG_TOPOLOGY_CLONE, DISPLAYCONFIG_TOPOLOGY_EXTEND, DISPLAYCONFIG_TOPOLOGY_EXTERNAL, DISPLAYCONFIG_TOPOLOGY_ID,
    DISPLAYCONFIG_TOPOLOGY_INTERNAL, QDC_DATABASE_CURRENT, SDC_APPLY, SDC_TOPOLOGY_CLONE, SDC_TOPOLOGY_EXTEND,
    SDC_TOPOLOGY_EXTERNAL, SDC_TOPOLOGY_INTERNAL, SET_DISPLAY_CONFIG_FLAGS,
};
use windows::Win32::Foundation::ERROR_SUCCESS;

use crate::error::{SvcError, SvcResult};

/// "internal", "clone", "extend" or "external"; None when Windows doesn't say.
pub fn mode() -> Option<String> {
    let mut paths_n: u32 = 0;
    let mut modes_n: u32 = 0;
    unsafe {
        if GetDisplayConfigBufferSizes(QDC_DATABASE_CURRENT, &mut paths_n, &mut modes_n) != ERROR_SUCCESS {
            return None;
        }
        let mut paths = vec![DISPLAYCONFIG_PATH_INFO::default(); paths_n.max(1) as usize];
        let mut modes = vec![DISPLAYCONFIG_MODE_INFO::default(); modes_n.max(1) as usize];
        let mut topology = DISPLAYCONFIG_TOPOLOGY_ID::default();
        let status = QueryDisplayConfig(
            QDC_DATABASE_CURRENT,
            &mut paths_n,
            paths.as_mut_ptr(),
            &mut modes_n,
            modes.as_mut_ptr(),
            Some(&mut topology as *mut DISPLAYCONFIG_TOPOLOGY_ID),
        );
        if status != ERROR_SUCCESS {
            return None;
        }
        let name = if topology == DISPLAYCONFIG_TOPOLOGY_INTERNAL {
            "internal"
        } else if topology == DISPLAYCONFIG_TOPOLOGY_CLONE {
            "clone"
        } else if topology == DISPLAYCONFIG_TOPOLOGY_EXTEND {
            "extend"
        } else if topology == DISPLAYCONFIG_TOPOLOGY_EXTERNAL {
            "external"
        } else {
            return None;
        };
        Some(name.to_string())
    }
}

pub fn set_mode(mode: &str) -> SvcResult<()> {
    let topology = match mode {
        "internal" => SDC_TOPOLOGY_INTERNAL,
        "clone" => SDC_TOPOLOGY_CLONE,
        "extend" => SDC_TOPOLOGY_EXTEND,
        "external" => SDC_TOPOLOGY_EXTERNAL,
        _ => return Err(SvcError::bad_args("unknown display mode")),
    };
    let status = unsafe { SetDisplayConfig(None, None, SET_DISPLAY_CONFIG_FLAGS(SDC_APPLY.0 | topology.0)) };
    if status == 0 {
        Ok(())
    } else {
        Err(SvcError::Unsupported("this mode requires a second display".into()))
    }
}
