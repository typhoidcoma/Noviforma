// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;

use tracing_subscriber;

fn main() {
    // Initialize logging
    tracing_subscriber::fmt::init();

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::renderer::renderer_init,
            commands::renderer::renderer_resize,
            commands::renderer::renderer_update_tiles,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
