//! Core services every slice uses: subscriptions, store, secrets, http, fs, shell launch, app.

use serde::Deserialize;
use tauri::AppHandle;

use crate::registry::{NoArgs, Registrar};
use crate::subscriptions;

pub mod app;
pub mod fs;
pub mod http;
pub mod launch;
pub mod secrets;
pub mod smoke;
pub mod store;

#[derive(Deserialize)]
struct TopicArgs {
    topic: String,
}

pub fn register(reg: &mut Registrar) {
    reg.add("core", "subscribe", |app: AppHandle, a: TopicArgs| async move {
        Ok(subscriptions::subscribe(&app, &a.topic))
    });
    reg.add("core", "unsubscribe", |app: AppHandle, a: TopicArgs| async move {
        subscriptions::unsubscribe(&app, &a.topic);
        Ok(())
    });
    reg.add("core", "reset_subscriptions", |app: AppHandle, _: NoArgs| async move {
        subscriptions::reset(&app);
        Ok(())
    });
    reg.add("core", "active_topics", |_app: AppHandle, _: NoArgs| async move {
        Ok(subscriptions::active_topics())
    });

    store::register(reg);
    secrets::register(reg);
    http::register(reg);
    fs::register(reg);
    launch::register(reg);
    app::register(reg);
    smoke::register(reg);
}
