//! COM apartment setup for the threads that call Core Audio and WinRT.

/// Joins the multithreaded apartment once per thread (pool threads are reused, so this runs at
/// most once on each). Never uninitialises: the threads live as long as the app.
#[cfg(windows)]
pub fn init_thread() {
    use std::cell::Cell;
    use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};

    thread_local! {
        static READY: Cell<bool> = const { Cell::new(false) };
    }
    READY.with(|ready| {
        if !ready.get() {
            // S_FALSE (already initialised) and RPC_E_CHANGED_MODE are both fine here.
            let _ = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
            ready.set(true);
        }
    });
}

#[cfg(not(windows))]
pub fn init_thread() {}
