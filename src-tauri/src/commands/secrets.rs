//! Windows 凭据管理器封装（SRS 第 11 章）。
//! service = com.weightcoach.desktop，account = ai-key-{provider}。
//! 前端永远拿不到明文 Key，只拿到末 4 位。

use serde::Serialize;

const SERVICE: &str = "com.weightcoach.desktop";

fn account(provider: &str) -> String {
    format!("ai-key-{provider}")
}

#[derive(Serialize)]
#[serde(rename_all = "snake_case")]
pub struct SecretStatus {
    pub configured: bool,
    pub last4: Option<String>,
}

#[tauri::command]
pub fn secret_set(provider: String, key: String) -> Result<(), String> {
    let entry = keyring::Entry::new(SERVICE, &account(&provider)).map_err(|e| e.to_string())?;
    entry.set_password(&key).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn secret_status(provider: String) -> Result<SecretStatus, String> {
    let entry = keyring::Entry::new(SERVICE, &account(&provider)).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(k) => {
            let last4 = if k.len() >= 4 { Some(k[k.len() - 4..].to_string()) } else { Some(k) };
            Ok(SecretStatus { configured: true, last4 })
        }
        Err(keyring::Error::NoEntry) => Ok(SecretStatus { configured: false, last4: None }),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn secret_delete(provider: String) -> Result<(), String> {
    let entry = keyring::Entry::new(SERVICE, &account(&provider)).map_err(|e| e.to_string())?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}
