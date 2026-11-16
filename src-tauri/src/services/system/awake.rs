//! Keep awake: a small thread holds ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED while on (the
//! execution state belongs to the thread that set it). Turned off on exit.

use std::sync::mpsc::{self, Sender};
use std::sync::Mutex;

use windows::Win32::System::Power::{
    SetThreadExecutionState, ES_CONTINUOUS, ES_DISPLAY_REQUIRED, ES_SYSTEM_REQUIRED, EXECUTION_STATE,
};

use crate::error::{SvcError, SvcResult};

static HOLDER: Mutex<Option<Sender<()>>> = Mutex::new(None);

pub fn is_on() -> bool {
    HOLDER.lock().unwrap_or_else(|p| p.into_inner()).is_some()
}

pub fn set(on: bool) -> SvcResult<()> {
    let mut guard = HOLDER.lock().unwrap_or_else(|p| p.into_inner());
    if !on {
        // Dropping the sender ends the thread, which clears its execution state.
        *guard = None;
        return Ok(());
    }
    if guard.is_some() {
        return Ok(());
    }
    let (tx, rx) = mpsc::channel::<()>();
    std::thread::Builder::new()
        .name("glintbar-keep-awake".into())
        .spawn(move || {
            unsafe {
                SetThreadExecutionState(EXECUTION_STATE(ES_CONTINUOUS.0 | ES_SYSTEM_REQUIRED.0 | ES_DISPLAY_REQUIRED.0));
            }
            // Blocks until the sender is dropped.
            let _ = rx.recv();
            unsafe {
                SetThreadExecutionState(ES_CONTINUOUS);
            }
        })
        .map_err(|e| SvcError::Internal(format!("keep-awake failed to start: {e}")))?;
    *guard = Some(tx);
    Ok(())
}

pub fn cleanup() {
    if let Ok(mut g) = HOLDER.lock() {
        *g = None;
    }
}
