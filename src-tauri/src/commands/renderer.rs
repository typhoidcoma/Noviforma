use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TileData {
    pub id: u32,
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VisibleTilesPayload {
    pub tiles: Vec<TileData>,
    pub viewport_w: f32,
    pub viewport_h: f32,
    pub dpr: f32,
}

#[tauri::command]
pub fn renderer_init() -> Result<String, String> {
    tracing::info!("Renderer init called");
    Ok("Renderer initialized (stub)".to_string())
}

#[tauri::command]
pub fn renderer_resize(width: f32, height: f32, dpr: f32) -> Result<(), String> {
    tracing::info!("Renderer resize: {}x{} @ {}", width, height, dpr);
    Ok(())
}

#[tauri::command]
pub fn renderer_update_tiles(payload: VisibleTilesPayload) -> Result<(), String> {
    tracing::info!(
        "Renderer update tiles: {} tiles visible, viewport: {}x{} @ {}",
        payload.tiles.len(),
        payload.viewport_w,
        payload.viewport_h,
        payload.dpr
    );
    Ok(())
}
