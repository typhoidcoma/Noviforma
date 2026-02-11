// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod database_state;

use database_state::DatabaseState;
use tracing_subscriber;

fn main() {
    // Initialize logging
    tracing_subscriber::fmt::init();

    tauri::Builder::default()
        .manage(DatabaseState::new())
        .invoke_handler(tauri::generate_handler![
            commands::database::db_init,
            commands::database::db_scan_directory,
            commands::database::db_generate_thumbnails,
            commands::database::db_get_all_assets,
            commands::database::db_get_asset,
            commands::database::db_count_assets,
            commands::database::db_get_thumbnail_path,
            commands::database::db_clear_all_assets,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
