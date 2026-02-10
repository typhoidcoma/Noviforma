use crate::state::State;
use crate::stats::PerfStats;

pub struct Renderer {
    // Will hold wgpu state
}

impl Renderer {
    pub fn new() -> Self {
        tracing::info!("Renderer::new() - stub");
        Self {}
    }

    pub fn resize(&mut self, width: u32, height: u32, dpr: f32) {
        tracing::info!("Renderer::resize({}, {}, {}) - stub", width, height, dpr);
    }

    pub fn update_tiles(&mut self, tiles: Vec<crate::TileInstance>) {
        tracing::info!("Renderer::update_tiles({} tiles) - stub", tiles.len());
    }

    pub fn render_frame(&mut self) -> Result<(), String> {
        // Stub - will implement actual rendering later
        Ok(())
    }

    pub fn get_stats(&self) -> PerfStats {
        PerfStats::default()
    }
}
