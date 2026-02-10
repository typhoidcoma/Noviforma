#[derive(Debug, Clone, Default)]
pub struct PerfStats {
    pub fps: f32,
    pub frame_ms: f32,
    pub p95_ms: f32,
    pub visible_tiles: usize,
    pub upload_us: u64,
}

impl PerfStats {
    pub fn new() -> Self {
        Self::default()
    }
}
