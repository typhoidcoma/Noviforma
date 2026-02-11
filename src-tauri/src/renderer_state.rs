use noviforma_renderer::{Renderer, TileInstance, ViewerInstance};
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::WebviewWindow;

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum ViewMode {
    Grid,
    Viewer { asset_id: i64 },
}

/// Tauri-managed renderer state
pub struct RendererState {
    renderer: Mutex<Option<Renderer>>,
    /// Mapping of asset_id -> texture_index in GPU
    texture_map: Mutex<HashMap<i64, u32>>,
    /// Current view mode
    view_mode: Mutex<ViewMode>,
    /// Viewer state (pan, zoom)
    viewer_pan: Mutex<(f32, f32)>,
    viewer_zoom: Mutex<f32>,
}

impl RendererState {
    pub fn new() -> Self {
        Self {
            renderer: Mutex::new(None),
            texture_map: Mutex::new(HashMap::new()),
            view_mode: Mutex::new(ViewMode::Grid),
            viewer_pan: Mutex::new((0.0, 0.0)),
            viewer_zoom: Mutex::new(1.0),
        }
    }

    /// Initialize the renderer with a Tauri 2.0 window
    pub fn init<R: tauri::Runtime>(&self, window: &WebviewWindow<R>) -> Result<(), String> {
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
            // Inline renderer initialization to avoid creating a second wgpu instance
            // Request adapter (prefer high-performance GPU)
            let adapter = instance
                .request_adapter(&wgpu::RequestAdapterOptions {
                    power_preference: wgpu::PowerPreference::HighPerformance,
                    compatible_surface: Some(&surface),
                    force_fallback_adapter: false,
                })
                .await
                .ok_or_else(|| "Failed to find suitable GPU adapter".to_string())?;

            tracing::info!(
                "Selected GPU adapter: {} ({:?})",
                adapter.get_info().name,
                adapter.get_info().backend
            );

            // Request device and queue
            let (device, queue) = adapter
                .request_device(
                    &wgpu::DeviceDescriptor {
                        label: Some("Noviforma Render Device"),
                        required_features: wgpu::Features::empty(),
                        required_limits: wgpu::Limits::default(),
                    },
                    None,
                )
                .await
                .map_err(|e| format!("Failed to create device: {:?}", e))?;

            // Get surface capabilities
            let surface_caps = surface.get_capabilities(&adapter);
            let surface_format = surface_caps
                .formats
                .iter()
                .find(|f| f.is_srgb())
                .copied()
                .unwrap_or(surface_caps.formats[0]);

            tracing::info!("Surface format: {:?}", surface_format);

            // Configure surface
            let config = wgpu::SurfaceConfiguration {
                usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
                format: surface_format,
                width,
                height,
                present_mode: surface_caps.present_modes[0],
                alpha_mode: surface_caps.alpha_modes[0],
                view_formats: vec![],
                desired_maximum_frame_latency: 2,
            };
            surface.configure(&device, &config);

            // Create the renderer with the initialized state
            noviforma_renderer::Renderer::from_parts(surface, device, queue, config, surface_format)
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

    /// Set view mode
    pub fn set_view_mode(&self, mode: ViewMode) -> Result<(), String> {
        let mut view_mode = self.view_mode.lock().map_err(|e| e.to_string())?;
        *view_mode = mode;

        // Reset viewer state when entering viewer mode
        if matches!(mode, ViewMode::Viewer { .. }) {
            *self.viewer_pan.lock().map_err(|e| e.to_string())? = (0.0, 0.0);
            *self.viewer_zoom.lock().map_err(|e| e.to_string())? = 1.0;
        }

        tracing::info!("View mode changed to: {:?}", mode);
        Ok(())
    }

    /// Get current view mode
    pub fn get_view_mode(&self) -> Result<ViewMode, String> {
        Ok(*self.view_mode.lock().map_err(|e| e.to_string())?)
    }

    /// Update viewer pan offset
    pub fn set_viewer_pan(&self, pan: (f32, f32)) -> Result<(), String> {
        *self.viewer_pan.lock().map_err(|e| e.to_string())? = pan;
        Ok(())
    }

    /// Update viewer zoom
    pub fn set_viewer_zoom(&self, zoom: f32) -> Result<(), String> {
        *self.viewer_zoom.lock().map_err(|e| e.to_string())? = zoom.clamp(0.25, 4.0);
        Ok(())
    }

    /// Get viewer pan offset
    pub fn get_viewer_pan(&self) -> Result<(f32, f32), String> {
        Ok(*self.viewer_pan.lock().map_err(|e| e.to_string())?)
    }

    /// Get viewer zoom
    pub fn get_viewer_zoom(&self) -> Result<f32, String> {
        Ok(*self.viewer_zoom.lock().map_err(|e| e.to_string())?)
    }

    /// Render in viewer mode with the given asset
    pub fn render_viewer(&self, asset_id: i64, aspect_ratio: f32) -> Result<(), String> {
        let texture_index = self.get_texture_index(asset_id)
            .ok_or_else(|| format!("No texture loaded for asset {}", asset_id))?;

        let pan = *self.viewer_pan.lock().map_err(|e| e.to_string())?;
        let zoom = *self.viewer_zoom.lock().map_err(|e| e.to_string())?;

        let instance = ViewerInstance::new(aspect_ratio, zoom, pan, texture_index);

        let mut renderer = self.renderer.lock().map_err(|e| e.to_string())?;
        if let Some(r) = renderer.as_mut() {
            r.render_viewer(instance)?;
            Ok(())
        } else {
            Err("Renderer not initialized".to_string())
        }
    }
}
