use crate::database_state::{DatabaseState, ScanResult, ThumbnailResult};
use noviforma_core::{Asset, Tag, Note, Rating, Folder};
use std::path::PathBuf;
use std::sync::atomic::Ordering;
use tauri::State;

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

/// Poll current thumbnail generation progress (called from frontend via setInterval)
#[derive(serde::Serialize)]
pub struct ProgressInfo {
    pub current: usize,
    pub total: usize,
}

#[tauri::command]
pub fn db_get_thumbnail_progress(
    state: State<'_, DatabaseState>,
) -> ProgressInfo {
    ProgressInfo {
        current: state.progress_current.load(Ordering::Relaxed),
        total: state.progress_total.load(Ordering::Relaxed),
    }
}

#[tauri::command]
pub async fn db_generate_thumbnails(
    state: State<'_, DatabaseState>,
) -> Result<ThumbnailResult, String> {
    tracing::info!("Generating thumbnails (async)");

    let state_clone = state.inner().clone();

    let result = tauri::async_runtime::spawn_blocking(move || {
        state_clone.generate_thumbnails_with_progress(|_, _, _| {
            // Progress is tracked via shared atomic counters, polled by frontend
        })
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))??;

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

// ============================================================
// Tag Commands
// ============================================================

#[tauri::command]
pub fn db_create_tag(
    name: String,
    color: Option<String>,
    state: State<'_, DatabaseState>,
) -> Result<i64, String> {
    state.create_tag(&name, color.as_deref())
}

#[tauri::command]
pub fn db_get_all_tags(state: State<'_, DatabaseState>) -> Result<Vec<Tag>, String> {
    state.get_all_tags()
}

#[tauri::command]
pub fn db_delete_tag(tag_id: i64, state: State<'_, DatabaseState>) -> Result<(), String> {
    state.delete_tag(tag_id)
}

#[tauri::command]
pub fn db_add_tag_to_asset(
    asset_id: i64,
    tag_id: i64,
    state: State<'_, DatabaseState>,
) -> Result<(), String> {
    state.add_tag_to_asset(asset_id, tag_id)
}

#[tauri::command]
pub fn db_remove_tag_from_asset(
    asset_id: i64,
    tag_id: i64,
    state: State<'_, DatabaseState>,
) -> Result<(), String> {
    state.remove_tag_from_asset(asset_id, tag_id)
}

#[tauri::command]
pub fn db_get_asset_tags(
    asset_id: i64,
    state: State<'_, DatabaseState>,
) -> Result<Vec<Tag>, String> {
    state.get_asset_tags(asset_id)
}

// ============================================================
// Note Commands
// ============================================================

#[tauri::command]
pub fn db_set_asset_note(
    asset_id: i64,
    content: String,
    state: State<'_, DatabaseState>,
) -> Result<(), String> {
    state.set_note(asset_id, &content)
}

#[tauri::command]
pub fn db_get_asset_note(
    asset_id: i64,
    state: State<'_, DatabaseState>,
) -> Result<Option<Note>, String> {
    state.get_note(asset_id)
}

// ============================================================
// Rating Commands
// ============================================================

#[tauri::command]
pub fn db_set_asset_rating(
    asset_id: i64,
    rating: u32,
    state: State<'_, DatabaseState>,
) -> Result<(), String> {
    state.set_rating(asset_id, rating)
}

#[tauri::command]
pub fn db_get_asset_rating(
    asset_id: i64,
    state: State<'_, DatabaseState>,
) -> Result<Option<Rating>, String> {
    state.get_rating(asset_id)
}

// ============================================================
// Folder Commands
// ============================================================

#[tauri::command]
pub fn db_get_all_folders(state: State<'_, DatabaseState>) -> Result<Vec<Folder>, String> {
    state.get_all_folders()
}

#[tauri::command]
pub fn db_get_folder(
    folder_id: i64,
    state: State<'_, DatabaseState>,
) -> Result<Option<Folder>, String> {
    state.get_folder(folder_id)
}

#[tauri::command]
pub fn db_set_current_folder(
    folder_id: i64,
    state: State<'_, DatabaseState>,
) -> Result<(), String> {
    state.set_current_folder(folder_id)
}

#[tauri::command]
pub fn db_get_current_folder(state: State<'_, DatabaseState>) -> Result<Option<i64>, String> {
    Ok(state.get_current_folder())
}

#[tauri::command]
pub fn db_get_assets_by_folder(
    folder_id: i64,
    state: State<'_, DatabaseState>,
) -> Result<Vec<Asset>, String> {
    state.get_assets_by_folder(folder_id)
}

#[tauri::command]
pub fn db_delete_folder(
    folder_id: i64,
    state: State<'_, DatabaseState>,
) -> Result<(), String> {
    state.delete_folder(folder_id)
}
