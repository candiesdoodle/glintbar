//! WhatsApp: unread messages and who wrote last, read from the toasts WhatsApp leaves in the
//! Windows notification center (UserNotificationListener). Needs the user's permission
//! ("Let apps access your notifications"); nothing is read from WhatsApp itself.

use serde::Serialize;

use crate::error::SvcResult;

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Chat {
    pub name: String,
    pub count: u32,
    /// Unix ms of the newest toast.
    pub last_at: i64,
}

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct WhatsAppStatus {
    /// "allowed", "denied", "unspecified" (never asked) or "unavailable" (this Windows can't share notifications).
    pub access: String,
    pub unread: u32,
    pub last_sender: Option<String>,
    pub last_at: Option<i64>,
    /// Newest first.
    pub chats: Vec<Chat>,
    /// Plain-language detail when access is not "allowed".
    pub message: Option<String>,
}

fn with_access(access: &str, message: &str) -> WhatsAppStatus {
    WhatsAppStatus { access: access.to_string(), message: Some(message.to_string()), ..Default::default() }
}

/// "3 new messages" / "5 messages" -> 3 / 5.
pub fn count_in(text: &str) -> Option<u32> {
    let lower = text.trim().to_lowercase();
    let digits: String = lower.chars().take_while(|c| c.is_ascii_digit()).collect();
    if digits.is_empty() {
        return None;
    }
    let rest = lower[digits.len()..].trim_start();
    if rest.starts_with("new message") || rest.starts_with("message") || rest.starts_with("unread message") {
        digits.parse::<u32>().ok().filter(|n| *n > 0 && *n < 10_000)
    } else {
        None
    }
}

#[cfg(windows)]
mod win {
    use windows::UI::Notifications::Management::{UserNotificationListener, UserNotificationListenerAccessStatus};
    use windows::UI::Notifications::{KnownNotificationBindings, NotificationKinds, UserNotification};

    use super::{count_in, with_access, Chat, WhatsAppStatus};
    use crate::error::SvcResult;

    /// 100-ns ticks since 1601 -> unix ms.
    fn to_unix_ms(ticks: i64) -> i64 {
        (ticks - 116_444_736_000_000_000) / 10_000
    }

