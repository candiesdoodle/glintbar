//! System: CPU (the reference slice), memory, per-app usage, network, battery, temperature,
//! brightness, quick toggles, Bluetooth, theme, keyboard layout, tray icons and shell actions.
//!
//! Pattern to copy:
//! - one-shot data -> `reg.add` / `reg.add_blocking` (here `system.cpu_info`)
//! - live data     -> `reg.poller` on a topic (here `system/cpu`, 1 s). It only runs while a
//!                    tile or card is subscribed and visible; see src/widgets/system/cpu.
//! - COM / WMI / WinRT work runs on the dedicated threads in `com.rs` (CoInitializeEx MTA),
//!   which start on demand and exit after a minute idle.

mod cpu;

#[cfg(windows)]
mod audio;
#[cfg(windows)]
mod awake;
#[cfg(windows)]
mod battery;
#[cfg(windows)]
mod bluetooth;
#[cfg(windows)]
mod brightness;
#[cfg(windows)]
mod com;
#[cfg(windows)]
mod connectivity;
#[cfg(windows)]
mod desktop;
#[cfg(windows)]
mod display;
#[cfg(windows)]
mod dnd;
#[cfg(windows)]
mod hotspot;
#[cfg(windows)]
mod icon;
#[cfg(windows)]
mod language;
#[cfg(windows)]
mod memory;
#[cfg(windows)]
mod network;
#[cfg(windows)]
mod procs;
#[cfg(windows)]
mod radios;
#[cfg(windows)]
mod shell_actions;
#[cfg(windows)]
mod theme;
#[cfg(windows)]
mod thermal;
#[cfg(windows)]
mod toggles;
#[cfg(windows)]
mod tray;
#[cfg(windows)]
mod util;
#[cfg(windows)]
mod wmi;

use std::time::Duration;

use tauri::AppHandle;

use crate::registry::{NoArgs, Registrar};

pub fn register(reg: &mut Registrar) {
    reg.add_blocking("system", "cpu_info", |_app: AppHandle, _: NoArgs| cpu::info());
    reg.poller("system", "cpu", Duration::from_secs(1), |_app: AppHandle| cpu::sample());
    #[cfg(windows)]
    register_windows(reg);
}

#[cfg(windows)]
fn register_windows(reg: &mut Registrar) {
    use crate::registry::run_blocking;

    // Live topics (demand-driven: nothing runs while no tile or card listens).
    reg.poller("system", "memory", Duration::from_secs(2), |_app: AppHandle| async move { run_blocking(memory::sample).await });
    reg.poller("system", "procs", Duration::from_secs(2), |_app: AppHandle| async move { run_blocking(procs::sample).await });
    reg.poller("system", "network", Duration::from_secs(1), |_app: AppHandle| async move { run_blocking(network::sample).await });
    reg.poller("system", "battery", Duration::from_secs(5), |_app: AppHandle| async move { run_blocking(battery::read).await });
    reg.poller("system", "thermal", Duration::from_secs(thermal::INTERVAL_SECS), |_app: AppHandle| async move {
        run_blocking(thermal::sample).await
    });
    reg.poller("system", "language", Duration::from_millis(1000), |_app: AppHandle| async move { run_blocking(language::state).await });

    // One-shot reads and actions.
    reg.add_blocking("system", "network_adapters", |_app: AppHandle, _: NoArgs| network::adapters());
    reg.add_blocking("system", "battery_info", |_app: AppHandle, _: NoArgs| battery::read());
    reg.add_blocking("system", "memory_info", |_app: AppHandle, _: NoArgs| memory::sample());
    reg.add_blocking("system", "brightness_list", |_app: AppHandle, _: NoArgs| brightness::list());
    reg.add_blocking("system", "brightness_set", |_app: AppHandle, a: brightness::SetArgs| brightness::set(a));
    reg.add_blocking("system", "toggles_state", |_app: AppHandle, _: NoArgs| toggles::state());
    reg.add_blocking("system", "toggle_set", |_app: AppHandle, a: toggles::SetArgs| toggles::set(a));
    reg.add_blocking("system", "dnd_state", |_app: AppHandle, _: NoArgs| Ok(dnd::is_on()));
    reg.add_blocking("system", "bluetooth_devices", |_app: AppHandle, _: NoArgs| {
        com::COM.run(Duration::from_secs(20), bluetooth::devices)
    });
    reg.add_blocking("system", "theme_get", |_app: AppHandle, _: NoArgs| theme::get());
    reg.add_blocking("system", "theme_set", |_app: AppHandle, a: theme::SetArgs| theme::set(a));
    reg.add_blocking("system", "language_state", |_app: AppHandle, _: NoArgs| language::state());
    reg.add_blocking("system", "language_set", |_app: AppHandle, a: language::SetArgs| language::set(a));
    reg.add_blocking("system", "language_next", |_app: AppHandle, _: NoArgs| language::next());
    reg.add_blocking("system", "tray_list", |_app: AppHandle, _: NoArgs| tray::list());
    reg.add_blocking("system", "tray_click", |_app: AppHandle, a: tray::ClickArgs| tray::click(a));
    reg.add_blocking("system", "tray_overflow", |_app: AppHandle, _: NoArgs| tray::open_overflow());
    reg.add_blocking("system", "notifications_toggle", |_app: AppHandle, _: NoArgs| shell_actions::toggle_notifications());
    reg.add_blocking("system", "quick_settings_open", |_app: AppHandle, _: NoArgs| shell_actions::open_quick_settings());
    reg.add_blocking("system", "show_desktop", |_app: AppHandle, _: NoArgs| desktop::show_desktop());
    reg.add_blocking("system", "keyboard_state", |_app: AppHandle, _: NoArgs| Ok(shell_actions::keyboard_open()));
    reg.add_blocking("system", "keyboard_toggle", |_app: AppHandle, _: NoArgs| shell_actions::toggle_keyboard());

    reg.on_cleanup(awake::cleanup);
}
