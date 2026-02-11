use noviforma_core::{Asset, Database, ThumbnailGenerator};
use noviforma_renderer::instance::{TileInstance, ViewerInstance};
use noviforma_renderer::state::State;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use tracing::info;
use winit::{
    application::ApplicationHandler,
    event::{ElementState, MouseButton, MouseScrollDelta, WindowEvent},
    event_loop::{ActiveEventLoop, ControlFlow, EventLoop},
    keyboard::{KeyCode, PhysicalKey},
    window::{Window, WindowId},
};

#[derive(Debug, Clone, Copy, PartialEq)]
enum ViewMode {
    Grid,
    Viewer { asset_id: i64 },
}

struct App {
    window: Option<Window>,
    state: Option<State>,
    // View mode
    view_mode: ViewMode,
    // Pan state
    pan_offset: (f32, f32),
    is_dragging: bool,
    last_mouse_pos: (f32, f32),
    // Selection state
    selected_tiles: HashSet<i64>, // Asset IDs
    last_click_pos: Option<(f32, f32)>,
    hovered_tile_id: Option<i64>, // Current hover
    // Viewer state (independent from grid)
    viewer_pan: (f32, f32),
    viewer_zoom: f32,
    // Asset management
    assets: Vec<Asset>,
    texture_indices: HashMap<i64, u32>, // Maps asset ID to GPU texture index
    tile_size: f32,
    gutter: f32,
    zoom_level: f32, // 1.0 = 100%, 0.5 = 50%, 3.0 = 300%
    // Database (shared)
    database: Arc<Database>,
    thumbnail_gen: Arc<ThumbnailGenerator>,
}

impl App {
    /// Calculate which tiles are visible in the current viewport
    fn calculate_visible_tiles(
        viewport_width: u32,
        viewport_height: u32,
        pan_offset: (f32, f32),
        assets: &[Asset],
        texture_indices: &HashMap<i64, u32>,
        selected_tiles: &HashSet<i64>,
        hovered_tile_id: Option<i64>,
        tile_size: f32,
        gutter: f32,
        zoom_level: f32,
    ) -> Vec<TileInstance> {
        if assets.is_empty() {
            return Vec::new();
        }

        // Calculate zoomed tile size (this is what actually scales)
        let zoomed_tile_size = tile_size * zoom_level;

        // Gutter stays constant regardless of zoom
        let effective_tile_size = zoomed_tile_size + gutter;

        // Calculate grid dimensions - use a reasonable number of columns that fits most content
        // This creates a stable grid layout that doesn't reflow on every resize
        let cols = 10u32; // Fixed 10-column layout

        // Calculate visible range with pan offset
        let start_x = (-pan_offset.0).max(0.0);
        let start_y = (-pan_offset.1).max(0.0);

        // Calculate tile range
        let start_col = (start_x / effective_tile_size).floor() as u32;
        let start_row = (start_y / effective_tile_size).floor() as u32;
        let end_col = start_col + (viewport_width as f32 / effective_tile_size).ceil() as u32 + 1;
        let end_row = start_row + (viewport_height as f32 / effective_tile_size).ceil() as u32 + 1;

        let mut instances = Vec::new();
        for row in start_row..end_row {
            for col in start_col..end_col {
                let asset_idx = (row * cols + col) as usize;
                if asset_idx >= assets.len() {
                    break;
                }

                let x = col as f32 * effective_tile_size + gutter + pan_offset.0;
                let y = row as f32 * effective_tile_size + gutter + pan_offset.1;

                let asset = &assets[asset_idx];

                // Calculate tile dimensions based on aspect ratio
                let (tile_w, tile_h) = if let (Some(w), Some(h)) = (asset.width, asset.height) {
                    let aspect = w as f32 / h as f32;
                    if aspect > 1.0 {
                        // Landscape: fit to width
                        (zoomed_tile_size, zoomed_tile_size / aspect)
                    } else {
                        // Portrait or square: fit to height
                        (zoomed_tile_size * aspect, zoomed_tile_size)
                    }
                } else {
                    // No dimensions available, use square
                    (zoomed_tile_size, zoomed_tile_size)
                };

                // Center the tile in its grid cell
                let centered_x = x + (zoomed_tile_size - tile_w) * 0.5;
                let centered_y = y + (zoomed_tile_size - tile_h) * 0.5;

                // Use texture if available, otherwise use colored quad
                if let Some(&texture_idx) = texture_indices.get(&asset.id) {
                    instances.push(TileInstance::new_textured(centered_x, centered_y, tile_w, tile_h, texture_idx));
                } else {
                    // Fallback to deterministic color if no texture
                    let mut color = TileInstance::color_from_id(asset.id as u32);

                    // Darken selected tiles
                    if selected_tiles.contains(&asset.id) {
                        color[0] *= 0.6;
                        color[1] *= 0.6;
                        color[2] *= 0.6;
                    }

                    // Brighten hovered tile
                    if Some(asset.id) == hovered_tile_id {
                        color[0] = (color[0] * 1.3).min(1.0);
                        color[1] = (color[1] * 1.3).min(1.0);
                        color[2] = (color[2] * 1.3).min(1.0);
                    }

                    instances.push(TileInstance::new(centered_x, centered_y, tile_w, tile_h, color));
                }
            }
        }

        instances
    }

