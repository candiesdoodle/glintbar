//! The single IPC surface: `svc_call(service, method, args)`.
//!
//! Each slice adds handlers in its `register(reg: &mut Registrar)`:
//!
//! ```ignore
//! reg.add("system", "cpu_info", |_app, _args: NoArgs| async move { Ok(cpu::info()) });
//! reg.add_blocking("system", "heavy", |_app, args: HeavyArgs| heavy(args)); // runs off the async pool
//! reg.poller("system", "cpu", Duration::from_secs(1), |_app| async move { cpu::sample().await });
//! ```
//!
//! Args are deserialised with serde (missing/null args become `{}` first, so structs with
//! `#[serde(default)]` work), results are serialised with serde.

use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;

use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Manager};

use crate::error::{SvcError, SvcResult};
use crate::events;
use crate::subscriptions::{self, TopicHooks};

/// Use as the args type for methods that take no arguments: `|app, _: NoArgs|`.
pub type NoArgs = serde::de::IgnoredAny;

pub type HandlerFuture = Pin<Box<dyn Future<Output = SvcResult<Value>> + Send + 'static>>;
pub type Handler = Arc<dyn Fn(AppHandle, Value) -> HandlerFuture + Send + Sync + 'static>;
pub type SetupHook = Box<dyn FnOnce(&AppHandle) + Send + 'static>;
pub type CleanupHook = Arc<dyn Fn() + Send + Sync + 'static>;

/// Collects handlers and hooks from every slice at startup.
pub struct Registrar {
    handlers: HashMap<String, Handler>,
    setup: Vec<SetupHook>,
    cleanup: Vec<CleanupHook>,
    topics: Vec<(String, TopicHooks)>,
}

/// What `Registrar::finish` hands to `lib.rs`.
pub struct RegistryParts {
    pub registry: ServiceRegistry,
    pub setup: Vec<SetupHook>,
    pub cleanup: Vec<CleanupHook>,
    pub topics: Vec<(String, TopicHooks)>,
}

impl Default for Registrar {
    fn default() -> Self {
        Self::new()
    }
}

impl Registrar {
    pub fn new() -> Self {
        Registrar { handlers: HashMap::new(), setup: Vec::new(), cleanup: Vec::new(), topics: Vec::new() }
    }

    /// Adds an async handler for `service.method`.
    pub fn add<A, R, F, Fut>(&mut self, service: &str, method: &str, f: F)
    where
        A: DeserializeOwned + Send + 'static,
        R: Serialize + Send + 'static,
        F: Fn(AppHandle, A) -> Fut + Send + Sync + 'static,
        Fut: Future<Output = SvcResult<R>> + Send + 'static,
    {
        let f = Arc::new(f);
        let handler: Handler = Arc::new(move |app: AppHandle, args: Value| -> HandlerFuture {
            let f = f.clone();
            Box::pin(async move {
                let parsed: A = parse_args(args)?;
                let out = f(app, parsed).await?;
                serde_json::to_value(out)
                    .map_err(|e| SvcError::Internal(format!("could not encode the result: {e}")))
            })
        });
        self.insert(service, method, handler);
    }

    /// Adds a synchronous handler that runs on the blocking thread pool (Win32/COM/file work).
    pub fn add_blocking<A, R, F>(&mut self, service: &str, method: &str, f: F)
    where
        A: DeserializeOwned + Send + 'static,
        R: Serialize + Send + 'static,
        F: Fn(AppHandle, A) -> SvcResult<R> + Send + Sync + 'static,
    {
        let f = Arc::new(f);
        self.add(service, method, move |app: AppHandle, args: A| {
            let f = f.clone();
            async move { run_blocking(move || f(app, args)).await }
        });
    }

    /// Runs once on the main thread inside Tauri's setup, after the window exists.
    pub fn on_setup<F>(&mut self, f: F)
    where
        F: FnOnce(&AppHandle) + Send + 'static,
    {
        self.setup.push(Box::new(f));
    }

