//! File logging to %APPDATA%\\GlintBar\\logs\\glintbar.log, rotated to glintbar.1.log at 2 MB.

use std::fs::{File, OpenOptions};
use std::io::{self, Write};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use crate::paths;

const MAX_BYTES: u64 = 2 * 1024 * 1024;

struct Inner {
    path: PathBuf,
    file: Option<File>,
    size: u64,
}

impl Inner {
    fn open(&mut self) {
        match OpenOptions::new().create(true).append(true).open(&self.path) {
            Ok(f) => {
                self.size = f.metadata().map(|m| m.len()).unwrap_or(0);
                self.file = Some(f);
            }
            Err(_) => self.file = None,
        }
    }

    fn rotate(&mut self) {
        self.file = None;
        let old = self.path.with_file_name("glintbar.1.log");
        let _ = std::fs::remove_file(&old);
        let _ = std::fs::rename(&self.path, &old);
        self.size = 0;
        self.open();
    }
}

#[derive(Clone)]
pub struct CappedWriter(Arc<Mutex<Inner>>);

impl Write for CappedWriter {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        let mut inner = self.0.lock().unwrap_or_else(|p| p.into_inner());
        if inner.size + buf.len() as u64 > MAX_BYTES {
            inner.rotate();
        }
        if let Some(f) = inner.file.as_mut() {
            f.write_all(buf)?;
        }
        inner.size += buf.len() as u64;
        Ok(buf.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        let mut inner = self.0.lock().unwrap_or_else(|p| p.into_inner());
        match inner.file.as_mut() {
            Some(f) => f.flush(),
            None => Ok(()),
        }
    }
}

pub fn log_file_path() -> PathBuf {
    paths::logs_dir().join("glintbar.log")
}

pub fn init() {
    let mut inner = Inner { path: log_file_path(), file: None, size: 0 };
    inner.open();
    let writer = CappedWriter(Arc::new(Mutex::new(inner)));
    let level = if cfg!(debug_assertions) { tracing::Level::DEBUG } else { tracing::Level::INFO };
    let result = tracing_subscriber::fmt()
        .with_writer(move || writer.clone())
        .with_ansi(false)
        .with_target(true)
        .with_max_level(level)
        .try_init();
    if result.is_err() {
        eprintln!("logging was already initialised");
    }
}