    /// Update visible tiles based on current viewport and pan offset
    fn update_visible_tiles(&mut self) {
        if let (Some(state), Some(window)) = (&mut self.state, &self.window) {
            let size = window.inner_size();
            let instances = Self::calculate_visible_tiles(
                size.width,
                size.height,
                self.pan_offset,
                &self.assets,
                &self.texture_indices,
                &self.selected_tiles,
                self.hovered_tile_id,
                self.tile_size,
                self.gutter,
                self.zoom_level,
            );
            info!(
                "Updating tiles: {} visible of {} total (pan offset: {:.0}, {:.0})",
                instances.len(),
                self.assets.len(),
                self.pan_offset.0,
                self.pan_offset.1
            );
            state.update_tiles(instances);
        }
    }

    /// Convert screen coordinates to tile ID (asset ID)
    fn screen_to_tile_id(&self, screen_x: f32, screen_y: f32) -> Option<i64> {
        if self.assets.is_empty() {
            return None;
        }

        let base_tile_size = self.tile_size + self.gutter;
        let effective_tile_size = base_tile_size * self.zoom_level;

        // Convert screen to world coords (accounting for pan offset)
        let world_x = screen_x - self.pan_offset.0;
        let world_y = screen_y - self.pan_offset.1;

        // Negative world coords = outside grid
        if world_x < 0.0 || world_y < 0.0 {
            return None;
        }

        // Calculate grid position
        let col = (world_x / effective_tile_size).floor() as u32;
        let row = (world_y / effective_tile_size).floor() as u32;

        // Fixed 10-column grid layout (same as calculate_visible_tiles)
        let cols = 10u32;

        // Calculate tile index
        let tile_idx = (row * cols + col) as usize;

        // Return asset ID if tile exists
        self.assets.get(tile_idx).map(|a| a.id)
    }
}

impl ApplicationHandler for App {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        if self.window.is_none() {
            let window_attributes = Window::default_attributes()
                .with_title("Noviforma - M2: Interactive Grid (Zoom, Select, Hover, Keyboard)")
                .with_inner_size(winit::dpi::PhysicalSize::new(1600, 1000))
                .with_min_inner_size(winit::dpi::PhysicalSize::new(800, 600));

            let window = event_loop
                .create_window(window_attributes)
                .expect("Failed to create window");

            // Store window first
            let size = window.inner_size();
            self.window = Some(window);

            // Initialize wgpu state using reference to stored window
            let state = pollster::block_on(State::new(
                self.window.as_ref().unwrap(),
                size.width,
                size.height,
            ))
            .expect("Failed to initialize wgpu");

