use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::subscriptions;

/// `"system/cpu"` - the key used for subscriptions.
pub fn topic_key(service: &str, topic: &str) -> String {
    format!("{service}/{topic}")
}

/// `"svc://system/cpu"` - the Tauri event name the UI listens to.
pub fn event_name(service: &str, topic: &str) -> String {
    format!("svc://{service}/{topic}")
}

/// Emits `payload` to the UI as `svc://<service>/<topic>` and remembers it as the topic's
/// last value (returned to late subscribers by `core.subscribe`).
pub fn emit<P: Serialize + ?Sized>(app: &AppHandle, service: &str, topic: &str, payload: &P) {
    let value = match serde_json::to_value(payload) {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!(%service, %topic, "could not encode event payload: {e}");
            return;
        }
    };
    subscriptions::remember(&topic_key(service, topic), value.clone());
    if let Err(e) = app.emit(&event_name(service, topic), value) {
        tracing::warn!(%service, %topic, "emit failed: {e}");
    }
}
