//! JSON key-value store persisted to %APPDATA%\\GlintBar\\store.json.
//! Writes are throttled (at most one every 500 ms) and atomic (temp file + rename);
//! a final flush runs on exit. Every change emits `svc://store/changed` {key, value}.
//!
//! Rust callers: `store::get_value("dock")`, `store::set_value(&app, "key", json!(..))`.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, MutexGuard, OnceLock};
use std::time::Duration;

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use tauri::AppHandle;

use crate::error::{SvcError, SvcResult};
use crate::events;
use crate::paths;
use crate::registry::{run_blocking, NoArgs, Registrar};

pub struct Store {
    path: PathBuf,
    data: Mutex<Map<String, Value>>,
    write_lock: Mutex<()>,
    dirty: AtomicBool,
    scheduled: AtomicBool,
}

static STORE: OnceLock<Store> = OnceLock::new();

pub fn store() -> &'static Store {
    STORE.get_or_init(|| Store::load(paths::data_dir().join("store.json")))
}

impl Store {
    fn load(path: PathBuf) -> Store {
        let data = match std::fs::read(&path) {
            Ok(bytes) => match serde_json::from_slice::<Value>(&bytes) {
                Ok(Value::Object(map)) => map,
                _ => {
                    let backup = path.with_file_name(format!(
                        "store.corrupt-{}.json",
                        chrono::Local::now().format("%Y%m%d-%H%M%S")
                    ));
                    tracing::warn!("store.json is unreadable; moved it to {}", backup.display());
                    let _ = std::fs::rename(&path, &backup);
                    Map::new()
                }
            },
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Map::new(),
            Err(e) => {
                tracing::warn!("could not read store.json: {e}");
                Map::new()
            }
        };
        Store {
            path,
            data: Mutex::new(data),
            write_lock: Mutex::new(()),
            dirty: AtomicBool::new(false),
            scheduled: AtomicBool::new(false),
        }
    }

    fn lock(&self) -> MutexGuard<'_, Map<String, Value>> {
        self.data.lock().unwrap_or_else(|p| p.into_inner())
    }

    pub fn get(&self, key: &str) -> Option<Value> {
        self.lock().get(key).cloned()
    }

    pub fn all(&self) -> Map<String, Value> {
        self.lock().clone()
    }

    /// Returns true when the stored value changed.
    pub fn set(&self, key: &str, value: Value) -> bool {
        let changed = {
            let mut map = self.lock();
            if map.get(key) == Some(&value) {
                false
            } else {
                map.insert(key.to_string(), value);
                true
            }
        };
        if changed {
            self.mark_dirty();
        }
        changed
    }

    pub fn delete(&self, key: &str) -> bool {
        let removed = self.lock().remove(key).is_some();
        if removed {
            self.mark_dirty();
        }
        removed
    }

    fn mark_dirty(&self) {
        self.dirty.store(true, Ordering::SeqCst);
        if !self.scheduled.swap(true, Ordering::SeqCst) {
            tauri::async_runtime::spawn(async {
                tokio::time::sleep(Duration::from_millis(500)).await;
                let st = store();
                st.scheduled.store(false, Ordering::SeqCst);
                let result = run_blocking(|| st.flush().map_err(SvcError::from)).await;
                if let Err(e) = result {
                    tracing::warn!("could not save store.json: {e}");
                }
            });
        }
    }

    /// Writes the file now if anything changed.
    pub fn flush(&self) -> std::io::Result<()> {
        let _guard = self.write_lock.lock().unwrap_or_else(|p| p.into_inner());
        if !self.dirty.swap(false, Ordering::SeqCst) {
            return Ok(());
        }
        let bytes = {
            let map = self.lock();
            serde_json::to_vec_pretty(&*map).map_err(std::io::Error::other)?
        };
        write_atomic(&self.path, &bytes)
    }
}

fn write_atomic(path: &std::path::Path, bytes: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    let tmp = path.with_extension("json.tmp");
    {
        let mut f = std::fs::File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
    }
    // std::fs::rename replaces the target atomically on Windows (MoveFileExW + REPLACE_EXISTING).
    std::fs::rename(&tmp, path)
}

// ---- Rust API for other slices -------------------------------------------------------------

pub fn get_value(key: &str) -> Option<Value> {
    store().get(key)
}

pub fn get_as<T: DeserializeOwned>(key: &str) -> Option<T> {
    store().get(key).and_then(|v| serde_json::from_value(v).ok())
}

pub fn set_value(app: &AppHandle, key: &str, value: Value) {
    if store().set(key, value.clone()) {
        events::emit(app, "store", "changed", &Changed { key: key.to_string(), value });
    }
}

pub fn flush() {
    if let Err(e) = store().flush() {
        tracing::warn!("final store flush failed: {e}");
    }
}

// ---- IPC ----------------------------------------------------------------------------------

#[derive(Serialize)]
struct Changed {
    key: String,
    value: Value,
}

#[derive(Deserialize)]
struct KeyArgs {
    key: String,
}

#[derive(Deserialize)]
struct SetArgs {
    key: String,
    #[serde(default)]
    value: Value,
}

fn check_key(key: &str) -> SvcResult<()> {
    if key.is_empty() || key.len() > 200 {
        return Err(SvcError::bad_args("a store key needs 1 to 200 characters"));
    }
    Ok(())
}

pub fn register(reg: &mut Registrar) {
    reg.add("store", "get", |_app: AppHandle, a: KeyArgs| async move {
        check_key(&a.key)?;
        Ok(get_value(&a.key).unwrap_or(Value::Null))
    });
    reg.add("store", "all", |_app: AppHandle, _: NoArgs| async move { Ok(Value::Object(store().all())) });
    reg.add("store", "set", |app: AppHandle, a: SetArgs| async move {
        check_key(&a.key)?;
        set_value(&app, &a.key, a.value);
        Ok(())
    });
    reg.add("store", "delete", |app: AppHandle, a: KeyArgs| async move {
        check_key(&a.key)?;
        if store().delete(&a.key) {
            events::emit(&app, "store", "changed", &Changed { key: a.key, value: Value::Null });
        }
        Ok(())
    });
    reg.on_cleanup(flush);
}
