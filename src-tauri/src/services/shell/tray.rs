use tauri::menu::{IsMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Wry};

use crate::events;

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "glintbar-show", "Show GlintBar", true, None::<&str>)?;
    let widgets = MenuItem::with_id(app, "glintbar-widgets", "Widgets…", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "glintbar-settings", "Settings", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "glintbar-quit", "Quit GlintBar", true, None::<&str>)?;
    let items: [&dyn IsMenuItem<Wry>; 5] = [&show, &widgets, &settings, &separator, &quit];
    let menu = Menu::with_items(app, &items)?;

    let mut builder = TrayIconBuilder::<Wry>::with_id("glintbar")
        .tooltip("GlintBar")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app: &AppHandle, event| match event.id().0.as_str() {
            "glintbar-show" => super::show_main(app),
            "glintbar-widgets" => {
                super::show_main(app);
                events::emit(app, "shell", "open-panel", "widgets");
            }
            "glintbar-settings" => {
                super::show_main(app);
                events::emit(app, "shell", "open-panel", "settings");
            }
            "glintbar-quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                super::show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}
