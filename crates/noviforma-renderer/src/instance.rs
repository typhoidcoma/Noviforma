/// Represents a single tile instance for GPU rendering
/// Layout: [x, y, w, h, r, g, b, a]
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

// SAFETY: TileInstance is a POD type with no padding
unsafe impl bytemuck::Pod for TileInstance {}
unsafe impl bytemuck::Zeroable for TileInstance {}

impl TileInstance {
    /// Create a new tile instance
    pub fn new(x: f32, y: f32, w: f32, h: f32, color: [f32; 4]) -> Self {
        Self {
            x,
            y,
            w,
            h,
            r: color[0],
            g: color[1],
            b: color[2],
            a: color[3],
        }
    }

    /// Generate a deterministic color from a tile ID
    pub fn color_from_id(id: u32) -> [f32; 4] {
        let h = ((id.wrapping_mul(2654435761)) ^ (id >> 16)) as f32 / u32::MAX as f32;
        let r = ((h * 360.0).to_radians().sin() * 0.5 + 0.5).clamp(0.3, 0.9);
        let g = ((h * 360.0 + 120.0).to_radians().sin() * 0.5 + 0.5).clamp(0.3, 0.9);
        let b = ((h * 360.0 + 240.0).to_radians().sin() * 0.5 + 0.5).clamp(0.3, 0.9);
        [r, g, b, 1.0]
    }

    /// Instance buffer layout descriptor for wgpu
    pub fn desc() -> wgpu::VertexBufferLayout<'static> {
        wgpu::VertexBufferLayout {
            array_stride: std::mem::size_of::<TileInstance>() as wgpu::BufferAddress,
            step_mode: wgpu::VertexStepMode::Instance,
            attributes: &[
                wgpu::VertexAttribute {
                    offset: 0,
                    shader_location: 1,
                    format: wgpu::VertexFormat::Float32,
                },
                wgpu::VertexAttribute {
                    offset: 4,
                    shader_location: 2,
                    format: wgpu::VertexFormat::Float32,
                },
                wgpu::VertexAttribute {
                    offset: 8,
                    shader_location: 3,
                    format: wgpu::VertexFormat::Float32,
                },
                wgpu::VertexAttribute {
                    offset: 12,
                    shader_location: 4,
                    format: wgpu::VertexFormat::Float32,
                },
                wgpu::VertexAttribute {
                    offset: 16,
                    shader_location: 5,
                    format: wgpu::VertexFormat::Float32,
                },
                wgpu::VertexAttribute {
                    offset: 20,
                    shader_location: 6,
                    format: wgpu::VertexFormat::Float32,
                },
                wgpu::VertexAttribute {
                    offset: 24,
                    shader_location: 7,
                    format: wgpu::VertexFormat::Float32,
                },
                wgpu::VertexAttribute {
                    offset: 28,
                    shader_location: 8,
                    format: wgpu::VertexFormat::Float32,
                },
            ],
        }
    }
}

/// Vertex for the unit quad (will be instanced)
#[repr(C)]
#[derive(Copy, Clone, Debug)]
pub struct QuadVertex {
    pub position: [f32; 2],
}

unsafe impl bytemuck::Pod for QuadVertex {}
unsafe impl bytemuck::Zeroable for QuadVertex {}

impl QuadVertex {
    /// Vertex layout descriptor for wgpu
    pub fn desc() -> wgpu::VertexBufferLayout<'static> {
        wgpu::VertexBufferLayout {
            array_stride: std::mem::size_of::<QuadVertex>() as wgpu::BufferAddress,
            step_mode: wgpu::VertexStepMode::Vertex,
            attributes: &[wgpu::VertexAttribute {
                offset: 0,
                shader_location: 0,
                format: wgpu::VertexFormat::Float32x2,
            }],
        }
    }
}

/// Unit quad vertices (2 triangles forming a square from 0,0 to 1,1)
pub const QUAD_VERTICES: &[QuadVertex] = &[
    QuadVertex {
        position: [0.0, 0.0],
    }, // Top-left
    QuadVertex {
        position: [1.0, 0.0],
    }, // Top-right
    QuadVertex {
        position: [1.0, 1.0],
    }, // Bottom-right
    QuadVertex {
        position: [0.0, 0.0],
    }, // Top-left
    QuadVertex {
        position: [1.0, 1.0],
    }, // Bottom-right
    QuadVertex {
        position: [0.0, 1.0],
    }, // Bottom-left
];
