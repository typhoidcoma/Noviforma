// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod renderer_state;
mod database_state;

use renderer_state::RendererState;
use database_state::DatabaseState;
use tauri::Manager;
use tracing_subscriber;

fn main() {
    // Initialize logging
    tracing_subscriber::fmt::init();

    tauri::Builder::default()
        .manage(RendererState::new())
        .manage(DatabaseState::new())
        .setup(|app| {
            // Initialize renderer after window is created to avoid deadlock
            let window = app.get_webview_window("main")
                .ok_or("Failed to get main window")?;

            let renderer_state: tauri::State<RendererState> = app.state();

            // Initialize renderer in setup hook (not in command handler)
            // This avoids deadlock with pollster::block_on
            renderer_state.init(&window)
                .map_err(|e| {
                    tracing::error!("Failed to initialize renderer in setup: {}", e);
                    e
                })?;

            tracing::info!("Renderer initialized in setup hook");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::renderer::renderer_init,
            commands::renderer::renderer_resize,
            commands::renderer::renderer_update_tiles,
            commands::renderer::renderer_load_texture,
            commands::renderer::renderer_load_textures_batch,
            commands::renderer::renderer_enter_viewer,
            commands::renderer::renderer_exit_viewer,
            commands::renderer::renderer_render_viewer,
            commands::renderer::renderer_update_viewer_pan,
            commands::renderer::renderer_update_viewer_zoom,
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
