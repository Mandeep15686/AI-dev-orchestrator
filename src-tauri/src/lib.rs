// src-tauri/src/lib.rs
mod commands;
mod ipc;
mod database;

use tauri::Manager;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[cfg_attr(any(target_os = "android", target_os = "ios"), tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::new(
                std::env::var("RUST_LOG").unwrap_or_else(|_| "info".into()),
            ),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let db_path = app
                .path()
                .app_data_dir()
                .expect("app data dir")
                .join("orchestrator.db");
            database::init_db(&db_path).expect("DB init failed");
            app.manage(database::DbState::new(&db_path));
            app.manage(commands::process::ProcessRegistry::default());
            app.manage(ipc::SidecarState::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::git::git_status,
            commands::git::git_diff,
            commands::git::git_commit,
            commands::git::git_log,
            commands::git::git_create_worktree,
            commands::git::git_delete_worktree,
            commands::git::git_rollback,
            commands::git::git_merge_worktree,
            commands::process::spawn_agent_process,
            commands::process::kill_agent_process,
            commands::process::send_to_process,
            commands::process::list_processes,
            commands::keychain::store_credential,
            commands::keychain::get_credential,
            commands::keychain::delete_credential,
            commands::keychain::has_credential,
            database::db_execute,
            database::db_query,
            commands::fs::read_file,
            commands::fs::write_file,
            commands::fs::list_dir,
            commands::fs::ensure_dir,
            commands::fs::file_exists,
            commands::fs::append_file,
            commands::fs::delete_path,
        ])
        .run(tauri::generate_context!())
        .expect("error running tauri application");
}
