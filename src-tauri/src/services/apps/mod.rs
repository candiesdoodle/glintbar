//! Apps & files: Start, pinned apps, open windows (live), icons, previews, jump lists, recent
//! files, the Recycle Bin, drives and screenshots. The UI side is src/widgets/apps.
//!
//! Methods (service "apps"):
//!   taskbar_pins, installed {refresh}, windows, resolve {paths}, icon {source, size},
//!   preview {hwnd, width}, focus/toggle/minimize/close {hwnd}, end_task {pid},
//!   launch {target, args, admin}, reveal {path}, start_menu, quick_menu, jump_list {aumid, exe},
//!   list_folder {path, limit}, recent {limit}, recycle_info, recycle_empty, recycle_files {paths}, drives,
//!   folder_sizes {root}, capture {mode, folder, save, clipboard, delayMs}, capture_region
//! Topics: apps/windows (WinEvent driven), apps/recycle (every 4 s).

pub mod model;

#[cfg(windows)]
mod capture;
#[cfg(windows)]
mod files;
#[cfg(windows)]
mod hook;
#[cfg(windows)]
mod icons;
#[cfg(windows)]
mod installed;
#[cfg(windows)]
mod jumplist;
#[cfg(windows)]
mod pins;
#[cfg(windows)]
mod util;
#[cfg(windows)]
mod wnd;

use crate::registry::Registrar;

#[cfg(not(windows))]
pub fn register(_reg: &mut Registrar) {}

#[cfg(windows)]
pub fn register(reg: &mut Registrar) {
    win::register(reg);
}

#[cfg(windows)]
mod win {
    use std::time::Duration;

    use serde::Deserialize;
    use tauri::AppHandle;

    use super::{capture, files, hook, icons, installed, jumplist, pins, wnd};
    use crate::error::{SvcError, SvcResult};
    use crate::registry::{run_blocking, NoArgs, Registrar};
    use crate::services::core::launch::{open, OpenArgs};

    #[derive(Deserialize, Default)]
    #[serde(default)]
    struct RefreshArgs {
        refresh: bool,
    }

    #[derive(Deserialize)]
    struct IconArgs {
        source: String,
        #[serde(default)]
        size: Option<u32>,
    }

    #[derive(Deserialize)]
    struct PreviewArgs {
        hwnd: i64,
        #[serde(default)]
        width: Option<u32>,
    }

    #[derive(Deserialize)]
    struct HwndArgs {
        hwnd: i64,
    }

    #[derive(Deserialize)]
    struct PidArgs {
        pid: u32,
    }

    #[derive(Deserialize)]
    struct PathsArgs {
        paths: Vec<String>,
    }

    #[derive(Deserialize)]
    struct PathArgs {
        path: String,
    }

    #[derive(Deserialize, Default)]
    #[serde(default)]
    struct LimitArgs {
        limit: Option<usize>,
    }

    #[derive(Deserialize)]
    struct FolderArgs {
        path: String,
        #[serde(default)]
        limit: Option<usize>,
    }

    #[derive(Deserialize, Default)]
    #[serde(default)]
    struct RootArgs {
        root: String,
    }

    #[derive(Deserialize)]
    struct LaunchArgs {
        target: String,
        #[serde(default)]
        args: Option<String>,
        #[serde(default)]
        admin: bool,
    }

    fn launch(a: LaunchArgs) -> SvcResult<()> {
        let raw = a.target.trim();
        if raw.is_empty() {
            return Err(SvcError::bad_args("no target was given to open"));
        }
        let target = match raw.strip_prefix("aumid:") {
            Some(id) => format!("shell:AppsFolder\\{id}"),
            None => raw.to_string(),
        };
        let cwd = if target.to_lowercase().ends_with(".exe") {
            std::path::Path::new(&target).parent().map(|p| p.to_string_lossy().into_owned())
        } else {
            None
        };
        open(&OpenArgs {
            target,
            args: a.args.filter(|s| !s.trim().is_empty()),
            verb: if a.admin { Some("runas".to_string()) } else { None },
            cwd,
        })
    }

