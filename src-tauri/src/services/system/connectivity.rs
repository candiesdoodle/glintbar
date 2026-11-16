//! Connection state from Windows.Networking.Connectivity: online or not, and the Wi-Fi network.

use windows::Networking::Connectivity::{NetworkConnectivityLevel, NetworkInformation};

#[derive(Default, Clone, Debug)]
pub struct Wifi {
    pub connected: bool,
    /// Connected and the internet answers (not just "connected, no internet").
    pub online: bool,
    pub ssid: Option<String>,
    /// 0-5 bars.
    pub signal: Option<u8>,
}

/// (internet reachable at all, the Wi-Fi connection if any)
pub fn read() -> (bool, Wifi) {
    let online = NetworkInformation::GetInternetConnectionProfile()
        .and_then(|p| p.GetNetworkConnectivityLevel())
        .map(|l| l == NetworkConnectivityLevel::InternetAccess)
        .unwrap_or(false);
    let mut wifi = Wifi::default();
    if let Ok(profiles) = NetworkInformation::GetConnectionProfiles() {
        let count = profiles.Size().unwrap_or(0);
        for i in 0..count {
            let p = match profiles.GetAt(i) {
                Ok(p) => p,
                Err(_) => continue,
            };
            if !p.IsWlanConnectionProfile().unwrap_or(false) {
                continue;
            }
            let level = p.GetNetworkConnectivityLevel().unwrap_or(NetworkConnectivityLevel::None);
            if level == NetworkConnectivityLevel::None {
                continue;
            }
            wifi.connected = true;
            wifi.online = wifi.online || level == NetworkConnectivityLevel::InternetAccess;
            if wifi.ssid.is_none() {
                wifi.ssid = p
                    .WlanConnectionProfileDetails()
                    .and_then(|d| d.GetConnectedSsid())
                    .ok()
                    .map(|s| s.to_string())
                    .filter(|s| !s.is_empty());
            }
            if wifi.signal.is_none() {
                wifi.signal = p.GetSignalBars().and_then(|r| r.Value()).ok();
            }
        }
    }
    (online, wifi)
}
