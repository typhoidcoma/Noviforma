use crate::instance::{QuadVertex, ViewerInstance};
use wgpu::{
    BindGroupLayout, Buffer, Device, RenderPipeline, SurfaceConfiguration,
};
use wgpu::util::DeviceExt;

/// Pipeline for fullscreen image viewer
pub struct ViewerPipeline {
    pub render_pipeline: RenderPipeline,
    pub instance_buffer: Buffer,
}

impl ViewerPipeline {
    /// Create a new viewer pipeline
    pub fn new(
        device: &Device,
        config: &SurfaceConfiguration,
        bind_group_layout: &BindGroupLayout,
        quad_vertex_buffer: &Buffer,
    ) -> Self {
        // Load viewer shader
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("Viewer Shader"),
            source: wgpu::ShaderSource::Wgsl(include_str!("shaders/viewer.wgsl").into()),
        });

        // Create pipeline layout
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("Viewer Pipeline Layout"),
            bind_group_layouts: &[bind_group_layout],
            push_constant_ranges: &[],
        });

        // Create render pipeline
        let render_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("Viewer Render Pipeline"),
            layout: Some(&pipeline_layout),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: "vs_main",
                buffers: &[QuadVertex::desc(), ViewerInstance::desc()],
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

        // Create instance buffer (only need 1 instance for fullscreen viewer)
        let instance_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Viewer Instance Buffer"),
            size: std::mem::size_of::<ViewerInstance>() as u64,
            usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        Self {
            render_pipeline,
            instance_buffer,
        }
    }

    /// Update the viewer instance data
    pub fn update_instance(&self, queue: &wgpu::Queue, instance: &ViewerInstance) {
        queue.write_buffer(&self.instance_buffer, 0, bytemuck::bytes_of(instance));
    }
}