            info!("Window created: {}x{}", size.width, size.height);

            self.state = Some(state);

            // Set total tile count for stats
            if let Some(state) = &mut self.state {
                state.set_total_tiles(self.assets.len());

                // Load thumbnails into GPU texture array
                info!("Loading thumbnails into GPU...");
                let mut loaded_count = 0;
                for asset in &self.assets {
                    if let Some(ref thumb_path) = asset.thumbnail_path {
                        if std::path::Path::new(thumb_path).exists() {
                            match state.load_texture(thumb_path) {
                                Ok(texture_idx) => {
                                    self.texture_indices.insert(asset.id, texture_idx);
                                    loaded_count += 1;
                                }
                                Err(e) => {
                                    tracing::warn!("Failed to load thumbnail {}: {}", thumb_path, e);
                                }
                            }
                        }
                    }
                }
                info!("Loaded {} thumbnails into GPU", loaded_count);
            }

            // Calculate and update visible tiles
            self.update_visible_tiles();

            info!("Loaded {} assets", self.assets.len());
        }
    }

    fn window_event(
        &mut self,
        event_loop: &ActiveEventLoop,
        _window_id: WindowId,
        event: WindowEvent,
    ) {
        match event {
            WindowEvent::CloseRequested => {
                info!("Close requested, exiting...");
                event_loop.exit();
            }
            WindowEvent::Resized(physical_size) => {
                info!("Window resized: {}x{}", physical_size.width, physical_size.height);
                if let Some(state) = &mut self.state {
                    state.resize(physical_size.width, physical_size.height);
                    self.update_visible_tiles();
                }
            }
            WindowEvent::MouseInput { state, button, .. } => {
                if button == MouseButton::Left {
                    match state {
                        ElementState::Pressed => {
                            self.is_dragging = true;
                            self.last_click_pos = Some(self.last_mouse_pos);
                        }
                        ElementState::Released => {
                            self.is_dragging = false;

                            // Only handle click selection in Grid mode
                            if matches!(self.view_mode, ViewMode::Grid) {
                                if let Some(click_pos) = self.last_click_pos {
                                    let distance = ((self.last_mouse_pos.0 - click_pos.0).powi(2)
                                        + (self.last_mouse_pos.1 - click_pos.1).powi(2))
                                    .sqrt();

                                    if distance < 5.0 {
                                        if let Some(tile_id) = self.screen_to_tile_id(click_pos.0, click_pos.1) {
                                            if self.selected_tiles.contains(&tile_id) {
                                                self.selected_tiles.remove(&tile_id);
                                                info!("Deselected tile {}", tile_id);
                                            } else {
                                                self.selected_tiles.insert(tile_id);
                                                info!("Selected tile {}", tile_id);
                                            }
                                            self.update_visible_tiles();
                                        }
                                    }
                                }
                            }

                            self.last_click_pos = None;
                        }
                    }
                }
            }
            WindowEvent::CursorMoved { position, .. } => {
                let current_pos = (position.x as f32, position.y as f32);

                if self.is_dragging {
                    let delta_x = current_pos.0 - self.last_mouse_pos.0;
                    let delta_y = current_pos.1 - self.last_mouse_pos.1;

                    match self.view_mode {
                        ViewMode::Grid => {
                            // Grid panning
                            self.pan_offset.0 += delta_x;
                            self.pan_offset.1 += delta_y;
                            self.update_visible_tiles();
                        }
                        ViewMode::Viewer { .. } => {
                            // Viewer panning
                            self.viewer_pan.0 += delta_x;
                            self.viewer_pan.1 += delta_y;
                            if let Some(window) = &self.window {
                                window.request_redraw();
                            }
                        }
                    }
                } else if matches!(self.view_mode, ViewMode::Grid) {
                    // Update hover in grid mode when not dragging
                    let tile_id = self.screen_to_tile_id(current_pos.0, current_pos.1);
                    if tile_id != self.hovered_tile_id {
                        self.hovered_tile_id = tile_id;
                        self.update_visible_tiles();
                    }
                }

                self.last_mouse_pos = current_pos;
            }
            WindowEvent::MouseWheel { delta, .. } => {
                // Calculate zoom delta
                let zoom_delta = match delta {
                    MouseScrollDelta::LineDelta(_x, y) => {
                        // Line-based scrolling (typical for mouse wheels)
                        y * 0.1
                    }
                    MouseScrollDelta::PixelDelta(pos) => {
                        // Pixel-based scrolling (trackpads, touch)
                        (pos.y as f32) * 0.01
                    }
                };

                match self.view_mode {
                    ViewMode::Grid => {
                        // Grid zoom with cursor centering
                        let old_zoom = self.zoom_level;
                        let new_zoom = (self.zoom_level * (1.0 + zoom_delta)).clamp(0.5, 3.0);

                        if (new_zoom - old_zoom).abs() > 0.001 {
                            let cursor_x = self.last_mouse_pos.0;
                            let cursor_y = self.last_mouse_pos.1;
                            let world_x_before = (cursor_x - self.pan_offset.0) / old_zoom;
                            let world_y_before = (cursor_y - self.pan_offset.1) / old_zoom;

                            self.zoom_level = new_zoom;

                            self.pan_offset.0 = cursor_x - (world_x_before * new_zoom);
                            self.pan_offset.1 = cursor_y - (world_y_before * new_zoom);

                            info!("Grid zoom: {:.2}x", self.zoom_level);
                            self.update_visible_tiles();
                        }
                    }
                    ViewMode::Viewer { .. } => {
                        // Viewer zoom (simpler, just scale)
                        let old_zoom = self.viewer_zoom;
                        let new_zoom = (self.viewer_zoom * (1.0 + zoom_delta)).clamp(0.25, 4.0);

                        if (new_zoom - old_zoom).abs() > 0.001 {
                            self.viewer_zoom = new_zoom;
                            info!("Viewer zoom: {:.2}x", self.viewer_zoom);
                            if let Some(window) = &self.window {
                                window.request_redraw();
                            }
                        }
                    }
                }
            }
            WindowEvent::KeyboardInput { event, .. } => {
                if event.state == ElementState::Pressed {
                    match event.physical_key {
                        PhysicalKey::Code(KeyCode::ArrowLeft) => {
                            self.pan_offset.0 += 100.0;
                            self.update_visible_tiles();
                        }
                        PhysicalKey::Code(KeyCode::ArrowRight) => {
                            self.pan_offset.0 -= 100.0;
                            self.update_visible_tiles();
                        }
                        PhysicalKey::Code(KeyCode::ArrowUp) => {
                            self.pan_offset.1 += 100.0;
                            self.update_visible_tiles();
                        }
                        PhysicalKey::Code(KeyCode::ArrowDown) => {
                            self.pan_offset.1 -= 100.0;
                            self.update_visible_tiles();
                        }
                        PhysicalKey::Code(KeyCode::Equal) | PhysicalKey::Code(KeyCode::NumpadAdd) => {
                            // Zoom in
                            self.zoom_level = (self.zoom_level * 1.2).min(3.0);
                            info!("Zoom level: {:.2}x", self.zoom_level);
                            self.update_visible_tiles();
                        }
                        PhysicalKey::Code(KeyCode::Minus) | PhysicalKey::Code(KeyCode::NumpadSubtract) => {
                            // Zoom out
                            self.zoom_level = (self.zoom_level * 0.8).max(0.5);
                            info!("Zoom level: {:.2}x", self.zoom_level);
                            self.update_visible_tiles();
                        }
                        PhysicalKey::Code(KeyCode::Enter) => {
                            match self.view_mode {
                                ViewMode::Grid => {
                                    // Enter viewer mode with first selected tile (if it has a texture)
                                    if let Some(&asset_id) = self.selected_tiles.iter().next() {
                                        if self.texture_indices.contains_key(&asset_id) {
                                            info!("Entering viewer mode for asset {}", asset_id);
                                            self.view_mode = ViewMode::Viewer { asset_id };
                                            self.viewer_pan = (0.0, 0.0);
                                            self.viewer_zoom = 1.0;
                                            if let Some(window) = &self.window {
                                                window.request_redraw();
                                            }
                                        } else {
                                            info!("Cannot enter viewer mode: asset {} has no texture loaded", asset_id);
                                        }
                                    }
                                }
                                ViewMode::Viewer { .. } => {
                                    // Already in viewer, do nothing
                                }
                            }
                        }
                        PhysicalKey::Code(KeyCode::Escape) => {
                            match self.view_mode {
                                ViewMode::Grid => {
                                    // In grid, deselect all
                                    if !self.selected_tiles.is_empty() {
                                        self.selected_tiles.clear();
                                        self.update_visible_tiles();
                                    }
                                }
                                ViewMode::Viewer { .. } => {
                                    // Exit viewer mode
                                    info!("Exiting viewer mode");
                                    self.view_mode = ViewMode::Grid;
                                    if let Some(window) = &self.window {
                                        window.request_redraw();
                                    }
                                }
                            }
                        }
                        _ => {}
                    }
                }
            }
            WindowEvent::RedrawRequested => {
                // Check if we need to exit viewer mode (no texture available)
                if let ViewMode::Viewer { asset_id } = self.view_mode {
                    let has_texture = self.texture_indices.contains_key(&asset_id);
                    let asset_exists = self.assets.iter().any(|a| a.id == asset_id);

                    if !has_texture || !asset_exists {
                        if !has_texture {
                            info!("No texture for asset {}, exiting viewer mode", asset_id);
                        } else {
                            info!("Asset {} not found, exiting viewer mode", asset_id);
                        }
                        self.view_mode = ViewMode::Grid;
                        self.update_visible_tiles();
                    }
                }

                if let Some(state) = &mut self.state {
                    let render_result = match self.view_mode {
                        ViewMode::Grid => {
                            // Render grid with instanced tiles
                            state.render()
                        }
                        ViewMode::Viewer { asset_id } => {
                            // Render fullscreen viewer (we know texture exists from check above)
                            let asset = self.assets.iter().find(|a| a.id == asset_id).unwrap();
                            let texture_index = self.texture_indices.get(&asset_id).copied().unwrap();

                            // Calculate aspect ratio (default to 1.0 if dimensions missing)
                            let aspect_ratio = if let (Some(w), Some(h)) = (asset.width, asset.height) {
                                w as f32 / h as f32
                            } else {
                                1.0
                            };

                            let instance = ViewerInstance::new(
                                aspect_ratio,
                                self.viewer_zoom,
                                self.viewer_pan,
                                texture_index,
                            );
                            state.render_viewer(instance)
                        }
                    };

                    match render_result {
                        Ok(_) => {}
                        Err(wgpu::SurfaceError::Lost) => {
                            info!("Surface lost, reconfiguring...");
                            let size = state.size;
                            state.resize(size.0, size.1);
                        }
                        Err(wgpu::SurfaceError::OutOfMemory) => {
                            tracing::error!("Out of memory!");
                            event_loop.exit();
                        }
                        Err(e) => tracing::warn!("Render error: {:?}", e),
                    }
                }
            }
            _ => {}
        }
    }

    fn about_to_wait(&mut self, _event_loop: &ActiveEventLoop) {
        if let Some(window) = &self.window {
            window.request_redraw();
        }
    }
}

