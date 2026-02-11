use crate::renderer_state::{RendererState, ViewMode};
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
    _window: Window,
    _state: State<'_, RendererState>,
) -> Result<String, String> {
    // Renderer is now initialized in the Tauri setup hook (main.rs)
    // This command is kept for backward compatibility but does nothing
    tracing::debug!("Renderer init command called (no-op, already initialized in setup)");
    Ok("Renderer already initialized".to_string())
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

    tracing::info!(
        "Renderer update tiles: {} tiles visible, {} selected, viewport: {}x{} @ {}",
        payload.tiles.len(),
        payload.selected_ids.len(),
        payload.viewport_w,
        payload.viewport_h,
        payload.dpr
    );

    // Convert TileData to TileInstance, using already-loaded textures only
    // Don't load new textures here to avoid blocking the render loop
    let instances: Vec<(TileInstance, bool)> = payload
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

                (instance, true) // true = has texture
            } else {
                // Fallback to color if no texture loaded yet
                let mut color = TileInstance::color_from_id(tile.id);
                if is_selected {
                    color[0] = (color[0] * 1.5).min(1.0);
                    color[1] = (color[1] * 1.5).min(1.0);
                    color[2] = (color[2] * 1.5).min(1.0);
                }
                (TileInstance::new(tile.x, tile.y, tile.w, tile.h, color), false) // false = no texture
            }
        })
        .collect();

    let textured_count = instances.iter().filter(|(_, has_tex)| *has_tex).count();
    let color_count = instances.len() - textured_count;
    tracing::info!("Tiles: {} textured, {} colored (total {})", textured_count, color_count, payload.tiles.len());

    let instances: Vec<TileInstance> = instances.into_iter().map(|(inst, _)| inst).collect();

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

#[tauri::command]
pub fn renderer_enter_viewer(
    asset_id: i64,
    state: State<'_, RendererState>,
) -> Result<(), String> {
    tracing::info!("Entering viewer mode for asset {}", asset_id);
    state.set_view_mode(ViewMode::Viewer { asset_id })
}

#[tauri::command]
pub fn renderer_exit_viewer(
    state: State<'_, RendererState>,
) -> Result<(), String> {
    tracing::info!("Exiting viewer mode");
    state.set_view_mode(ViewMode::Grid)
}

#[tauri::command]
pub fn renderer_render_viewer(
    asset_id: i64,
    aspect_ratio: f32,
    state: State<'_, RendererState>,
) -> Result<(), String> {
    tracing::debug!("Rendering viewer for asset {} (aspect: {})", asset_id, aspect_ratio);
    state.render_viewer(asset_id, aspect_ratio)
}

#[tauri::command]
pub fn renderer_update_viewer_pan(
    delta_x: f32,
    delta_y: f32,
    state: State<'_, RendererState>,
) -> Result<(), String> {
    // Get current pan and update
    let pan = state.get_viewer_pan()?;
    let new_pan = (pan.0 + delta_x, pan.1 + delta_y);
    state.set_viewer_pan(new_pan)
}

#[tauri::command]
pub fn renderer_update_viewer_zoom(
    delta: f32,
    state: State<'_, RendererState>,
) -> Result<(), String> {
    // Get current zoom and update
    let zoom = state.get_viewer_zoom()?;
    let new_zoom = (zoom * (1.0 + delta)).clamp(0.25, 4.0);
    state.set_viewer_zoom(new_zoom)
}
