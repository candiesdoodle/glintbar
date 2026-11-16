//! One folder per feature domain. Adding a domain = one `mod` line + one `register` line here.
//! Everything else (handlers, pollers, hooks) lives inside the domain folder.

use crate::registry::Registrar;

pub mod ai;
pub mod appearance;
pub mod apps;
pub mod core;
pub mod media;
pub mod online;
pub mod productivity;
pub mod shell;
pub mod system;

pub fn register_all(reg: &mut Registrar) {
    core::register(reg);
    shell::register(reg);
    apps::register(reg);
    system::register(reg);
    media::register(reg);
    productivity::register(reg);
    ai::register(reg);
    online::register(reg);
    appearance::register(reg);
}
