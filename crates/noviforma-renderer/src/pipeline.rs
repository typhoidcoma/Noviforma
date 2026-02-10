use crate::instance::{QuadVertex, TileInstance};
use wgpu::{
    BindGroup, BindGroupLayout, Buffer, Device, RenderPipeline, SurfaceConfiguration,
};
use wgpu::util::DeviceExt;

/// Viewport uniform data (width, height in pixels)
#[repr(C)]
#[derive(Copy, Clone, Debug)]
pub struct ViewportUniform {
    pub width: f32,
    pub height: f32,
}

unsafe impl bytemuck::Pod for ViewportUniform {}
unsafe impl bytemuck::Zeroable for ViewportUniform {}

/// Manages the render pipeline and GPU resources
pub struct Pipeline {
    pub render_pipeline: RenderPipeline,
    pub quad_vertex_buffer: Buffer,
    pub instance_buffer: Buffer,
    pub viewport_buffer: Buffer,
    pub bind_group: BindGroup,
    pub bind_group_layout: BindGroupLayout,
    pub instance_capacity: usize,
}

impl Pipeline {
    /// Create a new render pipeline
    pub fn new(device: &Device, config: &SurfaceConfiguration) -> Self {
        // Load shader
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("Grid Shader"),
            source: wgpu::ShaderSource::Wgsl(include_str!("shaders/grid.wgsl").into()),
        });

        // Create viewport uniform buffer
        let viewport_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Viewport Uniform Buffer"),
            size: std::mem::size_of::<ViewportUniform>() as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        // Create bind group layout for viewport uniform
        let bind_group_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("Viewport Bind Group Layout"),
            entries: &[wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgpu::ShaderStages::VERTEX,
                ty: wgpu::BindingType::Buffer {
                    ty: wgpu::BufferBindingType::Uniform,
                    has_dynamic_offset: false,
                    min_binding_size: None,
                },
                count: None,
            }],
        });

        // Create bind group
        let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("Viewport Bind Group"),
            layout: &bind_group_layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: viewport_buffer.as_entire_binding(),
            }],
        });

        // Create pipeline layout
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("Grid Pipeline Layout"),
            bind_group_layouts: &[&bind_group_layout],
            push_constant_ranges: &[],
        });

        // Create render pipeline
        let render_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("Grid Render Pipeline"),
            layout: Some(&pipeline_layout),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: "vs_main",
                buffers: &[QuadVertex::desc(), TileInstance::desc()],
                compilation_options: Default::default(),
            },
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: "fs_main",
                targets: &[Some(wgpu::ColorTargetState {
                    format: config.format,
                    blend: Some(wgpu::BlendState::ALPHA_BLENDING),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
                compilation_options: Default::default(),
            }),
            primitive: wgpu::PrimitiveState {
                topology: wgpu::PrimitiveTopology::TriangleList,
                strip_index_format: None,
                front_face: wgpu::FrontFace::Ccw,
                cull_mode: None,
                unclipped_depth: false,
                polygon_mode: wgpu::PolygonMode::Fill,
                conservative: false,
            },
            depth_stencil: None,
            multisample: wgpu::MultisampleState {
                count: 1,
                mask: !0,
                alpha_to_coverage_enabled: false,
            },
            multiview: None,
        });

        // Create quad vertex buffer
        let quad_vertex_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("Quad Vertex Buffer"),
            contents: bytemuck::cast_slice(crate::instance::QUAD_VERTICES),
            usage: wgpu::BufferUsages::VERTEX,
        });

        // Create instance buffer (start with capacity for 10,000 instances)
        let instance_capacity = 10_000;
        let instance_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Instance Buffer"),
            size: (instance_capacity * std::mem::size_of::<TileInstance>()) as u64,
            usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        Self {
            render_pipeline,
            quad_vertex_buffer,
            instance_buffer,
            viewport_buffer,
            bind_group,
            bind_group_layout,
            instance_capacity,
        }
    }

    /// Update viewport dimensions
    pub fn update_viewport(&self, queue: &wgpu::Queue, width: u32, height: u32) {
        let uniform = ViewportUniform {
            width: width as f32,
            height: height as f32,
        };
        queue.write_buffer(&self.viewport_buffer, 0, bytemuck::bytes_of(&uniform));
    }

    /// Update instance data
    pub fn update_instances(&mut self, device: &Device, queue: &wgpu::Queue, instances: &[TileInstance]) {
        // Resize buffer if needed
        if instances.len() > self.instance_capacity {
            let new_capacity = (instances.len() * 2).max(1000);
            tracing::info!(
                "Resizing instance buffer: {} -> {} instances",
                self.instance_capacity,
                new_capacity
            );

            self.instance_buffer = device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("Instance Buffer"),
                size: (new_capacity * std::mem::size_of::<TileInstance>()) as u64,
                usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
                mapped_at_creation: false,
            });
            self.instance_capacity = new_capacity;
        }

        // Write instance data
        queue.write_buffer(&self.instance_buffer, 0, bytemuck::cast_slice(instances));
    }
}
