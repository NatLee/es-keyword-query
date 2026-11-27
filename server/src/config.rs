//! 設定都來自環境變數，全部都有預設值。

use std::{env, path::PathBuf};

use anyhow::{Context, Result};

pub const DEFAULT_BIND: &str = "127.0.0.1:8670";

#[derive(Clone, Debug)]
pub struct Config {
    pub bind: String,
    pub database_path: PathBuf,
    pub static_dir: PathBuf,
    /// 外部看到的網址的 origin（例如 `https://kw.example.com`）；用來判斷寫入請求是不是同源。
    pub public_origin: Option<String>,
    /// 登入 cookie 要不要加 `Secure`。沒設定時看 `ES_SERVER_PUBLIC_URL` 是不是 https。
    pub cookie_secure: bool,
    /// `~` 後面沒寫數字時的距離。
    pub default_slop: u32,
}

impl Config {
    pub fn from_env() -> Result<Self> {
        let data_dir = PathBuf::from(var("ES_SERVER_DATA_DIR").unwrap_or_else(|| "data".into()));
        let public_url =
            Some(var("ACCESS_PUBLIC_URL").unwrap_or_else(|| "http://127.0.0.1:8670".into()));
        let cookie_secure = match var("ES_SERVER_COOKIE_SECURE") {
            Some(v) => matches!(v.trim(), "1" | "true" | "yes"),
            None => public_url
                .as_deref()
                .is_some_and(|u| u.starts_with("https://")),
        };
        Ok(Self {
            bind: var("ES_SERVER_BIND").unwrap_or_else(|| DEFAULT_BIND.into()),
            database_path: var("ES_SERVER_DATABASE_PATH")
                .map(PathBuf::from)
                .unwrap_or_else(|| data_dir.join("compiler-foundry.db")),
            static_dir: PathBuf::from(
                var("ES_SERVER_STATIC_DIR").unwrap_or_else(|| "server/web".into()),
            ),
            public_origin: public_url.as_deref().and_then(origin_of),
            cookie_secure,
            default_slop: parse_var("ES_SERVER_DEFAULT_SLOP", 20)?,
        })
    }
}

/// `https://host:port/path` → `https://host:port`
pub fn origin_of(url: &str) -> Option<String> {
    let url = url.trim();
    let (scheme, rest) = url.split_once("://")?;
    let host = rest.split('/').next().filter(|h| !h.is_empty())?;
    Some(format!(
        "{}://{}",
        scheme.to_ascii_lowercase(),
        host.to_ascii_lowercase()
    ))
}

/// 讀環境變數；沒設定或只有空白都當成沒設定。
pub fn var(name: &str) -> Option<String> {
    env::var(name).ok().filter(|v| !v.trim().is_empty())
}

fn parse_var<T: std::str::FromStr>(name: &str, default: T) -> Result<T>
where
    T::Err: std::error::Error + Send + Sync + 'static,
{
    match var(name) {
        Some(v) => v
            .trim()
            .parse()
            .with_context(|| format!("{name} 的值不合法：{v}")),
        None => Ok(default),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn origin_drops_the_path() {
        assert_eq!(
            origin_of("https://KW.example.com:8443/app/"),
            Some("https://kw.example.com:8443".into())
        );
        assert_eq!(origin_of("not a url"), None);
    }
}