    /// Runs on normal exit, on logoff and on a fatal (main-thread) panic.
    /// Must be quick, idempotent and must not need the event loop.
    pub fn on_cleanup<F>(&mut self, f: F)
    where
        F: Fn() + Send + Sync + 'static,
    {
        self.cleanup.push(Arc::new(f));
    }

    /// Low-level topic hooks: `on_start(app, generation)` runs when the first UI subscriber
    /// arrives, `on_stop(app)` when the last one leaves. Use `subscriptions::is_current(key, generation)`
    /// inside long-running work to know when to stop.
    pub fn on_topic<S, T>(&mut self, service: &str, topic: &str, on_start: S, on_stop: T)
    where
        S: Fn(AppHandle, u64) + Send + Sync + 'static,
        T: Fn(AppHandle) + Send + Sync + 'static,
    {
        if !check_name(service) || !check_topic(topic) {
            return;
        }
        self.topics.push((
            events::topic_key(service, topic),
            TopicHooks { on_start: Arc::new(on_start), on_stop: Arc::new(on_stop) },
        ));
    }

    /// A demand-driven poller: while at least one UI subscriber listens to `service/topic`,
    /// `sample` runs every `every` and its result is emitted as `svc://service/topic`.
    /// Nothing runs while nobody listens.
    pub fn poller<P, F, Fut>(&mut self, service: &str, topic: &str, every: Duration, sample: F)
    where
        P: Serialize + Send + 'static,
        F: Fn(AppHandle) -> Fut + Send + Sync + 'static,
        Fut: Future<Output = SvcResult<P>> + Send + 'static,
    {
        let sample = Arc::new(sample);
        let svc = service.to_string();
        let top = topic.to_string();
        let key = events::topic_key(service, topic);
        self.on_topic(
            service,
            topic,
            move |app: AppHandle, generation: u64| {
                let sample = sample.clone();
                let svc = svc.clone();
                let top = top.clone();
                let key = key.clone();
                tauri::async_runtime::spawn(async move {
                    let mut ticker = tokio::time::interval(every);
                    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
                    let mut failing = false;
                    loop {
                        ticker.tick().await;
                        if !subscriptions::is_current(&key, generation) {
                            break;
                        }
                        match sample(app.clone()).await {
                            Ok(payload) => {
                                failing = false;
                                events::emit(&app, &svc, &top, &payload);
                            }
                            Err(e) => {
                                if !failing {
                                    tracing::warn!(topic = %key, "poller failed: {e}");
                                }
                                failing = true;
                            }
                        }
                    }
                    tracing::debug!(topic = %key, "poller stopped");
                });
            },
            |_app: AppHandle| {},
        );
    }

    pub fn finish(self) -> RegistryParts {
        tracing::info!(methods = self.handlers.len(), topics = self.topics.len(), "services registered");
        let mut topic_names: Vec<String> = self.topics.iter().map(|(key, _)| key.clone()).collect();
        topic_names.sort();
        topic_names.dedup();
        RegistryParts {
            registry: ServiceRegistry { handlers: self.handlers, topics: topic_names },
            setup: self.setup,
            cleanup: self.cleanup,
            topics: self.topics,
        }
    }

    fn insert(&mut self, service: &str, method: &str, handler: Handler) {
        if !check_name(service) || !check_name(method) {
            return;
        }
        let key = format!("{service}.{method}");
        if self.handlers.contains_key(&key) {
            // A programming error: two slices registered the same method. Keep the first one
            // rather than taking the whole dock (and the hidden taskbar) down at start-up.
            tracing::error!("service method registered twice, keeping the first: {key}");
            return;
        }
        self.handlers.insert(key, handler);
    }
}

/// The lookup table used by `svc_call`. Managed by Tauri as `Arc<ServiceRegistry>`.
pub struct ServiceRegistry {
    handlers: HashMap<String, Handler>,
    /// "service/topic" of every topic with start/stop hooks (pollers included), sorted.
    topics: Vec<String>,
}

