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
            // Tag commands
            commands::database::db_create_tag,
            commands::database::db_get_all_tags,
            commands::database::db_delete_tag,
            commands::database::db_add_tag_to_asset,
            commands::database::db_remove_tag_from_asset,
            commands::database::db_get_asset_tags,
            // Note commands
            commands::database::db_set_asset_note,
            commands::database::db_get_asset_note,
            // Rating commands
            commands::database::db_set_asset_rating,
            commands::database::db_get_asset_rating,
            // Folder commands
            commands::database::db_get_all_folders,
            commands::database::db_get_folder,
            commands::database::db_set_current_folder,
            commands::database::db_get_current_folder,
            commands::database::db_get_assets_by_folder,
            commands::database::db_delete_folder,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
