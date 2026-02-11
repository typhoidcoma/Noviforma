use crate::state::State;
use wgpu::Surface;

pub struct Renderer {
    state: State,
}

impl Renderer {
    /// Create a new renderer with an existing wgpu surface
    pub async fn new(surface: Surface<'static>, width: u32, height: u32) -> Result<Self, String> {
        let state = State::new_with_surface(surface, width, height).await?;
        Ok(Self { state })
    }

    pub fn resize(&mut self, width: u32, height: u32) {
        self.state.resize(width, height);
    }

    pub fn update_tiles(&mut self, tiles: Vec<crate::TileInstance>) {
        self.state.update_tiles(tiles);
    }

    pub fn set_total_tiles(&mut self, total: usize) {
        self.state.set_total_tiles(total);
    }

    pub fn render_frame(&mut self) -> Result<(), String> {
        self.state.render().map_err(|e| format!("Render error: {:?}", e))
    }

    /// Load a texture and return its index
    pub fn load_texture<P: AsRef<std::path::Path>>(&mut self, path: P) -> Result<u32, image::ImageError> {
        self.state.load_texture(path)
    }
}
