use noviforma_renderer::state::State;
use tracing::info;
use winit::{
    application::ApplicationHandler,
    event::WindowEvent,
    event_loop::{ActiveEventLoop, ControlFlow, EventLoop},
    window::{Window, WindowId},
};

struct App {
    window: Option<Window>,
    state: Option<State>,
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
                }
            }
            WindowEvent::RedrawRequested => {
                if let Some(state) = &self.state {
                    match state.render() {
                        Ok(_) => {}
                        Err(wgpu::SurfaceError::Lost) => {
                            info!("Surface lost, reconfiguring...");
                            if let Some(state) = &mut self.state {
                                let size = state.size;
                                state.resize(size.0, size.1);
                            }
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
    };

    event_loop
        .run_app(&mut app)
        .expect("Event loop error");
}
