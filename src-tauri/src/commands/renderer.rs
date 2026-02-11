use crate::renderer_state::RendererState;
use crate::database_state::DatabaseState;
use serde::{Deserialize, Serialize};
use tauri::{State, Window};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TileData {
    pub id: u32,
    pub asset_id: i64, // Database asset ID for texture loading
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
    pub selected_ids: Vec<u32>,
}

#[tauri::command]
pub fn renderer_init(
    window: Window,
    state: State<'_, RendererState>,
) -> Result<String, String> {
    tracing::info!("Renderer init called");

    // Initialize the renderer with the Tauri window
    state.init(&window)?;

    Ok("Renderer initialized".to_string())
}

#[tauri::command]
pub fn renderer_resize(
    width: f32,
    height: f32,
    dpr: f32,
    state: State<'_, RendererState>,
) -> Result<(), String> {
    tracing::info!("Renderer resize: {}x{} @ {}", width, height, dpr);

    // Convert to physical pixels
    let physical_width = (width * dpr) as u32;
    let physical_height = (height * dpr) as u32;

    state.resize(physical_width, physical_height)
}

#[tauri::command]
pub fn renderer_update_tiles(
    payload: VisibleTilesPayload,
    renderer_state: State<'_, RendererState>,
) -> Result<(), String> {
    use noviforma_renderer::TileInstance;

    tracing::debug!(
        "Renderer update tiles: {} tiles visible, {} selected, viewport: {}x{} @ {}",
        payload.tiles.len(),
        payload.selected_ids.len(),
        payload.viewport_w,
        payload.viewport_h,
        payload.dpr
    );

    // Convert TileData to TileInstance, using already-loaded textures only
    // Don't load new textures here to avoid blocking the render loop
    let instances: Vec<TileInstance> = payload
        .tiles
        .iter()
        .map(|tile| {
            // Check if this tile is selected
            let is_selected = payload.selected_ids.contains(&tile.id);

            // Only use texture if it's already loaded (non-blocking check)
            let texture_index = renderer_state.get_texture_index(tile.asset_id);

            // Create instance with texture if available, otherwise use color
            if let Some(tex_idx) = texture_index {
                let mut instance = TileInstance::new_textured(tile.x, tile.y, tile.w, tile.h, tex_idx);

                // Brighten selected tiles by modulating color
                if is_selected {
                    instance.r = 1.5;
                    instance.g = 1.5;
                    instance.b = 1.5;
                }

                instance
            } else {
                // Fallback to color if no texture loaded yet
                let mut color = TileInstance::color_from_id(tile.id);
                if is_selected {
                    color[0] = (color[0] * 1.5).min(1.0);
                    color[1] = (color[1] * 1.5).min(1.0);
                    color[2] = (color[2] * 1.5).min(1.0);
                }
                TileInstance::new(tile.x, tile.y, tile.w, tile.h, color)
            }
        })
        .collect();

    // Update tiles in renderer (this also renders the frame)
    renderer_state.update_tiles(instances, payload.tiles.len())?;

    Ok(())
}

#[tauri::command]
pub fn renderer_load_texture(
    asset_id: i64,
    texture_path: String,
    state: State<'_, RendererState>,
) -> Result<u32, String> {
    tracing::debug!("Loading texture for asset {}: {}", asset_id, texture_path);
    state.load_texture(asset_id, &texture_path)
}

#[tauri::command]
pub fn renderer_load_textures_batch(
    asset_ids: Vec<i64>,
    renderer_state: State<'_, RendererState>,
    db_state: State<'_, DatabaseState>,
) -> Result<usize, String> {
    let mut loaded_count = 0;

    for asset_id in asset_ids {
        // Skip if already loaded
        if renderer_state.get_texture_index(asset_id).is_some() {
            continue;
        }

        // Get thumbnail path
        if let Ok(Some(thumb_path)) = db_state.get_thumbnail_path(asset_id) {
            if let Some(path_str) = thumb_path.to_str() {
                // Try to load texture
                match renderer_state.load_texture(asset_id, path_str) {
                    Ok(_) => {
                        loaded_count += 1;
                        tracing::debug!("Loaded texture for asset {}", asset_id);
                    }
                    Err(e) => {
                        tracing::warn!("Failed to load texture for asset {}: {}", asset_id, e);
                    }
                }
            }
        }
    }

    tracing::info!("Batch loaded {} textures", loaded_count);
    Ok(loaded_count)
}