    fn reveal(path: &str) -> SvcResult<()> {
        let path = path.trim();
        if path.is_empty() || path.contains('"') {
            return Err(SvcError::bad_args("no path was given to show in Explorer"));
        }
        open(&OpenArgs {
            target: "explorer.exe".into(),
            args: Some(format!("/select,\"{path}\"")),
            verb: None,
            cwd: None,
        })
    }

    pub fn register(reg: &mut Registrar) {
        // Pins, installed apps, dropped files.
        reg.add_blocking("apps", "taskbar_pins", |_app: AppHandle, _: NoArgs| Ok(pins::taskbar_pins()));
        reg.add_blocking("apps", "installed", |_app: AppHandle, a: RefreshArgs| Ok(installed::installed(a.refresh)));
        reg.add_blocking("apps", "resolve", |_app: AppHandle, a: PathsArgs| Ok(pins::resolve_paths(&a.paths)));

        // Windows: one-shot list, live topic, actions.
        reg.add_blocking("apps", "windows", |_app: AppHandle, _: NoArgs| Ok(wnd::list_windows()));
        reg.on_topic("apps", "windows", |app: AppHandle, generation: u64| hook::start(app, generation), |_app: AppHandle| hook::stop());
        reg.on_cleanup(hook::stop);
        reg.add_blocking("apps", "focus", |_app: AppHandle, a: HwndArgs| wnd::focus(a.hwnd));
        reg.add_blocking("apps", "toggle", |_app: AppHandle, a: HwndArgs| wnd::toggle(a.hwnd));
        reg.add_blocking("apps", "minimize", |_app: AppHandle, a: HwndArgs| wnd::minimize(a.hwnd));
        reg.add_blocking("apps", "close", |_app: AppHandle, a: HwndArgs| wnd::close(a.hwnd));
        reg.add_blocking("apps", "end_task", |_app: AppHandle, a: PidArgs| wnd::end_task(a.pid));
        reg.add_blocking("apps", "start_menu", |_app: AppHandle, _: NoArgs| {
            wnd::open_start();
            Ok(())
        });
        reg.add_blocking("apps", "quick_menu", |_app: AppHandle, _: NoArgs| {
            wnd::open_quick_menu();
            Ok(())
        });

        // Icons and previews.
        reg.add_blocking("apps", "icon", |_app: AppHandle, a: IconArgs| icons::icon(&a.source, a.size.unwrap_or(64)));
        reg.add_blocking("apps", "preview", |_app: AppHandle, a: PreviewArgs| icons::preview(a.hwnd, a.width.unwrap_or(320)));

        // Launching.
        reg.add_blocking("apps", "launch", |_app: AppHandle, a: LaunchArgs| launch(a));
        reg.add_blocking("apps", "reveal", |_app: AppHandle, a: PathArgs| reveal(&a.path));
        reg.add_blocking("apps", "jump_list", |_app: AppHandle, a: jumplist::JumpArgs| Ok(jumplist::jump_list(a)));

        // Files.
        reg.add_blocking("apps", "recent", |_app: AppHandle, a: LimitArgs| Ok(files::recent(a.limit.unwrap_or(12))));
        reg.add_blocking("apps", "recycle_info", |_app: AppHandle, _: NoArgs| files::recycle_info());
        reg.poller("apps", "recycle", Duration::from_secs(4), |_app: AppHandle| async move {
            run_blocking(files::recycle_info).await
        });
        reg.add_blocking("apps", "recycle_empty", |_app: AppHandle, _: NoArgs| files::recycle_empty());
        reg.add_blocking("apps", "recycle_files", |_app: AppHandle, a: PathsArgs| files::recycle_files(&a.paths));
        reg.add_blocking("apps", "list_folder", |_app: AppHandle, a: FolderArgs| {
            files::list_folder(&a.path, a.limit.unwrap_or(60))
        });
        reg.add_blocking("apps", "drives", |_app: AppHandle, _: NoArgs| Ok(files::drives()));
        reg.add_blocking("apps", "folder_sizes", |_app: AppHandle, a: RootArgs| Ok(files::folder_sizes(&a.root)));

        // Screenshots.
        reg.add_blocking("apps", "capture", |app: AppHandle, a: capture::CaptureArgs| capture::capture(&app, a));
        reg.add_blocking("apps", "capture_region", |_app: AppHandle, _: NoArgs| {
            crate::services::core::launch::open_target("ms-screenclip:")
        });
    }
}
