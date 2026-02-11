use crate::instance::{TileInstance, ViewerInstance};
use crate::pipeline::Pipeline;
use crate::viewer_pipeline::ViewerPipeline;
use crate::stats::PerfStats;
use std::time::Instant;
use wgpu::{Device, DeviceDescriptor, Features, Instance, Limits, Queue, Surface, SurfaceConfiguration, TextureUsages};

pub struct State {
    pub surface: Surface<'static>,
    pub device: Device,
    pub queue: Queue,
    pub config: SurfaceConfiguration,
    pub size: (u32, u32),
    pub pipeline: Pipeline,
    pub viewer_pipeline: ViewerPipeline,
    pub instances: Vec<TileInstance>,
    pub stats: PerfStats,
    pub total_tiles: usize,
}

impl State {
    /// Create a new wgpu state with an existing surface (for Tauri)
    pub async fn new_with_surface(
        surface: Surface<'static>,
        width: u32,
        height: u32,
    ) -> Result<Self, String> {
        let instance = Instance::new(wgpu::InstanceDescriptor {
            backends: wgpu::Backends::PRIMARY,
            ..Default::default()
        });

        // Request adapter (prefer high-performance GPU)
        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::HighPerformance,
                compatible_surface: Some(&surface),
                force_fallback_adapter: false,
            })
            .await
            .ok_or_else(|| "Failed to find suitable GPU adapter".to_string())?;

        tracing::info!(
            "Selected GPU adapter: {} ({:?})",
            adapter.get_info().name,
            adapter.get_info().backend
        );

        // Request device and queue
        let (device, queue) = adapter
            .request_device(
                &DeviceDescriptor {
                    label: Some("Noviforma Render Device"),
                    required_features: Features::empty(),
                    required_limits: Limits::default(),
                },
                None,
            )
            .await
            .map_err(|e| format!("Failed to create device: {:?}", e))?;

        // Get surface capabilities
        let surface_caps = surface.get_capabilities(&adapter);
        let surface_format = surface_caps
            .formats
            .iter()
            .find(|f| f.is_srgb())
            .copied()
            .unwrap_or(surface_caps.formats[0]);

        tracing::info!("Surface format: {:?}", surface_format);

        // Configure surface
        let config = SurfaceConfiguration {
            usage: TextureUsages::RENDER_ATTACHMENT,
            format: surface_format,
            width,
            height,
            present_mode: wgpu::PresentMode::Fifo, // VSync
            alpha_mode: surface_caps.alpha_modes[0],
            view_formats: vec![],
            desired_maximum_frame_latency: 2,
        };

        surface.configure(&device, &config);

        // Create render pipeline
        let pipeline = Pipeline::new(&device, &queue, &config);

        // Create viewer pipeline (shares bind group layout with grid pipeline)
        let viewer_pipeline = ViewerPipeline::new(
            &device,
            &config,
            &pipeline.bind_group_layout,
            &pipeline.quad_vertex_buffer,
        );

        // Update viewport with initial dimensions
        pipeline.update_viewport(&queue, width, height);

        Ok(Self {
            surface,
            device,
            queue,
            config,
            size: (width, height),
            pipeline,
            viewer_pipeline,
            instances: Vec::new(),
            stats: PerfStats::new(),
            total_tiles: 0,
        })
    }

    /// Create a State from already-initialized wgpu components
    /// This avoids creating a second wgpu instance
    pub fn from_parts(
        surface: Surface<'static>,
        device: Device,
        queue: Queue,
        config: SurfaceConfiguration,
        _format: wgpu::TextureFormat,
    ) -> Result<Self, String> {
        // Extract dimensions before moving config
        let width = config.width;
        let height = config.height;

        // Create rendering pipelines
        let pipeline = Pipeline::new(&device, &queue, &config);

        // Create viewer pipeline (shares bind group layout with grid pipeline)
        let viewer_pipeline = ViewerPipeline::new(
            &device,
            &config,
            &pipeline.bind_group_layout,
            &pipeline.quad_vertex_buffer,
        );

        // Update viewport with initial dimensions
        pipeline.update_viewport(&queue, width, height);

        Ok(Self {
            surface,
            device,
            queue,
            config,
            size: (width, height),
            pipeline,
            viewer_pipeline,
            instances: Vec::new(),
            stats: PerfStats::new(),
            total_tiles: 0,
        })
    }

    /// Create a new wgpu state for rendering (for winit windows)
    pub async fn new(
        window: &winit::window::Window,
        width: u32,
        height: u32,
    ) -> Result<Self, String> {
        let instance = Instance::new(wgpu::InstanceDescriptor {
            backends: wgpu::Backends::PRIMARY,
            ..Default::default()
        });

        // Create surface
        // SAFETY: The surface doesn't actually hold a reference to the window,
        // it only extracts the window handle. The window is owned by the App
        // struct and will outlive the surface, so extending the lifetime is safe.
        let surface: Surface<'static> = unsafe {
            let surface_temp = instance
                .create_surface(window)
                .map_err(|e| format!("Failed to create surface: {:?}", e))?;
            std::mem::transmute(surface_temp)
        };

        // Request adapter (prefer high-performance GPU)
        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::HighPerformance,
                compatible_surface: Some(&surface),
                force_fallback_adapter: false,
            })
            .await
            .ok_or_else(|| "Failed to find suitable GPU adapter".to_string())?;

        tracing::info!(
            "Selected GPU adapter: {} ({:?})",
            adapter.get_info().name,
            adapter.get_info().backend
        );

        // Request device and queue
        let (device, queue) = adapter
            .request_device(
                &DeviceDescriptor {
                    label: Some("Noviforma Render Device"),
                    required_features: Features::empty(),
                    required_limits: Limits::default(),
                },
                None,
            )
            .await
            .map_err(|e| format!("Failed to create device: {:?}", e))?;

        // Get surface capabilities
        let surface_caps = surface.get_capabilities(&adapter);
        let surface_format = surface_caps
            .formats
            .iter()
            .find(|f| f.is_srgb())
            .copied()
            .unwrap_or(surface_caps.formats[0]);

        tracing::info!("Surface format: {:?}", surface_format);

        // Configure surface
        let config = SurfaceConfiguration {
            usage: TextureUsages::RENDER_ATTACHMENT,
            format: surface_format,
            width,
            height,
            present_mode: wgpu::PresentMode::Fifo, // VSync
            alpha_mode: surface_caps.alpha_modes[0],
            view_formats: vec![],
            desired_maximum_frame_latency: 2,
        };

        surface.configure(&device, &config);

        // Create render pipeline
        let pipeline = Pipeline::new(&device, &queue, &config);

        // Create viewer pipeline (shares bind group layout with grid pipeline)
        let viewer_pipeline = ViewerPipeline::new(
            &device,
            &config,
            &pipeline.bind_group_layout,
            &pipeline.quad_vertex_buffer,
        );

        // Update viewport with initial dimensions
        pipeline.update_viewport(&queue, width, height);

        Ok(Self {
            surface,
            device,
            queue,
            config,
            size: (width, height),
            pipeline,
            viewer_pipeline,
            instances: Vec::new(),
            stats: PerfStats::new(),
            total_tiles: 0,
        })
    }

    /// Resize the surface
    pub fn resize(&mut self, new_width: u32, new_height: u32) {
        if new_width > 0 && new_height > 0 {
            self.size = (new_width, new_height);
            self.config.width = new_width;
            self.config.height = new_height;
            self.surface.configure(&self.device, &self.config);
            self.pipeline.update_viewport(&self.queue, new_width, new_height);
            tracing::info!("Resized surface to {}x{}", new_width, new_height);
        }
    }

    /// Update tile instances for rendering
    pub fn update_tiles(&mut self, instances: Vec<TileInstance>) {
        self.instances = instances;
        if !self.instances.is_empty() {
            let upload_start = Instant::now();
            self.pipeline.update_instances(&self.device, &self.queue, &self.instances);
            let upload_time = upload_start.elapsed();
            self.stats.record_upload(upload_time);
        }
        self.stats.update_tiles(self.instances.len(), self.total_tiles);
    }

    /// Set total tile count for stats
    pub fn set_total_tiles(&mut self, total: usize) {
        self.total_tiles = total;
    }

    /// Load a texture into the GPU texture array
    /// Returns the texture index on success
    pub fn load_texture<P: AsRef<std::path::Path>>(&mut self, path: P) -> Result<u32, image::ImageError> {
        self.pipeline.texture_manager.load_texture(&self.queue, path)
    }

    /// Render a frame with instanced quads
    pub fn render(&mut self) -> Result<(), wgpu::SurfaceError> {
        let output = self.surface.get_current_texture()?;
        let view = output
            .texture
            .create_view(&wgpu::TextureViewDescriptor::default());

        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("Render Encoder"),
            });

        {
            let mut render_pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("Render Pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color {
                            r: 0.1,
                            g: 0.1,
                            b: 0.1,
                            a: 1.0,
                        }),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
            });

            // Draw instances if we have any
            if !self.instances.is_empty() {
                render_pass.set_pipeline(&self.pipeline.render_pipeline);
                render_pass.set_bind_group(0, &self.pipeline.bind_group, &[]);
                render_pass.set_vertex_buffer(0, self.pipeline.quad_vertex_buffer.slice(..));
                render_pass.set_vertex_buffer(1, self.pipeline.instance_buffer.slice(..));
                render_pass.draw(0..6, 0..self.instances.len() as u32);
            }
        }

        self.queue.submit(std::iter::once(encoder.finish()));
        output.present();

        // Record frame and maybe log stats
        self.stats.record_frame();
        self.stats.maybe_log_stats();

        Ok(())
    }

    /// Render the fullscreen viewer with a single image
    pub fn render_viewer(&mut self, instance: ViewerInstance) -> Result<(), wgpu::SurfaceError> {
        // Update viewer instance buffer
        self.viewer_pipeline.update_instance(&self.queue, &instance);

        let output = self.surface.get_current_texture()?;
        let view = output
            .texture
            .create_view(&wgpu::TextureViewDescriptor::default());

        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("Viewer Render Encoder"),
            });

        {
            let mut render_pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("Viewer Render Pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color {
                            r: 0.1,
                            g: 0.1,
                            b: 0.1,
                            a: 1.0,
                        }),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
            });

            render_pass.set_pipeline(&self.viewer_pipeline.render_pipeline);
            render_pass.set_bind_group(0, &self.pipeline.bind_group, &[]);
            render_pass.set_vertex_buffer(0, self.pipeline.quad_vertex_buffer.slice(..));
            render_pass.set_vertex_buffer(1, self.viewer_pipeline.instance_buffer.slice(..));
            render_pass.draw(0..6, 0..1); // Single instance
        }

        self.queue.submit(std::iter::once(encoder.finish()));
        output.present();

        // Record frame and maybe log stats
        self.stats.record_frame();
        self.stats.maybe_log_stats();

        Ok(())
    }
}
