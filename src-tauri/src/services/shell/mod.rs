//! The dock windows: placement at the screen edge, reserving screen space (app bar), the Windows
//! taskbar (hidden / auto-hide / left alone, always restored), auto-hide, full-screen hiding,
//! dragging the dock to another edge or screen, one dock per display, input passthrough for the
//! transparent parts, global hotkeys, focus handling and the tray icon.
//!
//! IPC (`shell.*`; per-window calls take `label`, the calling window's label, default "main"):
//! - `set_dock {edge, thickness, reserveSpace, taskbar: "hidden"|"autohide"|"normal", autoHide,
//!   showOnDesktop, displays: "main"|"all"|"follow", monitor, screenFit: "proportional" (older saves
//!   may hold "off"/"short"), screenFitRef, fitMin, fitMax}` - thickness in CSS px at the set size;
//!   each dock's strip is that times its screen fit factor (model::fit_factor, per monitor)
//! - `set_overlay {label, height}` - room above the strip for cards/menus, CSS px (0 = none)
//! - `set_hit_rects {label, rects: [{left, width, near, far}], full}` - the visible, clickable
//!   parts in CSS px measured from the dock's screen edge; `full` = the whole window (drags)
//! - `set_hover {label, inside}` - pointer over the dock (auto-hide)
//! - `reveal {label}` - show the auto-hidden dock briefly
//! - `begin_drag {label}` - the pointer is dragging the bar: follow it, snap on release
//! - `set_focusable {label, focusable}` - allow keyboard focus (text inputs) or go back to no-activate
//! - `window_info {label}` - this window's monitor, visibility and screen fit {fit, screenHeight,
//!   fitSeq} (also shows a new dock window)
//! - `close_ready {label}` - a closing window's page has unmounted
//! - `hotkeys_set {hotkeys: [{id, keys: "Alt+T"}]}` -> [{id, keys, ok, error}]
//! - `monitors`, `get_state`, `show`
//!
//! Events: `svc://shell/visibility {label, state: "shown"|"autohidden"|"suppressed"}`,
//! `svc://shell/placement {edge, monitor, at}`, `svc://shell/hotkey {id, label, at}`,
//! `svc://shell/outside-click {label, at}`, `svc://shell/escape {label, at}`,
//! `svc://shell/closing {label, at}`, `svc://shell/fullscreen {label, active}`,
//! `svc://shell/fit {label, fit, screenHeight, seq}` (a dock's screen fit changed),
//! `svc://shell/open-panel` ("widgets" | "settings"), `svc://shell/second-instance`.
//! (`shell.open` / `shell.run` live in services/core/launch.rs.)

#[cfg(windows)]
mod appbar;
#[cfg(windows)]
mod crash;
#[cfg(windows)]
mod focus;
#[cfg(windows)]
mod hotkeys;
pub mod model;
#[cfg(windows)]
mod monitors;
#[cfg(windows)]
mod multi;
#[cfg(windows)]
mod taskbar;
mod tray;
#[cfg(windows)]
mod watch;
#[cfg(windows)]
mod watchdog;
#[cfg(windows)]
pub mod window;

use serde::Deserialize;
use tauri::{AppHandle, Manager};

use crate::error::{SvcError, SvcResult};
use crate::events;
use crate::registry::Registrar;

pub const MAIN_WINDOW: &str = model::MAIN_LABEL;

