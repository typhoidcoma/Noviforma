use crate::database_state::{DatabaseState, ScanResult, ThumbnailResult};
use noviforma_core::Asset;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, State};

#[tauri::command]
pub fn db_init(
    db_path: String,
    state: State<'_, DatabaseState>,
) -> Result<String, String> {
    tracing::info!("Initializing database at: {}", db_path);
    let path = PathBuf::from(db_path);
    state.init(path)?;
    Ok("Database initialized".to_string())
}

#[tauri::command]
pub fn db_scan_directory(
    path: String,
    state: State<'_, DatabaseState>,
) -> Result<ScanResult, String> {
    tracing::info!("Scanning directory: {}", path);
    let dir_path = PathBuf::from(path);
    state.scan_directory(dir_path)
}

#[derive(Clone, serde::Serialize)]
struct ThumbnailProgress {
    current: usize,
    total: usize,
    message: String,
}

#[tauri::command]
pub async fn db_generate_thumbnails(
    app: AppHandle,
    state: State<'_, DatabaseState>,
) -> Result<ThumbnailResult, String> {
    tracing::info!("Generating thumbnails (async)");

    // Get all assets that need thumbnails
    let assets = state.get_all_assets()?;
    let total = assets.len();

    // Emit initial progress
    let _ = app.emit(
        "thumbnail-progress",
        ThumbnailProgress {
            current: 0,
            total,
            message: format!("Starting thumbnail generation for {} assets...", total),
        },
    );

    // Spawn blocking task to generate thumbnails
    let state_clone = state.inner().clone();
    let app_clone = app.clone();

    let result = tauri::async_runtime::spawn_blocking(move || {
        state_clone.generate_thumbnails_with_progress(|current, total, message| {
            // Emit progress update
            let _ = app_clone.emit(
                "thumbnail-progress",
                ThumbnailProgress {
                    current,
                    total,
                    message: message.to_string(),
                },
            );
        })
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))??;

    // Emit completion
    let _ = app.emit(
        "thumbnail-progress",
        ThumbnailProgress {
            current: total,
            total,
            message: "Thumbnail generation complete".to_string(),
        },
    );

    Ok(result)
}

#[tauri::command]
pub fn db_get_all_assets(
    state: State<'_, DatabaseState>,
) -> Result<Vec<Asset>, String> {
    state.get_all_assets()
}

#[tauri::command]
pub fn db_get_asset(
    id: i64,
    state: State<'_, DatabaseState>,
) -> Result<Option<Asset>, String> {
    state.get_asset(id)
}

#[tauri::command]
pub fn db_count_assets(
    state: State<'_, DatabaseState>,
) -> Result<i64, String> {
    state.count_assets()
}

#[tauri::command]
pub fn db_get_thumbnail_path(
    asset_id: i64,
    state: State<'_, DatabaseState>,
) -> Result<Option<String>, String> {
    state.get_thumbnail_path(asset_id)
        .map(|opt| opt.map(|p| p.to_string_lossy().to_string()))
}

#[tauri::command]
pub fn db_clear_all_assets(
    state: State<'_, DatabaseState>,
) -> Result<usize, String> {
    tracing::info!("Clearing all assets from database");
    state.clear_all_assets()
}
