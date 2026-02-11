use noviforma_renderer::{Renderer, TileInstance};
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::Window;

/// Tauri-managed renderer state
pub struct RendererState {
    renderer: Mutex<Option<Renderer>>,
    /// Mapping of asset_id -> texture_index in GPU
    texture_map: Mutex<HashMap<i64, u32>>,
}

impl RendererState {
    pub fn new() -> Self {
        Self {
            renderer: Mutex::new(None),
            texture_map: Mutex::new(HashMap::new()),
        }
    }

    /// Initialize the renderer with a Tauri 2.0 window
    pub fn init(&self, window: &Window) -> Result<(), String> {
        // Get initial window size
        let size = window.inner_size()
            .map_err(|e| format!("Failed to get window size: {}", e))?;

        let width = size.width;
        let height = size.height;

        if width == 0 || height == 0 {
            return Err("Window has invalid dimensions".to_string());
        }

        tracing::info!("Initializing GPU renderer with window size: {}x{}", width, height);

        // Create wgpu instance
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
            backends: wgpu::Backends::PRIMARY,
            ..Default::default()
        });

        // Create surface from Tauri 2.0 window
        // Tauri 2.0 implements raw-window-handle 0.6, compatible with wgpu 0.20
        let surface: wgpu::Surface<'static> = unsafe {
            let temp_surface = instance
                .create_surface(window)
                .map_err(|e| format!("Failed to create surface: {:?}", e))?;

            // SAFETY: The window is owned by Tauri and outlives the renderer.
            // We transmute the lifetime to 'static since the surface will be dropped
            // when RendererState is dropped, which happens before window destruction.
            std::mem::transmute(temp_surface)
        };

        // Initialize renderer asynchronously using pollster to block
        let renderer = pollster::block_on(async {
            Renderer::new(surface, width, height).await
        })?;

        // Store renderer
        let mut r = self.renderer.lock().map_err(|e| e.to_string())?;
        *r = Some(renderer);

        tracing::info!("GPU renderer initialized successfully!");
        Ok(())
    }

    /// Resize the renderer viewport
    pub fn resize(&self, width: u32, height: u32) -> Result<(), String> {
        let mut renderer = self.renderer.lock().map_err(|e| e.to_string())?;

        if let Some(r) = renderer.as_mut() {
            r.resize(width, height);
            Ok(())
        } else {
            tracing::debug!("Resize called but renderer not initialized: {}x{}", width, height);
            Ok(()) // Don't error - just log
        }
    }

    /// Update visible tiles and render
    pub fn update_tiles(&self, tiles: Vec<TileInstance>, total: usize) -> Result<(), String> {
        let mut renderer = self.renderer.lock().map_err(|e| e.to_string())?;

        if let Some(r) = renderer.as_mut() {
            r.set_total_tiles(total);
            r.update_tiles(tiles);
            r.render_frame()?;
            Ok(())
        } else {
            // Renderer not initialized yet
            tracing::trace!(
                "Tile update: {} visible, {} total (renderer not initialized)",
                tiles.len(),
                total
            );
            Ok(())
        }
    }

    /// Render a frame
    pub fn render(&self) -> Result<(), String> {
        let mut renderer = self.renderer.lock().map_err(|e| e.to_string())?;

        if let Some(r) = renderer.as_mut() {
            r.render_frame()
        } else {
            Ok(()) // No-op if not initialized
        }
    }

    /// Load a texture into the GPU and return its texture index
    /// If the texture is already loaded, returns the existing index
    pub fn load_texture(&self, asset_id: i64, texture_path: &str) -> Result<u32, String> {
        // Check if already loaded
        {
            let texture_map = self.texture_map.lock().map_err(|e| e.to_string())?;
            if let Some(&texture_index) = texture_map.get(&asset_id) {
                tracing::debug!("Texture already loaded for asset {}: index {}", asset_id, texture_index);
                return Ok(texture_index);
            }
        }

        // Load texture into renderer
        let mut renderer = self.renderer.lock().map_err(|e| e.to_string())?;
        let renderer = renderer.as_mut().ok_or("Renderer not initialized")?;

        let texture_index = renderer.load_texture(texture_path)
            .map_err(|e| format!("Failed to load texture: {}", e))?;

        // Store mapping
        let mut texture_map = self.texture_map.lock().map_err(|e| e.to_string())?;
        texture_map.insert(asset_id, texture_index);

        tracing::info!("Loaded texture for asset {}: index {}", asset_id, texture_index);
        Ok(texture_index)
    }

    /// Get texture index for an asset (if loaded)
    pub fn get_texture_index(&self, asset_id: i64) -> Option<u32> {
        self.texture_map.lock().ok()?.get(&asset_id).copied()
    }
}
