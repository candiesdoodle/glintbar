//! GlintBar: a widget dock for Windows.
//!
//! Architecture (see CLAUDE.md at the repo root):
//! - Every feature lives in a vertical slice: `services/<domain>/` here, `src/widgets/<domain>/` in the UI.
//! - The UI talks to Rust through ONE command, `svc_call(service, method, args)`, dispatched by
//!   the `ServiceRegistry` that each slice fills in its `register(reg)` function.
//! - Rust talks back through events named `svc://<service>/<topic>` (see `events::emit`).
//!   Pollers only run while the UI is subscribed to their topic (see `subscriptions`).

pub mod error;
pub mod events;
pub mod lifecycle;
pub mod logging;
pub mod migrate;
pub mod paths;
pub mod registry;
pub mod services;
pub mod subscriptions;
#[cfg(windows)]
pub mod win;

pub use error::{SvcError, SvcResult};
pub use registry::{run_blocking, NoArgs, Registrar};

use std::sync::Arc;

pub fn run() {
    // Before logging::init, which creates the data folder.
    let migrated = migrate::copy_old_data();
    logging::init();
    lifecycle::install_panic_hook();
    tracing::info!(version = env!("CARGO_PKG_VERSION"), "GlintBar starting");
    if let Some(outcome) = &migrated {
        migrate::log_data_migration(outcome);
        if let migrate::DataMigration::Copied { .. } = outcome {
            migrate::copy_old_credentials();
        }
    }

    let mut reg = Registrar::new();
    services::register_all(&mut reg);
    let parts = reg.finish();
    lifecycle::set_cleanup_hooks(parts.cleanup);
    subscriptions::set_hooks(parts.topics);
    let registry = Arc::new(parts.registry);
    let setup_hooks = parts.setup;

    let built = tauri::Builder::default()
        // Must be the first plugin: a second launch hands over to this instance and exits.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            services::shell::on_second_instance(app);
        }))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .manage(registry)
        .invoke_handler(tauri::generate_handler![registry::svc_call])
        .setup(move |app| {
            let handle = app.handle().clone();
            for hook in setup_hooks {
                hook(&handle);
            }
            Ok(())
        })
        .build(tauri::generate_context!());

    let app = match built {
        Ok(app) => app,
        Err(e) => {
            tracing::error!("could not start the app: {e}");
            lifecycle::run_cleanup("build-failed");
            return;
        }
    };

    app.run(|_app, event| match event {
        // Quit (tray, app.exit): clean up while the dock windows still exist, so the app bar is
        // removed through a live window handle. GlintBar never prevents an exit.
        tauri::RunEvent::ExitRequested { .. } => lifecycle::run_cleanup("exit-requested"),
        tauri::RunEvent::Exit => lifecycle::run_cleanup("exit"),
        _ => {}
    });
}
