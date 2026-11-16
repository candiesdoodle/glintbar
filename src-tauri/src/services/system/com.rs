//! Dedicated COM threads. WMI, Core Audio and WinRT device calls run here, on a thread that
//! called CoInitializeEx(MTA) once, instead of on the shared blocking pool. A worker starts on
//! the first job and exits after a minute without work, so nothing stays alive while idle.

use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::Mutex;
use std::time::Duration;

use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_MULTITHREADED};

use crate::error::{SvcError, SvcResult};

type Job = Box<dyn FnOnce() + Send + 'static>;

const IDLE: Duration = Duration::from_secs(60);

pub struct Worker {
    name: &'static str,
    tx: Mutex<Option<Sender<Job>>>,
}

/// WMI queries (temperature, laptop brightness) and DDC/CI.
pub static WMI: Worker = Worker::new("glintbar-wmi");
/// Everything else that needs COM / WinRT (radios, audio, Bluetooth, hotspot).
pub static COM: Worker = Worker::new("glintbar-com");

impl Worker {
    pub const fn new(name: &'static str) -> Worker {
        Worker { name, tx: Mutex::new(None) }
    }

    /// Runs `f` on this worker's thread and waits for its result.
    pub fn run<T, F>(&'static self, timeout: Duration, f: F) -> SvcResult<T>
    where
        T: Send + 'static,
        F: FnOnce() -> SvcResult<T> + Send + 'static,
    {
        let (rtx, rrx) = mpsc::channel::<SvcResult<T>>();
        let job: Job = Box::new(move || {
            let _ = rtx.send(f());
        });
        self.submit(job)?;
        match rrx.recv_timeout(timeout) {
            Ok(result) => result,
            Err(RecvTimeoutError::Timeout) => Err(SvcError::Timeout(format!("{} timed out", self.name))),
            Err(RecvTimeoutError::Disconnected) => Err(SvcError::Internal(format!("{} exited before replying", self.name))),
        }
    }

    fn submit(&'static self, job: Job) -> SvcResult<()> {
        let mut guard = self.tx.lock().unwrap_or_else(|p| p.into_inner());
        let job = match guard.as_ref() {
            Some(tx) => match tx.send(job) {
                Ok(()) => return Ok(()),
                // The thread exited (idle or a panic): start a new one with this job.
                Err(mpsc::SendError(job)) => job,
            },
            None => job,
        };
        let (tx, rx) = mpsc::channel::<Job>();
        let _ = tx.send(job);
        let me: &'static Worker = self;
        std::thread::Builder::new()
            .name(self.name.to_string())
            .spawn(move || me.serve(rx))
            .map_err(|e| SvcError::Internal(format!("{} failed to start: {e}", self.name)))?;
        *guard = Some(tx);
        Ok(())
    }

    fn serve(&'static self, rx: Receiver<Job>) {
        let initialized = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }.is_ok();
        loop {
            match rx.recv_timeout(IDLE) {
                Ok(job) => job(),
                Err(RecvTimeoutError::Timeout) => {
                    // Senders hold the lock while sending, so checking again under it is race-free.
                    let mut guard = self.tx.lock().unwrap_or_else(|p| p.into_inner());
                    match rx.try_recv() {
                        Ok(job) => {
                            drop(guard);
                            job();
                        }
                        Err(_) => {
                            *guard = None;
                            break;
                        }
                    }
                }
                Err(RecvTimeoutError::Disconnected) => break,
            }
        }
        // COM objects cached on this thread must go before CoUninitialize.
        super::wmi::clear_cache();
        if initialized {
            unsafe { CoUninitialize() };
        }
    }
}
