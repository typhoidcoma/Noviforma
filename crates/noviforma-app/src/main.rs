use noviforma_core::{Asset, Database, ThumbnailGenerator};
use noviforma_renderer::instance::TileInstance;
use noviforma_renderer::state::State;
use std::collections::HashMap;
use std::sync::Arc;
use tracing::info;
use winit::{
    application::ApplicationHandler,
    event::{ElementState, MouseButton, WindowEvent},
    event_loop::{ActiveEventLoop, ControlFlow, EventLoop},
    window::{Window, WindowId},
};

struct App {
    window: Option<Window>,
    state: Option<State>,
    // Pan state
    pan_offset: (f32, f32),
    is_dragging: bool,
    last_mouse_pos: (f32, f32),
    // Asset management
    assets: Vec<Asset>,
    texture_indices: HashMap<i64, u32>, // Maps asset ID to GPU texture index
    tile_size: f32,
    gutter: f32,
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
        tile_size: f32,
        gutter: f32,
    ) -> Vec<TileInstance> {
        if assets.is_empty() {
            return Vec::new();
        }

        let effective_tile_size = tile_size + gutter;

        // Calculate grid dimensions based on viewport width
        let cols = ((viewport_width as f32) / effective_tile_size).floor().max(1.0) as u32;

        // Calculate visible range with pan offset
        let start_x = (-pan_offset.0).max(0.0);
        let start_y = (-pan_offset.1).max(0.0);
        let end_x = start_x + viewport_width as f32;
        let end_y = start_y + viewport_height as f32;

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

                // Use texture if available, otherwise use colored quad
                if let Some(&texture_idx) = texture_indices.get(&asset.id) {
                    instances.push(TileInstance::new_textured(x, y, tile_size, tile_size, texture_idx));
                } else {
                    // Fallback to deterministic color if no texture
                    let color = TileInstance::color_from_id(asset.id as u32);
                    instances.push(TileInstance::new(x, y, tile_size, tile_size, color));
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
                self.tile_size,
                self.gutter,
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
}

impl ApplicationHandler for App {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        if self.window.is_none() {
            let window_attributes = Window::default_attributes()
                .with_title("Noviforma - M1: Database + Thumbnails + GPU Textures")
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
                        }
                        ElementState::Released => {
                            self.is_dragging = false;
                        }
                    }
                }
            }
            WindowEvent::CursorMoved { position, .. } => {
                let current_pos = (position.x as f32, position.y as f32);

                if self.is_dragging {
                    let delta_x = current_pos.0 - self.last_mouse_pos.0;
                    let delta_y = current_pos.1 - self.last_mouse_pos.1;

                    self.pan_offset.0 += delta_x;
                    self.pan_offset.1 += delta_y;

                    self.update_visible_tiles();
                }

                self.last_mouse_pos = current_pos;
            }
            WindowEvent::RedrawRequested => {
                if let Some(state) = &mut self.state {
                    match state.render() {
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
        pan_offset: (0.0, 0.0),
        is_dragging: false,
        last_mouse_pos: (0.0, 0.0),
        assets,
        texture_indices: HashMap::new(), // Will be populated after thumbnails are loaded
        tile_size: 192.0, // Slightly larger for thumbnails
        gutter: 8.0,
        database,
        thumbnail_gen,
    };

    event_loop
        .run_app(&mut app)
        .expect("Event loop error");
}
