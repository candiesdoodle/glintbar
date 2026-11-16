//! Microphone mute on the default capture devices (Core Audio). Call from the COM worker.

use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
use windows::Win32::Media::Audio::{eCapture, eCommunications, eConsole, IMMDeviceEnumerator, MMDeviceEnumerator};
use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_ALL};

use crate::error::{SvcError, SvcResult};

fn endpoints() -> Vec<IAudioEndpointVolume> {
    let mut out = Vec::new();
    unsafe {
        let enumerator: IMMDeviceEnumerator = match CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) {
            Ok(e) => e,
            Err(_) => return out,
        };
        for role in [eConsole, eCommunications] {
            if let Ok(device) = enumerator.GetDefaultAudioEndpoint(eCapture, role) {
                if let Ok(volume) = device.Activate::<IAudioEndpointVolume>(CLSCTX_ALL, None) {
                    out.push(volume);
                }
            }
        }
    }
    out
}

/// None when there is no microphone.
pub fn muted() -> Option<bool> {
    let list = endpoints();
    let first = list.first()?;
    unsafe { first.GetMute() }.ok().map(|b| b.as_bool())
}

pub fn set_muted(muted: bool) -> SvcResult<()> {
    let list = endpoints();
    if list.is_empty() {
        return Err(SvcError::NotFound("Windows reports no microphone".into()));
    }
    for v in &list {
        unsafe { v.SetMute(muted, std::ptr::null())? };
    }
    Ok(())
}
