//! Native crashes (access violations and the like) skip Rust's panic hook. An unhandled-exception
//! filter still gets to bring the taskbar back and release the reserved strip before Windows
//! ends the process. (A crash that leaves it hidden anyway is repaired on the next start.)

use windows::Win32::System::Diagnostics::Debug::{SetUnhandledExceptionFilter, EXCEPTION_POINTERS};

unsafe extern "system" fn on_crash(_info: *const EXCEPTION_POINTERS) -> i32 {
    crate::lifecycle::run_cleanup("crash");
    // EXCEPTION_CONTINUE_SEARCH: let Windows report the crash as usual.
    0
}

pub fn install() {
    unsafe {
        let _ = SetUnhandledExceptionFilter(Some(on_crash));
    }
}
