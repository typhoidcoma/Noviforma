use noviforma_renderer::instance::TileInstance;
use noviforma_renderer::state::State;
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
    // Grid configuration
    total_cols: u32,
    total_rows: u32,
    tile_size: f32,
    gutter: f32,
}

impl App {
    /// Calculate which tiles are visible in the current viewport
    fn calculate_visible_tiles(
        viewport_width: u32,
        viewport_height: u32,
        pan_offset: (f32, f32),
        total_cols: u32,
        total_rows: u32,
        tile_size: f32,
        gutter: f32,
    ) -> Vec<TileInstance> {
        let effective_tile_size = tile_size + gutter;

        // Calculate visible range with pan offset
        let start_x = (-pan_offset.0).max(0.0);
        let start_y = (-pan_offset.1).max(0.0);
        let end_x = start_x + viewport_width as f32;
        let end_y = start_y + viewport_height as f32;

        // Calculate tile range
        let start_col = (start_x / effective_tile_size).floor() as u32;
        let start_row = (start_y / effective_tile_size).floor() as u32;
        let end_col = ((end_x / effective_tile_size).ceil() as u32 + 1).min(total_cols);
        let end_row = ((end_y / effective_tile_size).ceil() as u32 + 1).min(total_rows);

        let mut instances = Vec::new();
        for row in start_row..end_row {
            for col in start_col..end_col {
                let x = col as f32 * effective_tile_size + gutter + pan_offset.0;
                let y = row as f32 * effective_tile_size + gutter + pan_offset.1;
                let id = row * total_cols + col;
                let color = TileInstance::color_from_id(id);
                instances.push(TileInstance::new(x, y, tile_size, tile_size, color));
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
                self.total_cols,
                self.total_rows,
                self.tile_size,
                self.gutter,
            );
            info!(
                "Updating tiles: {} visible (pan offset: {:.0}, {:.0})",
                instances.len(),
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
                .with_title("Noviforma - GPU Grid Viewport (M0 - Phase 3)")
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
                state.set_total_tiles((self.total_cols * self.total_rows) as usize);
            }

            // Calculate and update visible tiles
            self.update_visible_tiles();

            info!(
                "Virtual grid: {}x{} = {} total tiles",
                self.total_cols,
                self.total_rows,
                self.total_cols * self.total_rows
            );
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

    info!("Starting Noviforma (winit + wgpu)...");

    // Create event loop
    let event_loop = EventLoop::new().expect("Failed to create event loop");
    event_loop.set_control_flow(ControlFlow::Poll);

    let mut app = App {
        window: None,
        state: None,
        pan_offset: (0.0, 0.0),
        is_dragging: false,
        last_mouse_pos: (0.0, 0.0),
        total_cols: 500,  // 500 x 200 = 100,000 total tiles for stress testing
        total_rows: 200,
        tile_size: 128.0,
        gutter: 8.0,
    };

    event_loop
        .run_app(&mut app)
        .expect("Event loop error");
}
