use keyring::Entry;
use tauri::command;

const APP_NAME: &str = "ai-dev-orchestrator";

fn entry(service: &str, key: &str) -> Result<Entry, String> {
    Entry::new(&format!("{APP_NAME}/{service}"), key).map_err(|e| e.to_string())
}

#[command]
pub fn store_credential(service: String, key: String, value: String) -> Result<(), String> {
    entry(&service, &key)?.set_password(&value).map_err(|e| e.to_string())
}

#[command]
pub fn get_credential(service: String, key: String) -> Result<String, String> {
    entry(&service, &key)?.get_password().map_err(|e| e.to_string())
}

#[command]
pub fn delete_credential(service: String, key: String) -> Result<(), String> {
    entry(&service, &key)?.delete_credential().map_err(|e| e.to_string())
}

#[command]
pub fn has_credential(service: String, key: String) -> bool {
    entry(&service, &key)
        .and_then(|e| e.get_password().map(|_| ()).map_err(|e| keyring::Error::PlatformFailure(Box::new(e))))
        .is_ok()
}
