//! Productivity: Screen Time (foreground-window tracker) and WhatsApp (notification reader).
//! Timers, to-dos, notes, calendar and currency are frontend-only (src/widgets/productivity).

mod screentime;
mod whatsapp;

use tauri::AppHandle;

use crate::registry::{NoArgs, Registrar};

pub fn register(reg: &mut Registrar) {
    reg.add_blocking("productivity", "screentime_day", |_app: AppHandle, a: screentime::DayArgs| screentime::day(a));
    reg.add_blocking("productivity", "screentime_days", |_app: AppHandle, a: screentime::DaysArgs| screentime::days(a));
    reg.add_blocking("productivity", "screentime_status", |_app: AppHandle, _: NoArgs| Ok(screentime::status()));
    reg.add_blocking("productivity", "screentime_forget_sites", |_app: AppHandle, _: NoArgs| screentime::forget_sites());
    reg.on_setup(|_app: &AppHandle| screentime::start());
    reg.on_cleanup(|| screentime::flush());

    reg.add_blocking("productivity", "whatsapp_status", |_app: AppHandle, _: NoArgs| whatsapp::status());
    reg.add_blocking("productivity", "whatsapp_request_access", |_app: AppHandle, _: NoArgs| whatsapp::request_access());
}
