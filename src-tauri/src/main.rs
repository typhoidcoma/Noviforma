// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod renderer_state;
mod database_state;

use renderer_state::RendererState;
use database_state::DatabaseState;
use tracing_subscriber;

fn main() {
    // Initialize logging
    tracing_subscriber::fmt::init();

    tauri::Builder::default()
        .manage(RendererState::new())
        .manage(DatabaseState::new())
        .invoke_handler(tauri::generate_handler![
            commands::renderer::renderer_init,
            commands::renderer::renderer_resize,
            commands::renderer::renderer_update_tiles,
            commands::renderer::renderer_load_texture,
            commands::renderer::renderer_load_textures_batch,
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
