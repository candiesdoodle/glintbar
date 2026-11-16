//! `app.*`: version info, quit, relaunch, launch at startup, log folder, UI log lines.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tauri_plugin_autostart::ManagerExt;

use crate::error::{SvcError, SvcResult};
use crate::logging;
use crate::paths;
use crate::registry::{NoArgs, Registrar};
use crate::services::core::launch;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Info {
    name: String,
    version: String,
    identifier: String,
    data_dir: String,
    log_file: String,
    debug: bool,
    os: &'static str,
}

#[derive(Deserialize)]
struct EnabledArgs {
    enabled: bool,
}

#[derive(Deserialize)]
struct LogArgs {
    #[serde(default)]
    level: String,
    message: String,
}

fn autostart_enabled(app: &AppHandle) -> SvcResult<bool> {
    app.autolaunch().is_enabled().map_err(|e| SvcError::Internal(format!("autostart: {e}")))
}

pub fn register(reg: &mut Registrar) {
    reg.add("app", "info", |app: AppHandle, _: NoArgs| async move {
        let pkg = app.package_info();
        Ok(Info {
            name: pkg.name.clone(),
            version: pkg.version.to_string(),
            identifier: app.config().identifier.clone(),
            data_dir: paths::data_dir().to_string_lossy().into_owned(),
            log_file: logging::log_file_path().to_string_lossy().into_owned(),
            debug: cfg!(debug_assertions),
            os: std::env::consts::OS,
        })
    });
    reg.add("app", "quit", |app: AppHandle, _: NoArgs| async move {
        app.exit(0);
        Ok(())
    });
    reg.add("app", "relaunch", |app: AppHandle, _: NoArgs| async move {
        crate::services::core::smoke::guard("app.relaunch")?;
        // Goes through RunEvent::Exit, so cleanup (taskbar, app bar, store) still runs.
        app.request_restart();
        Ok::<(), SvcError>(())
    });
    reg.add_blocking("app", "autostart_get", |app: AppHandle, _: NoArgs| autostart_enabled(&app));
    reg.add_blocking("app", "autostart_set", |app: AppHandle, a: EnabledArgs| {
        crate::services::core::smoke::guard("app.autostart_set")?;
        let manager = app.autolaunch();
        let result = if a.enabled { manager.enable() } else { manager.disable() };
        result.map_err(|e| SvcError::Internal(format!("autostart: {e}")))?;
        autostart_enabled(&app)
    });
    reg.add_blocking("app", "open_logs", |_app: AppHandle, _: NoArgs| {
        launch::open_target(&paths::logs_dir().to_string_lossy())
    });
    reg.add_blocking("app", "open_data_dir", |_app: AppHandle, _: NoArgs| {
        launch::open_target(&paths::data_dir().to_string_lossy())
    });
    reg.add("app", "log", |_app: AppHandle, a: LogArgs| async move {
        let msg: String = a.message.chars().take(2000).collect();
        match a.level.as_str() {
            "error" => tracing::error!(target: "ui", "{msg}"),
            "warn" => tracing::warn!(target: "ui", "{msg}"),
            "debug" => tracing::debug!(target: "ui", "{msg}"),
            _ => tracing::info!(target: "ui", "{msg}"),
        }
        Ok(())
    });
}
