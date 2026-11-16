//! Cleanup that must happen however the app ends: restoring the Windows taskbar, releasing
//! the reserved screen space, flushing the store.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;

use crate::registry::CleanupHook;

static HOOKS: OnceLock<Vec<CleanupHook>> = OnceLock::new();
static DONE: AtomicBool = AtomicBool::new(false);

pub(crate) fn set_cleanup_hooks(hooks: Vec<CleanupHook>) {
    let _ = HOOKS.set(hooks);
}

/// True once cleanup has started: nothing may hide the taskbar or reserve screen space again.
pub fn is_cleaning_up() -> bool {
    DONE.load(Ordering::SeqCst)
}

/// Runs every cleanup hook once. Safe to call from any thread, any number of times.
pub fn run_cleanup(reason: &str) {
    if DONE.swap(true, Ordering::SeqCst) {
        return;
    }
    tracing::info!(%reason, "cleaning up");
    if let Some(hooks) = HOOKS.get() {
        for hook in hooks {
            let hook = hook.clone();
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(move || hook()));
            if result.is_err() {
                tracing::error!("a cleanup hook panicked");
            }
        }
    }
}

/// Logs every panic. A panic on the main thread ends the event loop, so it also runs cleanup
/// (the taskbar must come back). Panics in async handlers are caught by tokio and only logged.
pub fn install_panic_hook() {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let thread = std::thread::current();
        let name = thread.name().unwrap_or("unnamed").to_string();
        tracing::error!(thread = %name, "panic: {info}");
        if name == "main" {
            run_cleanup("panic");
        }
        previous(info);
    }));
}
