/// Represents a single tile instance for GPU rendering
/// Layout: [x, y, w, h, texture_index, r, g, b, a]
#[repr(C)]
#[derive(Copy, Clone, Debug)]
pub struct TileInstance {
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
    pub texture_index: f32, // -1.0 = no texture (use color), >= 0 = texture array index
    pub r: f32,
    pub g: f32,
    pub b: f32,
    pub a: f32,
}

// SAFETY: TileInstance is a POD type with no padding
unsafe impl bytemuck::Pod for TileInstance {}
unsafe impl bytemuck::Zeroable for TileInstance {}

impl TileInstance {
    /// Create a new tile instance with color (no texture)
    pub fn new(x: f32, y: f32, w: f32, h: f32, color: [f32; 4]) -> Self {
        Self {
            x,
            y,
            w,
            h,
            texture_index: -1.0, // No texture
            r: color[0],
            g: color[1],
            b: color[2],
            a: color[3],
        }
    }

    /// Create a new tile instance with texture
    pub fn new_textured(x: f32, y: f32, w: f32, h: f32, texture_index: u32) -> Self {
        Self {
            x,
            y,
            w,
            h,
            texture_index: texture_index as f32,
            r: 1.0,
            g: 1.0,
            b: 1.0,
            a: 1.0,
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
                // Position X
                wgpu::VertexAttribute {
                    offset: 0,
                    shader_location: 1,
                    format: wgpu::VertexFormat::Float32,
                },
                // Position Y
                wgpu::VertexAttribute {
                    offset: 4,
                    shader_location: 2,
                    format: wgpu::VertexFormat::Float32,
                },
                // Size W
                wgpu::VertexAttribute {
                    offset: 8,
                    shader_location: 3,
                    format: wgpu::VertexFormat::Float32,
                },
                // Size H
                wgpu::VertexAttribute {
                    offset: 12,
                    shader_location: 4,
                    format: wgpu::VertexFormat::Float32,
                },
                // Texture Index
                wgpu::VertexAttribute {
                    offset: 16,
                    shader_location: 5,
                    format: wgpu::VertexFormat::Float32,
                },
                // Color R
                wgpu::VertexAttribute {
                    offset: 20,
                    shader_location: 6,
                    format: wgpu::VertexFormat::Float32,
                },
                // Color G
                wgpu::VertexAttribute {
                    offset: 24,
                    shader_location: 7,
                    format: wgpu::VertexFormat::Float32,
                },
                // Color B
                wgpu::VertexAttribute {
                    offset: 28,
                    shader_location: 8,
                    format: wgpu::VertexFormat::Float32,
                },
                // Color A
                wgpu::VertexAttribute {
                    offset: 32,
                    shader_location: 9,
                    format: wgpu::VertexFormat::Float32,
                },
            ],
        }
    }
}

/// Represents a fullscreen image viewer instance
/// Layout: [aspect_ratio, scale, offset_x, offset_y, texture_index, _padding...]
#[repr(C)]
#[derive(Copy, Clone, Debug)]
pub struct ViewerInstance {
    pub aspect_ratio: f32,
    pub scale: f32,
    pub offset_x: f32,
    pub offset_y: f32,
    pub texture_index: f32,
    pub _padding: [f32; 3], // Align to 16 bytes
}

// SAFETY: ViewerInstance is a POD type with explicit padding
unsafe impl bytemuck::Pod for ViewerInstance {}
unsafe impl bytemuck::Zeroable for ViewerInstance {}

impl ViewerInstance {
    /// Create a new viewer instance
    pub fn new(aspect_ratio: f32, scale: f32, offset: (f32, f32), texture_index: u32) -> Self {
        Self {
            aspect_ratio,
            scale,
            offset_x: offset.0,
            offset_y: offset.1,
            texture_index: texture_index as f32,
            _padding: [0.0; 3],
        }
    }

    /// Instance buffer layout descriptor for wgpu
    pub fn desc() -> wgpu::VertexBufferLayout<'static> {
        wgpu::VertexBufferLayout {
            array_stride: std::mem::size_of::<ViewerInstance>() as wgpu::BufferAddress,
            step_mode: wgpu::VertexStepMode::Instance,
            attributes: &[
                // Aspect ratio
                wgpu::VertexAttribute {
                    offset: 0,
                    shader_location: 1,
                    format: wgpu::VertexFormat::Float32,
                },
                // Scale
                wgpu::VertexAttribute {
                    offset: 4,
                    shader_location: 2,
                    format: wgpu::VertexFormat::Float32,
                },
                // Offset X
                wgpu::VertexAttribute {
                    offset: 8,
                    shader_location: 3,
                    format: wgpu::VertexFormat::Float32,
                },
                // Offset Y
                wgpu::VertexAttribute {
                    offset: 12,
                    shader_location: 4,
                    format: wgpu::VertexFormat::Float32,
                },
                // Texture Index
                wgpu::VertexAttribute {
                    offset: 16,
                    shader_location: 5,
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