fn main() {
    // Initialize logging
    tracing_subscriber::fmt()
        .with_max_level(tracing::Level::INFO)
        .init();

    info!("Starting Noviforma M1 (Database + Thumbnails)...");

    // Initialize database
    let db_path = "noviforma.db";
    let database = Arc::new(Database::new(db_path).expect("Failed to create database"));
    info!("Database initialized: {}", db_path);

    // Initialize thumbnail generator
    let cache_dir = ".cache/thumbs";
    let thumbnail_gen = Arc::new(
        ThumbnailGenerator::new(cache_dir).expect("Failed to create thumbnail generator"),
    );

    // Scan for images (use test directory or create dummy assets)
    let scan_dir = std::env::var("NOVIFORMA_SCAN_DIR").unwrap_or_else(|_| ".".to_string());
    info!("Scanning directory: {}", scan_dir);

    let found_assets = noviforma_core::scan_directory(&scan_dir);
    info!("Found {} image files", found_assets.len());

    // Insert assets into database (if not already present)
    let mut assets = Vec::new();
    for asset in found_assets {
        match database.insert_asset(&asset) {
            Ok(id) => {
                let mut asset_with_id = asset.clone();
                asset_with_id.id = id;
                assets.push(asset_with_id);
            }
            Err(e) => {
                // Asset might already exist (unique path constraint)
                tracing::debug!("Skipping asset {}: {}", asset.path, e);
            }
        }
    }

    // If no assets found, load from database
    if assets.is_empty() {
        assets = database.get_all_assets().expect("Failed to load assets");
        info!("Loaded {} assets from database", assets.len());
    }

    // If still no assets, create a fallback virtual grid
    if assets.is_empty() {
        info!("No assets found - creating virtual grid for testing");
        for i in 0..100 {
            assets.push(Asset {
                id: i as i64,
                path: format!("virtual_{}.jpg", i),
                filename: format!("virtual_{}.jpg", i),
                file_size: 0,
                width: Some(512),
                height: Some(512),
                thumbnail_path: None,
                created_at: 0,
                indexed_at: 0,
            });
        }
    }

    info!("Total assets: {}", assets.len());

    // Generate thumbnails for assets that don't have them
    info!("Generating thumbnails...");
    let mut thumbnails_generated = 0;
    for asset in &mut assets {
        // Skip virtual assets (no real file)
        if !std::path::Path::new(&asset.path).exists() {
            continue;
        }

        // Check if thumbnail already exists
        if asset.thumbnail_path.is_some() && thumbnail_gen.exists(asset.id) {
            continue;
        }

        // Generate thumbnail
        match thumbnail_gen.generate(&asset.path, asset.id) {
            Ok(thumb_path) => {
                let thumb_path_str = thumb_path.to_string_lossy().to_string();
                asset.thumbnail_path = Some(thumb_path_str.clone());

                // Update database
                if let Err(e) = database.update_thumbnail(asset.id, &thumb_path_str) {
                    tracing::warn!("Failed to update thumbnail path for {}: {}", asset.path, e);
                }

                thumbnails_generated += 1;
                tracing::debug!("Generated thumbnail for {}", asset.filename);
            }
            Err(e) => {
                tracing::warn!("Failed to generate thumbnail for {}: {}", asset.path, e);
            }
        }
    }

    info!("Generated {} thumbnails", thumbnails_generated);

    // Create event loop
    let event_loop = EventLoop::new().expect("Failed to create event loop");
    event_loop.set_control_flow(ControlFlow::Poll);

    let mut app = App {
        window: None,
        state: None,
        view_mode: ViewMode::Grid,
        pan_offset: (0.0, 0.0),
        is_dragging: false,
        last_mouse_pos: (0.0, 0.0),
        selected_tiles: HashSet::new(),
        last_click_pos: None,
        hovered_tile_id: None,
        viewer_pan: (0.0, 0.0),
        viewer_zoom: 1.0,
        assets,
        texture_indices: HashMap::new(), // Will be populated after thumbnails are loaded
        tile_size: 192.0, // Slightly larger for thumbnails
        gutter: 8.0,
        zoom_level: 1.0, // Default 100% zoom
        database,
        thumbnail_gen,
    };

    event_loop
        .run_app(&mut app)
        .expect("Event loop error");
}
