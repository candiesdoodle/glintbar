//! Media & audio: now playing (Windows media sessions, SMTC), output volume and devices, per-app
//! volumes, microphone mute.
//!
//! Topics (demand-driven, event-based, nothing polls):
//! - `media/now_playing`  the session on screen: track, cover, timeline, controls
//! - `media/audio`        default output and input: volume, mute, device name
//!
//! Methods: `now_playing_get`, `control`, `audio_get`, `set_volume`, `set_muted`, `outputs`,
//! `set_output`, `apps`, `set_app_volume`. Shapes are mirrored in src/widgets/media/types.ts.

mod audio;
mod com;
mod names;
#[cfg(windows)]
mod policy;
mod smtc;

use tauri::AppHandle;

use crate::registry::{NoArgs, Registrar};

pub fn register(reg: &mut Registrar) {
    // Now playing
    reg.on_topic("media", "now_playing", |app: AppHandle, generation: u64| smtc::start(app, generation), |_app: AppHandle| {});
    reg.add_blocking("media", "now_playing_get", |_app: AppHandle, _: NoArgs| smtc::snapshot());
    reg.add_blocking("media", "control", |_app: AppHandle, a: smtc::ControlArgs| smtc::control(a));

    // Volume, devices, mixer, microphone
    reg.on_topic("media", "audio", |app: AppHandle, generation: u64| audio::start(app, generation), |_app: AppHandle| {});
    reg.add_blocking("media", "audio_get", |_app: AppHandle, _: NoArgs| audio::state());
    reg.add_blocking("media", "set_volume", |_app: AppHandle, a: audio::VolumeArgs| audio::set_volume(a));
    reg.add_blocking("media", "set_muted", |_app: AppHandle, a: audio::MuteArgs| audio::set_muted(a));
    reg.add_blocking("media", "outputs", |_app: AppHandle, _: NoArgs| audio::outputs());
    reg.add_blocking("media", "set_output", |_app: AppHandle, a: audio::OutputArgs| audio::set_output(a));
    reg.add_blocking("media", "apps", |_app: AppHandle, _: NoArgs| audio::apps());
    reg.add_blocking("media", "set_app_volume", |_app: AppHandle, a: audio::AppVolumeArgs| audio::set_app_volume(a));
}
