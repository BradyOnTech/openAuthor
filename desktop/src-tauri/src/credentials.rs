use serde::Deserialize;
use std::path::Path;
use tauri::Manager;

const STORE_ERROR: &str = "The secure credential store is unavailable. Unlock the macOS Keychain and retry.";

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Operation {
  Read,
  Write,
  Remove,
  Create,
}

fn validate(key: &str, value: Option<&str>) -> Result<(), String> {
  if key.len() < 8 || key.len() > 180
    || !key.bytes().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
    || !(key.starts_with("auth-") || key.starts_with("device-"))
  {
    return Err("Invalid credential slot.".into());
  }
  if value.is_some_and(|v| v.is_empty() || v.len() > 16_384) {
    return Err("Invalid credential value size.".into());
  }
  Ok(())
}

// Only the packaged main window (or its loopback development origin) can
// request secrets. No caller can select another application's Keychain service.
fn trusted_origin(label: &str, url: &tauri::Url) -> bool {
  if label != "main" { return false; }
  (url.scheme() == "tauri" && url.host_str() == Some("localhost"))
    || (matches!(url.scheme(), "http" | "https") && url.host_str() == Some("tauri.localhost"))
    || (cfg!(debug_assertions) && url.scheme() == "http"
      && url.host_str() == Some("localhost") && url.port() == Some(5173))
}

#[cfg(target_os = "macos")]
fn access(directory: &Path, operation: Operation, key: &str, value: Option<&str>) -> Result<Option<String>, String> {
  use fs2::FileExt;
  use std::fs::{create_dir_all, OpenOptions};
  validate(key, value)?;
  // Coordinate separate app processes as well as concurrent renderer requests.
  // This file contains no credentials; Keychain remains the sole persistence.
  create_dir_all(directory).map_err(|_| STORE_ERROR.to_string())?;
  let lock = OpenOptions::new().create(true).truncate(false).read(true).write(true)
    .open(directory.join("credential-store.lock")).map_err(|_| STORE_ERROR.to_string())?;
  lock.lock_exclusive().map_err(|_| STORE_ERROR.to_string())?;
  let entry = keyring::Entry::new("com.openauthor.desktop.companion.v1", key)
    .map_err(|_| STORE_ERROR.to_string())?;
  let read = || match entry.get_password() {
    Ok(value) => Ok(Some(value)),
    Err(keyring::Error::NoEntry) => Ok(None),
    // Keyring errors can contain raw bytes. Never serialize their details.
    Err(_) => Err(STORE_ERROR.to_string()),
  };
  match operation {
    Operation::Read => read(),
    Operation::Write | Operation::Create => {
      if matches!(operation, Operation::Create) {
        if let Some(existing) = read()? { return Ok(Some(existing)); }
      }
      let value = value.ok_or("Credential value is required.")?;
      entry.set_password(value).map_err(|_| STORE_ERROR.to_string())?;
      Ok(Some(value.to_string()))
    },
    Operation::Remove => {
      match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => Err(STORE_ERROR.to_string()),
      }
    },
  }
}

#[cfg(not(target_os = "macos"))]
fn access(_directory: &Path, _operation: Operation, key: &str, value: Option<&str>) -> Result<Option<String>, String> {
  validate(key, value)?;
  Err("Secure companion credentials currently require the macOS desktop app.".into())
}

#[tauri::command]
pub async fn desktop_secret(
  app: tauri::AppHandle,
  window: tauri::WebviewWindow,
  operation: Operation,
  key: String,
  value: Option<String>,
) -> Result<Option<String>, String> {
  if !trusted_origin(window.label(), &window.url().map_err(|_| "Untrusted credential caller.")?) {
    return Err("Untrusted credential caller.".into());
  }
  validate(&key, value.as_deref())?;
  let directory = app.path().app_local_data_dir().map_err(|_| STORE_ERROR)?;
  tauri::async_runtime::spawn_blocking(move || access(&directory, operation, &key, value.as_deref()))
    .await.map_err(|_| STORE_ERROR.to_string())?
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn limits_slots_values_and_callers() {
    assert!(validate("auth-deployment", Some("secret")).is_ok());
    for key in ["other-app", "auth-../../file", "auth-user@example.com", "auth-"] {
      assert!(validate(key, None).is_err());
    }
    assert!(validate("auth-deployment", Some(&"x".repeat(16_385))).is_err());
    for origin in ["https://evil.example", "https://localhost.evil.example", "file:///tmp/index.html"] {
      assert!(!trusted_origin("main", &tauri::Url::parse(origin).unwrap()));
    }
    assert!(trusted_origin("main", &tauri::Url::parse("tauri://localhost/index.html").unwrap()));
    assert!(!trusted_origin("popup", &tauri::Url::parse("tauri://localhost").unwrap()));
  }

  #[test]
  #[cfg(target_os = "macos")]
  #[ignore = "Uses a disposable credential in the real macOS Keychain; run explicitly."]
  fn real_keychain_round_trip() {
    let nonce = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
    let key = format!("device-test-{nonce}");
    let directory = std::env::temp_dir().join(format!("openauthor-vault-test-{nonce}"));
    let result = (|| -> Result<(), String> {
      assert_eq!(access(&directory, Operation::Read, &key, None)?, None);
      assert_eq!(access(&directory, Operation::Create, &key, Some("first"))?, Some("first".into()));
      assert_eq!(access(&directory, Operation::Create, &key, Some("second"))?, Some("first".into()));
      access(&directory, Operation::Write, &key, Some("updated"))?;
      assert_eq!(access(&directory, Operation::Read, &key, None)?, Some("updated".into()));
      Ok(())
    })();
    access(&directory, Operation::Remove, &key, None).expect("remove disposable credential");
    assert_eq!(access(&directory, Operation::Read, &key, None).unwrap(), None);
    std::fs::remove_file(directory.join("credential-store.lock")).unwrap();
    std::fs::remove_dir(directory).unwrap();
    result.expect("Keychain round trip");
  }
}