    fn access_name(s: UserNotificationListenerAccessStatus) -> &'static str {
        if s == UserNotificationListenerAccessStatus::Allowed {
            "allowed"
        } else if s == UserNotificationListenerAccessStatus::Denied {
            "denied"
        } else {
            "unspecified"
        }
    }

    const UNAVAILABLE: &str = "Windows on this PC won't share notifications with GlintBar.";
    const DENIED: &str = "GlintBar isn't allowed to read notifications. Allow it in Settings > Privacy & security > Notifications.";
    const ASK: &str = "Allow access so GlintBar can count WhatsApp's notifications.";

    fn texts(n: &UserNotification) -> Vec<String> {
        let mut out = Vec::new();
        let Ok(notification) = n.Notification() else { return out };
        let Ok(visual) = notification.Visual() else { return out };
        let Ok(template) = KnownNotificationBindings::ToastGeneric() else { return out };
        let Ok(binding) = visual.GetBinding(&template) else { return out };
        let Ok(elements) = binding.GetTextElements() else { return out };
        let size = elements.Size().unwrap_or(0);
        for i in 0..size.min(8) {
            if let Ok(el) = elements.GetAt(i) {
                if let Ok(t) = el.Text() {
                    let s = t.to_string();
                    if !s.trim().is_empty() {
                        out.push(s);
                    }
                }
            }
        }
        out
    }

    fn app_name(n: &UserNotification) -> String {
        n.AppInfo()
            .and_then(|a| a.DisplayInfo())
            .and_then(|d| d.DisplayName())
            .map(|h| h.to_string())
            .unwrap_or_default()
    }

    pub fn read() -> SvcResult<WhatsAppStatus> {
        let listener = match UserNotificationListener::Current() {
            Ok(l) => l,
            Err(_) => return Ok(with_access("unavailable", UNAVAILABLE)),
        };
        let access = match listener.GetAccessStatus() {
            Ok(a) => a,
            Err(_) => return Ok(with_access("unavailable", UNAVAILABLE)),
        };
        if access != UserNotificationListenerAccessStatus::Allowed {
            let name = access_name(access);
            return Ok(with_access(name, if name == "denied" { DENIED } else { ASK }));
        }
        // Unpackaged apps may be refused here even when the status said "allowed": degrade quietly.
        let list = match listener.GetNotificationsAsync(NotificationKinds::Toast).and_then(|op| op.join()) {
            Ok(l) => l,
            Err(_) => return Ok(with_access("unavailable", UNAVAILABLE)),
        };
        let size = list.Size().unwrap_or(0);
        let mut chats: Vec<Chat> = Vec::new();
        for i in 0..size {
            let Ok(n) = list.GetAt(i) else { continue };
            if !app_name(&n).to_lowercase().contains("whatsapp") {
                continue;
            }
            let at = n.CreationTime().map(|t| to_unix_ms(t.UniversalTime)).unwrap_or(0);
            let lines = texts(&n);
            let name = lines.first().cloned().unwrap_or_else(|| "WhatsApp".to_string());
            let count = lines.iter().find_map(|l| count_in(l)).unwrap_or(1);
            match chats.iter_mut().find(|c| c.name == name) {
                Some(c) => {
                    c.count += count;
                    c.last_at = c.last_at.max(at);
                }
                None => chats.push(Chat { name, count, last_at: at }),
            }
        }
        chats.sort_by(|a, b| b.last_at.cmp(&a.last_at));
        let unread = chats.iter().map(|c| c.count).sum();
        let last = chats.first().cloned();
        Ok(WhatsAppStatus {
            access: "allowed".to_string(),
            unread,
            last_sender: last.as_ref().map(|c| c.name.clone()),
            last_at: last.map(|c| c.last_at),
            chats,
            message: None,
        })
    }

    /// How long the consent prompt may stay unanswered (it can also never appear for an
    /// unpackaged app). After that the request is cancelled and the current status reported.
    const ASK_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(45);

    pub fn request() -> SvcResult<WhatsAppStatus> {
        let listener = match UserNotificationListener::Current() {
            Ok(l) => l,
            Err(_) => return Ok(with_access("unavailable", UNAVAILABLE)),
        };
        let op = match listener.RequestAccessAsync() {
            Ok(op) => op,
            Err(_) => return Ok(with_access("unavailable", UNAVAILABLE)),
        };
        // Poll instead of join(): join() waits forever if the prompt is never answered.
        let deadline = std::time::Instant::now() + ASK_TIMEOUT;
        loop {
            // AsyncStatus(0) = Started; anything else (completed, cancelled, error) ends the wait.
            let started = match op.Status() {
                Ok(s) => s.0 == 0,
                Err(_) => false,
            };
            if !started {
                break;
            }
            if std::time::Instant::now() >= deadline {
                let _ = op.Cancel();
                return read();
            }
            std::thread::sleep(std::time::Duration::from_millis(200));
        }
        match op.GetResults() {
            Ok(s) if s == UserNotificationListenerAccessStatus::Allowed => read(),
            Ok(s) => {
                let name = access_name(s);
                Ok(with_access(name, if name == "denied" { DENIED } else { ASK }))
            }
            Err(_) => Ok(with_access("unavailable", UNAVAILABLE)),
        }
    }
}

pub fn status() -> SvcResult<WhatsAppStatus> {
    #[cfg(windows)]
    {
        win::read()
    }
    #[cfg(not(windows))]
    {
        Ok(with_access("unavailable", "Notification counts work only on Windows."))
    }
}

pub fn request_access() -> SvcResult<WhatsAppStatus> {
    #[cfg(windows)]
    {
        win::request()
    }
    #[cfg(not(windows))]
    {
        Ok(with_access("unavailable", "Notification counts work only on Windows."))
    }
}

#[cfg(test)]
mod tests {
    use super::count_in;

    #[test]
    fn counts_summary_toasts() {
        assert_eq!(count_in("3 new messages"), Some(3));
        assert_eq!(count_in("12 messages"), Some(12));
        assert_eq!(count_in("See you at 5"), None);
        assert_eq!(count_in("2024 was great"), None);
    }
}