impl ServiceRegistry {
    pub fn handler(&self, service: &str, method: &str) -> Option<Handler> {
        self.handlers.get(&format!("{service}.{method}")).cloned()
    }

    pub fn methods(&self) -> Vec<String> {
        let mut names: Vec<String> = self.handlers.keys().cloned().collect();
        names.sort();
        names
    }

    /// Every registered "service.method", sorted.
    pub fn list_methods(&self) -> Vec<String> {
        self.methods()
    }

    /// Every registered topic as "service/topic" (the `core.subscribe` key), sorted.
    pub fn list_topics(&self) -> Vec<String> {
        self.topics.clone()
    }
}

/// Every registered "service.method", sorted (empty before the registry is managed).
pub fn list_methods(app: &AppHandle) -> Vec<String> {
    match app.try_state::<Arc<ServiceRegistry>>() {
        Some(registry) => registry.list_methods(),
        None => Vec::new(),
    }
}

/// Every registered topic as "service/topic", sorted (empty before the registry is managed).
pub fn list_topics(app: &AppHandle) -> Vec<String> {
    match app.try_state::<Arc<ServiceRegistry>>() {
        Some(registry) => registry.list_topics(),
        None => Vec::new(),
    }
}

/// The one Tauri command. Never logs `args` (they can hold secrets).
#[tauri::command]
pub async fn svc_call(
    app: AppHandle,
    registry: tauri::State<'_, Arc<ServiceRegistry>>,
    service: String,
    method: String,
    args: Option<Value>,
) -> Result<Value, String> {
    let handler = match registry.handler(&service, &method) {
        Some(h) => h,
        None => return Err(SvcError::UnknownMethod(format!("{service}.{method}")).to_string()),
    };
    match handler(app, args.unwrap_or(Value::Null)).await {
        Ok(value) => Ok(value),
        Err(e) => {
            tracing::debug!(%service, %method, "call failed: {e}");
            Err(e.to_string())
        }
    }
}

/// Runs blocking work on Tauri's blocking pool and flattens the join error.
pub async fn run_blocking<T, F>(f: F) -> SvcResult<T>
where
    T: Send + 'static,
    F: FnOnce() -> SvcResult<T> + Send + 'static,
{
    match tauri::async_runtime::spawn_blocking(f).await {
        Ok(result) => result,
        Err(e) => Err(SvcError::Internal(format!("background task failed: {e}"))),
    }
}

fn parse_args<A: DeserializeOwned>(args: Value) -> SvcResult<A> {
    if args.is_null() {
        if let Ok(parsed) = serde_json::from_value::<A>(Value::Object(serde_json::Map::new())) {
            return Ok(parsed);
        }
    }
    serde_json::from_value::<A>(args).map_err(|e| SvcError::BadArgs(e.to_string()))
}

/// Programming errors are logged and the entry skipped (never a panic at start-up).
fn check_name(name: &str) -> bool {
    let ok = !name.is_empty() && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
    if !ok {
        tracing::error!("invalid service or method name: {name:?} (use a-z, 0-9, _ and -); skipped");
    }
    ok
}

fn check_topic(topic: &str) -> bool {
    let ok = !topic.is_empty()
        && topic.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == '/');
    if !ok {
        tracing::error!("invalid topic name: {topic:?} (use a-z, 0-9, _, - and /); skipped");
    }
    ok
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[derive(Deserialize, Debug, PartialEq, Default)]
    #[serde(default)]
    struct Opt {
        n: u32,
    }

    #[test]
    fn null_args_become_defaults() {
        let a: Opt = parse_args(Value::Null).unwrap();
        assert_eq!(a, Opt { n: 0 });
        let _: NoArgs = parse_args(Value::Null).unwrap();
        let _: () = parse_args(Value::Null).unwrap();
    }
}
