#[repr(C)]
#[derive(Copy, Clone, Debug)]
pub struct TileInstance {
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
    pub r: f32,
    pub g: f32,
    pub b: f32,
    pub a: f32,
}

impl TileInstance {
    pub fn new(x: f32, y: f32, w: f32, h: f32, r: f32, g: f32, b: f32, a: f32) -> Self {
        Self { x, y, w, h, r, g, b, a }
    }
}

/// Hash function to generate deterministic colors from tile IDs
pub fn tile_color(id: u32) -> [f32; 4] {
    let h = ((id.wrapping_mul(2654435761)) ^ (id >> 16)) as f32 / u32::MAX as f32;
    let r = (h * 360.0).sin() * 0.5 + 0.5;
    let g = ((h * 360.0 + 120.0).sin()) * 0.5 + 0.5;
    let b = ((h * 360.0 + 240.0).sin()) * 0.5 + 0.5;
    [r, g, b, 1.0]
}
