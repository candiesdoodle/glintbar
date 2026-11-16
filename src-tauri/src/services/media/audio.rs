//! Speakers, headphones and microphone through Core Audio.
//!
//! While `media/audio` has subscribers, one thread registers for volume/mute changes on the
//! default output and input and for default-device changes, and emits a fresh state on each.
//! Setters, the device list and the per-app mixer are one-shot calls.

use serde::{Deserialize, Serialize};
#[cfg(not(windows))]
use tauri::AppHandle;

#[cfg(not(windows))]
use crate::error::{SvcError, SvcResult};

pub const TOPIC_KEY: &str = "media/audio";

/// One default endpoint: volume 0-100.
#[derive(Serialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Endpoint {
    pub id: String,
    /// "Speakers", "Headphones", "Microphone"
    pub name: String,
    /// The hardware, e.g. "Realtek(R) Audio"
    pub detail: String,
    pub volume: f32,
    pub muted: bool,
}

/// Payload of `svc://media/audio` and result of `media.audio_get`.
#[derive(Serialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AudioState {
    pub output: Option<Endpoint>,
    pub input: Option<Endpoint>,
}

/// An output device for `media.outputs`.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Device {
    pub id: String,
    pub name: String,
    pub detail: String,
    pub is_default: bool,
}

/// One app in the mixer (`media.apps`). Sessions of the same program are merged.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AppVolume {
    /// Lower-case executable name, or "system".
    pub key: String,
    pub name: String,
    pub exe: String,
    pub pid: u32,
    /// Session instance ids to pass to `set_app_volume`.
    pub ids: Vec<String>,
    pub volume: f32,
    pub muted: bool,
    /// Playing sound right now.
    pub active: bool,
    pub system: bool,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct VolumeArgs {
    /// 0-100
    pub volume: f32,
    /// The microphone instead of the output.
    #[serde(default)]
    pub input: bool,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MuteArgs {
    pub muted: bool,
    #[serde(default)]
    pub input: bool,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct OutputArgs {
    pub id: String,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AppVolumeArgs {
    pub ids: Vec<String>,
    #[serde(default)]
    pub volume: Option<f32>,
    #[serde(default)]
    pub muted: Option<bool>,
}

#[cfg(windows)]
pub use imp::{apps, outputs, set_app_volume, set_muted, set_output, set_volume, start, state};

#[cfg(windows)]
mod imp {
    use std::collections::HashMap;
    use std::ffi::c_void;
    use std::sync::mpsc::{channel, RecvTimeoutError, Sender};
    use std::time::Duration;

    use tauri::AppHandle;
    use windows::core::{implement, Interface, PCWSTR, PWSTR};
    use windows::Win32::Devices::FunctionDiscovery::PKEY_Device_FriendlyName;
    use windows::Win32::Foundation::{CloseHandle, PROPERTYKEY, S_OK};
    use windows::Win32::Media::Audio::Endpoints::{IAudioEndpointVolume, IAudioEndpointVolumeCallback, IAudioEndpointVolumeCallback_Impl};
    use windows::Win32::Media::Audio::{
        eCapture, eCommunications, eConsole, eRender, AudioSessionStateActive, AudioSessionStateExpired, EDataFlow, ERole,
        IAudioSessionControl2, IAudioSessionManager2, IMMDevice, IMMDeviceEnumerator, IMMNotificationClient, IMMNotificationClient_Impl,
        ISimpleAudioVolume, MMDeviceEnumerator, AUDIO_VOLUME_NOTIFICATION_DATA, DEVICE_STATE, DEVICE_STATE_ACTIVE,
    };
    use windows::Win32::System::Com::{CoCreateInstance, CoTaskMemFree, CLSCTX_ALL, STGM_READ};
    use windows::Win32::System::Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION};

    use super::{AppVolume, AppVolumeArgs, AudioState, Device, Endpoint, MuteArgs, OutputArgs, VolumeArgs, TOPIC_KEY};
    use crate::error::{SvcError, SvcResult};
    use crate::services::media::{com, names, policy};
    use crate::{events, subscriptions};

    // ---- small helpers ---------------------------------------------------------------------

    fn enumerator() -> SvcResult<IMMDeviceEnumerator> {
        com::init_thread();
        let en: IMMDeviceEnumerator = unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)? };
        Ok(en)
    }

    /// Reads and frees a COM-allocated string.
    fn take_pwstr(p: windows::core::Result<PWSTR>) -> String {
        match p {
            Ok(p) if !p.is_null() => unsafe {
                let s = p.to_string().unwrap_or_default();
                CoTaskMemFree(Some(p.0 as *const c_void));
                s
            },
            _ => String::new(),
        }
    }

    fn device_id(device: &IMMDevice) -> String {
        take_pwstr(unsafe { device.GetId() })
    }

    fn friendly_name(device: &IMMDevice) -> String {
        unsafe {
            match device.OpenPropertyStore(STGM_READ) {
                Ok(store) => match store.GetValue(&PKEY_Device_FriendlyName) {
                    Ok(value) => value.to_string(),
                    Err(_) => String::new(),
                },
                Err(_) => String::new(),
            }
        }
    }

    fn pct(level: f32) -> f32 {
        (level.clamp(0.0, 1.0) * 100.0).round()
    }

    fn read_volume(vol: &IAudioEndpointVolume) -> (f32, bool) {
        unsafe {
            let level = vol.GetMasterVolumeLevelScalar().unwrap_or(0.0);
            let muted = vol.GetMute().map(|b| b.as_bool()).unwrap_or(false);
            (pct(level), muted)
        }
    }

    fn default_device(en: &IMMDeviceEnumerator, flow: EDataFlow, role: ERole) -> Option<IMMDevice> {
        unsafe { en.GetDefaultAudioEndpoint(flow, role).ok() }
    }

    fn endpoint_volume(device: &IMMDevice) -> SvcResult<IAudioEndpointVolume> {
        let vol: IAudioEndpointVolume = unsafe { device.Activate(CLSCTX_ALL, None)? };
        Ok(vol)
    }

    fn read_endpoint(en: &IMMDeviceEnumerator, flow: EDataFlow) -> Option<Endpoint> {
        let device = default_device(en, flow, eConsole)?;
        let vol = endpoint_volume(&device).ok()?;
        let (volume, muted) = read_volume(&vol);
        let (name, detail) = names::split_device_name(&friendly_name(&device));
        Some(Endpoint { id: device_id(&device), name, detail, volume, muted })
    }

    fn no_device() -> SvcError {
        SvcError::NotFound("no sound device is available".to_string())
    }

    // ---- one-shot methods ------------------------------------------------------------------

    pub fn state() -> SvcResult<AudioState> {
        let en = enumerator()?;
        Ok(AudioState { output: read_endpoint(&en, eRender), input: read_endpoint(&en, eCapture) })
    }

    pub fn set_volume(a: VolumeArgs) -> SvcResult<()> {
        let en = enumerator()?;
        let flow = if a.input { eCapture } else { eRender };
        let device = default_device(&en, flow, eConsole).ok_or_else(no_device)?;
        let vol = endpoint_volume(&device)?;
        let level = (a.volume / 100.0).clamp(0.0, 1.0);
        unsafe {
            vol.SetMasterVolumeLevelScalar(level, std::ptr::null())?;
            // Like the Windows flyout: turning the volume up unmutes.
            if level > 0.0 && vol.GetMute()?.as_bool() {
                vol.SetMute(false, std::ptr::null())?;
            }
        }
        Ok(())
    }

    /// Mutes the default device for every app (both the "default" and the "communications"
    /// device, so calls are covered too).
    pub fn set_muted(a: MuteArgs) -> SvcResult<()> {
        let en = enumerator()?;
        let flow = if a.input { eCapture } else { eRender };
        let mut done: Vec<String> = Vec::new();
        for role in [eConsole, eCommunications] {
            let Some(device) = default_device(&en, flow, role) else { continue };
            let id = device_id(&device);
            if done.contains(&id) {
                continue;
            }
            let vol = endpoint_volume(&device)?;
            unsafe { vol.SetMute(a.muted, std::ptr::null())? };
            done.push(id);
        }
        if done.is_empty() {
            return Err(no_device());
        }
        Ok(())
    }

    pub fn outputs() -> SvcResult<Vec<Device>> {
        let en = enumerator()?;
        let default_id = default_device(&en, eRender, eConsole).map(|d| device_id(&d)).unwrap_or_default();
        let mut out = Vec::new();
        unsafe {
            let list = en.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE)?;
            let n = list.GetCount()?;
            for i in 0..n {
                let Ok(device) = list.Item(i) else { continue };
                let id = device_id(&device);
                let (name, detail) = names::split_device_name(&friendly_name(&device));
                out.push(Device { is_default: id == default_id, id, name, detail });
            }
        }
        Ok(out)
    }

    pub fn set_output(a: OutputArgs) -> SvcResult<()> {
        if a.id.is_empty() {
            return Err(SvcError::bad_args("id is missing"));
        }
        com::init_thread();
        policy::set_default_endpoint(&a.id)
    }

    fn process_path(pid: u32) -> Option<String> {
        unsafe {
            let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
            let mut buf = vec![0u16; 1024];
            let mut len = buf.len() as u32;
            let r = QueryFullProcessImageNameW(handle, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len);
            let _ = CloseHandle(handle);
            r.ok()?;
            Some(String::from_utf16_lossy(&buf[..(len as usize).min(buf.len())]))
        }
    }

    /// Every audio session on the default output, as the Volume mixer shows them.
    fn sessions(en: &IMMDeviceEnumerator) -> SvcResult<Vec<(IAudioSessionControl2, ISimpleAudioVolume)>> {
        let device = default_device(en, eRender, eConsole).ok_or_else(no_device)?;
        let mut out = Vec::new();
        unsafe {
            let manager: IAudioSessionManager2 = device.Activate(CLSCTX_ALL, None)?;
            let list = manager.GetSessionEnumerator()?;
            let n = list.GetCount()?;
            for i in 0..n {
                let Ok(control) = list.GetSession(i) else { continue };
                if control.GetState().map(|s| s == AudioSessionStateExpired).unwrap_or(true) {
                    continue;
                }
                let Ok(control2) = control.cast::<IAudioSessionControl2>() else { continue };
                let Ok(volume) = control.cast::<ISimpleAudioVolume>() else { continue };
                out.push((control2, volume));
            }
        }
        Ok(out)
    }

    pub fn apps() -> SvcResult<Vec<AppVolume>> {
        let en = enumerator()?;
        let mut by_key: HashMap<String, AppVolume> = HashMap::new();
        let mut order: Vec<String> = Vec::new();
        // No output device (a server, sound turned off): no app is playing anywhere.
        if default_device(&en, eRender, eConsole).is_none() {
            return Ok(Vec::new());
        }
        for (control, volume) in sessions(&en)? {
            unsafe {
                let pid = control.GetProcessId().unwrap_or(0);
                let system = control.IsSystemSoundsSession() == S_OK;
                let id = take_pwstr(control.GetSessionInstanceIdentifier());
                let active = control.GetState().map(|s| s == AudioSessionStateActive).unwrap_or(false);
                let level = pct(volume.GetMasterVolume().unwrap_or(1.0));
                let muted = volume.GetMute().map(|b| b.as_bool()).unwrap_or(false);
                let path = if system || pid == 0 { None } else { process_path(pid) };
                let (key, name, exe) = if system {
                    ("system".to_string(), "System sounds".to_string(), String::new())
                } else {
                    let display = take_pwstr(control.GetDisplayName());
                    let exe = path.as_deref().map(|p| names::file_part(p).to_string()).unwrap_or_default();
                    let name = if !display.is_empty() && !display.starts_with('@') {
                        display
                    } else if let Some(p) = path.as_deref() {
                        names::process_name(p)
                    } else {
                        format!("App {pid}")
                    };
                    let key = if exe.is_empty() { format!("pid:{pid}") } else { exe.to_ascii_lowercase() };
                    (key, name, exe)
                };
                match by_key.get_mut(&key) {
                    Some(app) => {
                        app.ids.push(id);
                        app.volume = app.volume.max(level);
                        app.muted = app.muted && muted;
                        app.active = app.active || active;
                    }
                    None => {
                        order.push(key.clone());
                        by_key.insert(key.clone(), AppVolume { key, name, exe, pid, ids: vec![id], volume: level, muted, active, system });
                    }
                }
            }
        }
        let mut out: Vec<AppVolume> = order.into_iter().filter_map(|k| by_key.remove(&k)).collect();
        // Apps making sound first, system sounds last.
        out.sort_by_key(|a| (a.system, !a.active));
        Ok(out)
    }

    pub fn set_app_volume(a: AppVolumeArgs) -> SvcResult<()> {
        if a.ids.is_empty() {
            return Err(SvcError::bad_args("ids is missing"));
        }
        let en = enumerator()?;
        let mut found = false;
        for (control, volume) in sessions(&en)? {
            let id = take_pwstr(unsafe { control.GetSessionInstanceIdentifier() });
            if !a.ids.contains(&id) {
                continue;
            }
            found = true;
            unsafe {
                if let Some(v) = a.volume {
                    volume.SetMasterVolume((v / 100.0).clamp(0.0, 1.0), std::ptr::null())?;
                    if v > 0.0 && a.muted.is_none() && volume.GetMute()?.as_bool() {
                        volume.SetMute(false, std::ptr::null())?;
                    }
                }
                if let Some(m) = a.muted {
                    volume.SetMute(m, std::ptr::null())?;
                }
            }
        }
        if found {
            Ok(())
        } else {
            Err(SvcError::NotFound("that app has stopped playing audio".to_string()))
        }
    }

    // ---- live topic ------------------------------------------------------------------------

    enum Msg {
        /// Volume or mute changed on a watched endpoint.
        Changed,
        /// The default device changed, or a device came or went.
        Devices,
    }

    #[implement(IAudioEndpointVolumeCallback)]
    struct VolumeCallback {
        tx: Sender<Msg>,
    }

    impl IAudioEndpointVolumeCallback_Impl for VolumeCallback_Impl {
        fn OnNotify(&self, _data: *mut AUDIO_VOLUME_NOTIFICATION_DATA) -> windows::core::Result<()> {
            let _ = self.tx.send(Msg::Changed);
            Ok(())
        }
    }

    #[implement(IMMNotificationClient)]
    struct DeviceCallback {
        tx: Sender<Msg>,
    }

    impl IMMNotificationClient_Impl for DeviceCallback_Impl {
        fn OnDeviceStateChanged(&self, _id: &PCWSTR, _state: DEVICE_STATE) -> windows::core::Result<()> {
            let _ = self.tx.send(Msg::Devices);
            Ok(())
        }
        fn OnDeviceAdded(&self, _id: &PCWSTR) -> windows::core::Result<()> {
            Ok(())
        }
        fn OnDeviceRemoved(&self, _id: &PCWSTR) -> windows::core::Result<()> {
            Ok(())
        }
        fn OnDefaultDeviceChanged(&self, _flow: EDataFlow, role: ERole, _id: &PCWSTR) -> windows::core::Result<()> {
            if role == eConsole {
                let _ = self.tx.send(Msg::Devices);
            }
            Ok(())
        }
        fn OnPropertyValueChanged(&self, _id: &PCWSTR, _key: &PROPERTYKEY) -> windows::core::Result<()> {
            Ok(())
        }
    }

    /// A default endpoint with our change callback registered on it.
    struct Watched {
        vol: IAudioEndpointVolume,
        callback: IAudioEndpointVolumeCallback,
        id: String,
        name: String,
        detail: String,
    }

    impl Drop for Watched {
        fn drop(&mut self) {
            unsafe {
                let _ = self.vol.UnregisterControlChangeNotify(&self.callback);
            }
        }
    }

    fn watch(en: &IMMDeviceEnumerator, flow: EDataFlow, tx: &Sender<Msg>) -> Option<Watched> {
        let device = default_device(en, flow, eConsole)?;
        let vol = endpoint_volume(&device).ok()?;
        let callback: IAudioEndpointVolumeCallback = VolumeCallback { tx: tx.clone() }.into();
        unsafe { vol.RegisterControlChangeNotify(&callback).ok()? };
        let (name, detail) = names::split_device_name(&friendly_name(&device));
        Some(Watched { vol, callback, id: device_id(&device), name, detail })
    }

    fn read_watched(w: &Option<Watched>) -> Option<Endpoint> {
        w.as_ref().map(|w| {
            let (volume, muted) = read_volume(&w.vol);
            Endpoint { id: w.id.clone(), name: w.name.clone(), detail: w.detail.clone(), volume, muted }
        })
    }

    fn run(app: &AppHandle, generation: u64) -> SvcResult<()> {
        let en = enumerator()?;
        let (tx, rx) = channel::<Msg>();
        let client: IMMNotificationClient = DeviceCallback { tx: tx.clone() }.into();
        unsafe { en.RegisterEndpointNotificationCallback(&client)? };
        let mut output = watch(&en, eRender, &tx);
        let mut input = watch(&en, eCapture, &tx);
        let mut last = AudioState { output: read_watched(&output), input: read_watched(&input) };
        events::emit(app, "media", "audio", &last);

        loop {
            match rx.recv_timeout(Duration::from_millis(800)) {
                Ok(first) => {
                    // Dragging a slider fires dozens of notifications: coalesce them.
                    std::thread::sleep(Duration::from_millis(30));
                    let mut devices = matches!(first, Msg::Devices);
                    while let Ok(m) = rx.try_recv() {
                        if matches!(m, Msg::Devices) {
                            devices = true;
                        }
                    }
                    if !subscriptions::is_current(TOPIC_KEY, generation) {
                        break;
                    }
                    if devices {
                        // Unregister from the old devices before watching the new ones.
                        drop(output.take());
                        drop(input.take());
                        output = watch(&en, eRender, &tx);
                        input = watch(&en, eCapture, &tx);
                    }
                    let next = AudioState { output: read_watched(&output), input: read_watched(&input) };
                    if next != last {
                        events::emit(app, "media", "audio", &next);
                        last = next;
                    }
                }
                Err(RecvTimeoutError::Timeout) => {
                    if !subscriptions::is_current(TOPIC_KEY, generation) {
                        break;
                    }
                }
                Err(RecvTimeoutError::Disconnected) => break,
            }
        }
        drop(output.take());
        drop(input.take());
        unsafe {
            let _ = en.UnregisterEndpointNotificationCallback(&client);
        }
        Ok(())
    }

    pub fn start(app: AppHandle, generation: u64) {
        let spawned = std::thread::Builder::new().name("media-audio".into()).spawn(move || {
            com::init_thread();
            if let Err(e) = run(&app, generation) {
                tracing::warn!("volume watcher unavailable: {e}");
                events::emit(&app, "media", "audio", &AudioState::default());
            }
        });
        if let Err(e) = spawned {
            tracing::warn!("could not start the volume watcher: {e}");
        }
    }
}

#[cfg(not(windows))]
fn unsupported<T>() -> SvcResult<T> {
    Err(SvcError::unsupported("audio control needs Windows"))
}
#[cfg(not(windows))]
pub fn start(_app: AppHandle, _generation: u64) {}
#[cfg(not(windows))]
pub fn state() -> SvcResult<AudioState> {
    unsupported()
}
#[cfg(not(windows))]
pub fn set_volume(_a: VolumeArgs) -> SvcResult<()> {
    unsupported()
}
#[cfg(not(windows))]
pub fn set_muted(_a: MuteArgs) -> SvcResult<()> {
    unsupported()
}
#[cfg(not(windows))]
pub fn outputs() -> SvcResult<Vec<Device>> {
    unsupported()
}
#[cfg(not(windows))]
pub fn set_output(_a: OutputArgs) -> SvcResult<()> {
    unsupported()
}
#[cfg(not(windows))]
pub fn apps() -> SvcResult<Vec<AppVolume>> {
    unsupported()
}
#[cfg(not(windows))]
pub fn set_app_volume(_a: AppVolumeArgs) -> SvcResult<()> {
    unsupported()
}
