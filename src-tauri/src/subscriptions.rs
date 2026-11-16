//! Demand-driven topics. The UI calls `core.subscribe {topic}` / `core.unsubscribe {topic}`
//! (ref-counted in `src/core/backend.ts`); hooks registered with `Registrar::on_topic` /
//! `Registrar::poller` start on the first subscriber and stop after the last.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};

use serde_json::Value;
use tauri::AppHandle;

pub struct TopicHooks {
    pub on_start: Arc<dyn Fn(AppHandle, u64) + Send + Sync + 'static>,
    pub on_stop: Arc<dyn Fn(AppHandle) + Send + Sync + 'static>,
}

#[derive(Default)]
struct TopicState {
    count: u32,
    generation: u64,
    last: Option<Value>,
}

static TOPICS: OnceLock<Mutex<HashMap<String, TopicState>>> = OnceLock::new();
static HOOKS: OnceLock<HashMap<String, Vec<TopicHooks>>> = OnceLock::new();

const MAX_TOPIC_LEN: usize = 128;

fn topics() -> MutexGuard<'static, HashMap<String, TopicState>> {
    TOPICS.get_or_init(|| Mutex::new(HashMap::new())).lock().unwrap_or_else(|p| p.into_inner())
}

pub(crate) fn set_hooks(list: Vec<(String, TopicHooks)>) {
    let mut map: HashMap<String, Vec<TopicHooks>> = HashMap::new();
    for (key, hooks) in list {
        map.entry(key).or_default().push(hooks);
    }
    let _ = HOOKS.set(map);
}

fn hooks_for(key: &str) -> Vec<(Arc<dyn Fn(AppHandle, u64) + Send + Sync>, Arc<dyn Fn(AppHandle) + Send + Sync>)> {
    match HOOKS.get().and_then(|m| m.get(key)) {
        Some(list) => list.iter().map(|h| (h.on_start.clone(), h.on_stop.clone())).collect(),
        None => Vec::new(),
    }
}

/// Adds a subscriber. Returns the topic's last emitted value, if any.
pub fn subscribe(app: &AppHandle, key: &str) -> Option<Value> {
    if key.is_empty() || key.len() > MAX_TOPIC_LEN {
        return None;
    }
    let (started, generation, last) = {
        let mut map = topics();
        let st = map.entry(key.to_string()).or_default();
        st.count += 1;
        let started = st.count == 1;
        if started {
            st.generation += 1;
        }
        (started, st.generation, st.last.clone())
    };
    if started {
        tracing::debug!(topic = %key, "topic started");
        for (start, _) in hooks_for(key) {
            start(app.clone(), generation);
        }
    }
    last
}

/// Removes a subscriber; stops the topic when the count reaches zero.
pub fn unsubscribe(app: &AppHandle, key: &str) {
    let stopped = {
        let mut map = topics();
        match map.get_mut(key) {
            Some(st) if st.count > 0 => {
                st.count -= 1;
                if st.count == 0 {
                    st.generation += 1;
                    true
                } else {
                    false
                }
            }
            _ => false,
        }
    };
    if stopped {
        tracing::debug!(topic = %key, "topic stopped");
        for (_, stop) in hooks_for(key) {
            stop(app.clone());
        }
    }
}

/// Drops every subscription (the UI calls this when it (re)loads).
pub fn reset(app: &AppHandle) {
    let stopped: Vec<String> = {
        let mut map = topics();
        let mut out = Vec::new();
        for (key, st) in map.iter_mut() {
            if st.count > 0 {
                st.count = 0;
                st.generation += 1;
                out.push(key.clone());
            }
        }
        out
    };
    for key in stopped {
        for (_, stop) in hooks_for(&key) {
            stop(app.clone());
        }
    }
}

pub fn is_active(key: &str) -> bool {
    topics().get(key).map(|st| st.count > 0).unwrap_or(false)
}

/// True while the topic is still running the session that `generation` belongs to.
pub fn is_current(key: &str, generation: u64) -> bool {
    topics().get(key).map(|st| st.count > 0 && st.generation == generation).unwrap_or(false)
}

pub fn active_topics() -> Vec<String> {
    let mut list: Vec<String> = topics().iter().filter(|(_, st)| st.count > 0).map(|(k, _)| k.clone()).collect();
    list.sort();
    list
}

pub(crate) fn remember(key: &str, value: Value) {
    if key.len() > MAX_TOPIC_LEN {
        return;
    }
    topics().entry(key.to_string()).or_default().last = Some(value);
}
