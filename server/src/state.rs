use crate::{auth::LoginLimiter, Config};
use std::sync::{Arc, OnceLock};
pub type AppState = Arc<Inner>;
pub struct Inner {
    pub db: sqlx::SqlitePool,
    pub config: Config,
    pub limiter: LoginLimiter,
    pub access: OnceLock<access_kit::AccessKit>,
}
impl Inner {
    pub fn new(db: sqlx::SqlitePool, config: Config) -> Self {
        Self {
            db,
            config,
            limiter: LoginLimiter::default(),
            access: OnceLock::new(),
        }
    }
}