fn main_label() -> String {
    MAIN_WINDOW.to_string()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LabelArgs {
    #[serde(default = "main_label")]
    label: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OverlayArgs {
    #[serde(default = "main_label")]
    label: String,
    #[serde(default)]
    height: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FocusArgs {
    #[serde(default = "main_label")]
    label: String,
    focusable: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HitArgs {
    #[serde(default = "main_label")]
    label: String,
    #[serde(default)]
    rects: Vec<model::HitRect>,
    #[serde(default)]
    full: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HoverArgs {
    #[serde(default = "main_label")]
    label: String,
    inside: bool,
}

#[cfg(windows)]
#[derive(Deserialize)]
struct HotkeyArgs {
    #[serde(default)]
    hotkeys: Vec<hotkeys::HotkeyDef>,
}

fn check_label(label: &str) -> SvcResult<()> {
    let ok = !label.is_empty() && label.len() <= 64 && label.chars().all(|c| c.is_ascii_alphanumeric() || c == '-');
    if ok {
        Ok(())
    } else {
        Err(SvcError::bad_args("unknown window label"))
    }
}

pub fn register(reg: &mut Registrar) {
    reg.on_setup(|app: &AppHandle| {
        if let Err(e) = tray::create(app) {
            tracing::warn!("could not create the tray icon: {e}");
        }
        #[cfg(windows)]
        window::init(app);
        #[cfg(not(windows))]
        show_main(app);
    });

    #[cfg(windows)]
    {
        reg.on_cleanup(window::cleanup);
        reg.add("shell", "set_dock", |_app: AppHandle, geo: model::DockGeometry| async move {
            window::set_geometry(geo);
            Ok(())
        });
        reg.add("shell", "set_overlay", |_app: AppHandle, a: OverlayArgs| async move {
            check_label(&a.label)?;
            window::set_overlay(&a.label, a.height);
            Ok::<_, SvcError>(())
        });
        reg.add("shell", "set_hit_rects", |_app: AppHandle, a: HitArgs| async move {
            check_label(&a.label)?;
            window::set_hits(&a.label, a.rects, a.full);
            Ok::<_, SvcError>(())
        });
        reg.add("shell", "set_hover", |_app: AppHandle, a: HoverArgs| async move {
            check_label(&a.label)?;
            window::set_hover(&a.label, a.inside);
            Ok::<_, SvcError>(())
        });
        reg.add("shell", "reveal", |_app: AppHandle, a: LabelArgs| async move {
            check_label(&a.label)?;
            window::reveal(&a.label);
            Ok::<_, SvcError>(())
        });
        reg.add("shell", "begin_drag", |_app: AppHandle, a: LabelArgs| async move {
            check_label(&a.label)?;
            window::begin_drag(&a.label);
            Ok::<_, SvcError>(())
        });
        reg.add("shell", "window_info", |_app: AppHandle, a: LabelArgs| async move {
            check_label(&a.label)?;
            Ok::<_, SvcError>(window::window_info(&a.label))
        });
        reg.add("shell", "close_ready", |_app: AppHandle, a: LabelArgs| async move {
            check_label(&a.label)?;
            multi::close_ready(&a.label);
            Ok::<_, SvcError>(())
        });
        reg.add("shell", "hotkeys_set", |_app: AppHandle, a: HotkeyArgs| async move {
            let (tx, rx) = tokio::sync::oneshot::channel::<Vec<hotkeys::HotkeyResult>>();
            window::on_main(move || {
                let _ = tx.send(hotkeys::apply(a.hotkeys));
            });
            rx.await.map_err(|_| SvcError::Internal("no reply from the dock window".into()))
        });
        reg.add_blocking("shell", "monitors", |_app: AppHandle, _: crate::registry::NoArgs| Ok(window::monitors_list()));
        reg.add_blocking("shell", "get_state", |_app: AppHandle, _: crate::registry::NoArgs| Ok(window::snapshot()));
    }
    reg.add("shell", "set_focusable", |app: AppHandle, a: FocusArgs| async move {
        check_label(&a.label)?;
        set_focusable(&app, &a.label, a.focusable)
    });
    reg.add("shell", "show", |app: AppHandle, _: crate::registry::NoArgs| async move {
        show_main(&app);
        Ok(())
    });
}

pub fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(MAIN_WINDOW) {
        if let Err(e) = w.show() {
            tracing::warn!("could not show the dock: {e}");
        }
    }
    #[cfg(windows)]
    window::reveal(MAIN_WINDOW);
}

/// While false (the default) clicking the dock never takes focus from the app you are in.
/// The UI turns it on while a text input is focused and off again afterwards; then the window
/// the user was in gets the foreground back (focus.rs).
pub fn set_focusable(app: &AppHandle, label: &str, focusable: bool) -> SvcResult<()> {
    let w = app
        .get_webview_window(label)
        .ok_or_else(|| SvcError::NotFound(format!("window {label}")))?;
    #[cfg(windows)]
    {
        if focusable {
            focus::remember_foreground();
        }
    }
    w.set_focusable(focusable)?;
    if focusable {
        w.set_focus()?;
    }
    #[cfg(windows)]
    {
        // The toolkit applies the change by rewriting the window styles (queued on the main
        // thread before this): check the dock is still shown and topmost afterwards.
        let l = label.to_string();
        window::on_main(move || window::after_focus_change(&l));
        if !focusable {
            focus::schedule_hand_back();
        }
    }
    Ok(())
}

/// Called (in this, the first instance) when GlintBar is started again.
pub fn on_second_instance(app: &AppHandle) {
    tracing::info!("second launch: showing the dock");
    show_main(app);
    events::emit(app, "shell", "second-instance", &());
}
