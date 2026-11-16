//! Displays = All: one dock window per monitor ("main" plus "dock-..." windows), each with its
//! own app bar. Windows are created and closed to match the plan whenever the setting or the
//! set of monitors changes. A closing window first gets `svc://shell/closing` so its page can
//! unmount (and unsubscribe its live topics) before it is destroyed.
//!
//! Every window loads the same page; only "main" resets the backend's subscriptions at start-up
//! (src/core/backend.ts), so an extra dock never cuts the live topics "main" is using.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

use super::model::MAIN_LABEL;
use super::{monitors, window};

static PENDING: AtomicBool = AtomicBool::new(false);
static RUNNING: AtomicBool = AtomicBool::new(false);
static CLOSE_READY: Mutex<Vec<String>> = Mutex::new(Vec::new());

/// Debounced: monitors often arrive in bursts while a display is plugged in.
pub fn schedule_reconcile() {
    if PENDING.swap(true, Ordering::SeqCst) {
        return;
    }
    tauri::async_runtime::spawn(async {
        tokio::time::sleep(Duration::from_millis(400)).await;
        PENDING.store(false, Ordering::SeqCst);
        if RUNNING.swap(true, Ordering::SeqCst) {
            // A reconcile is in progress; run again once it is done.
            schedule_reconcile();
            return;
        }
        reconcile().await;
        RUNNING.store(false, Ordering::SeqCst);
    });
}

/// The page of a closing window has unmounted.
pub fn close_ready(label: &str) {
    if let Ok(mut list) = CLOSE_READY.lock() {
        if !list.iter().any(|l| l == label) {
            list.push(label.to_string());
        }
    }
}

fn take_ready(label: &str) -> bool {
    match CLOSE_READY.lock() {
        Ok(mut list) => match list.iter().position(|l| l == label) {
            Some(i) => {
                list.remove(i);
                true
            }
            None => false,
        },
        Err(_) => true,
    }
}

async fn reconcile() {
    let app = match window::app() {
        Some(a) => a.clone(),
        None => return,
    };
    let mons = monitors::all();
    let planned = window::current_plan(&mons);
    if planned.is_empty() {
        return;
    }
    let known = window::known_docks();

    // Create the missing windows.
    let mut created = false;
    for (label, monitor_id) in &planned {
        if known.iter().any(|(l, closing)| l == label && *closing) {
            // Its monitor went away and came back (a display waking up, a flaky cable) while the
            // old window was still closing: close() reconciles again once it is gone.
            tracing::info!(%label, monitor = %monitor_id, "display is back while its dock window is closing; recreating it afterwards");
            continue;
        }
        if known.iter().any(|(l, _)| l == label) || app.get_webview_window(label).is_some() {
            continue;
        }
        let mon = match mons.iter().find(|m| m.id == *monitor_id) {
            Some(m) => m.clone(),
            None => continue,
        };
        match create(&app, label, &mon).await {
            Ok(()) => {
                created = true;
                tracing::info!(%label, monitor = %monitor_id, "dock window created");
            }
            Err(e) => tracing::warn!(%label, "could not create a dock window: {e}"),
        }
    }

    // Close the ones no longer planned (never "main").
    for (label, closing) in known {
        if label == MAIN_LABEL || closing || planned.iter().any(|(l, _)| *l == label) {
            continue;
        }
        close(&app, label);
    }

    if created {
        // Let the new windows' subclass and state settle, then place everything.
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    window::on_main(window::apply_all);
    if created {
        window::schedule_diagnostics("dock-created", Duration::from_secs(3));
    }
}

async fn create(app: &tauri::AppHandle, label: &str, mon: &monitors::MonitorInfo) -> Result<(), String> {
    let app2 = app.clone();
    let label2 = label.to_string();
    let scale = mon.scale();
    let x = mon.monitor.left as f64 / scale;
    let y = mon.monitor.top as f64 / scale;
    let width = (mon.monitor.width() as f64 / scale).max(200.0);
    let joined = tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let built = WebviewWindowBuilder::new(&app2, label2.clone(), WebviewUrl::App("index.html".into()))
            .title("GlintBar")
            .decorations(false)
            .transparent(true)
            .shadow(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .resizable(false)
            .maximizable(false)
            .minimizable(false)
            .closable(false)
            .focused(false)
            .focusable(false)
            .visible(false)
            .position(x, y)
            .inner_size(width, 64.0)
            .build()
            .map_err(|e| e.to_string())?;
        let for_main = built.clone();
        app2.run_on_main_thread(move || {
            window::attach(&for_main);
            let label = for_main.label().to_string();
            window::update_visibility(&label);
        })
        .map_err(|e| e.to_string())?;
        Ok(())
    })
    .await;
    match joined {
        Ok(result) => result,
        Err(e) => Err(e.to_string()),
    }
}

fn close(app: &tauri::AppHandle, label: String) {
    if !window::mark_closing(&label) {
        return;
    }
    window::emit_to_labels("closing", vec![label.clone()]);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        // Up to 1.5 s for the page to unmount its widgets.
        for _ in 0..15 {
            tokio::time::sleep(Duration::from_millis(100)).await;
            if take_ready(&label) {
                break;
            }
        }
        let l = label.clone();
        window::on_main(move || {
            window::forget(&l);
            window::apply_all();
        });
        tokio::time::sleep(Duration::from_millis(100)).await;
        if let Some(w) = app.get_webview_window(&label) {
            if let Err(e) = w.destroy() {
                tracing::warn!(%label, "could not close a dock window: {e}");
            }
        }
        tracing::info!(%label, "dock window closed");
        // The plan may want this display again by now (it came back while we were closing).
        tokio::time::sleep(Duration::from_millis(200)).await;
        schedule_reconcile();
    });
}
