use image::ImageError;
use std::path::Path;
use wgpu::{Device, Queue, Texture, TextureView};

/// Standard thumbnail size for all textures
pub const THUMBNAIL_SIZE: u32 = 512;
/// Maximum number of textures we can load (GPU limit for texture array layers)
pub const MAX_TEXTURES: u32 = 256;

/// Manages GPU textures for thumbnails using a texture array
pub struct TextureManager {
    pub texture: Texture,
    pub view: TextureView,
    pub sampler: wgpu::Sampler,
    pub loaded_count: u32,
}

impl TextureManager {
    /// Create a new texture manager with an empty texture array
    pub fn new(device: &Device, queue: &Queue) -> Self {
        // Create texture array (all layers initialized to white)
        let size = wgpu::Extent3d {
            width: THUMBNAIL_SIZE,
            height: THUMBNAIL_SIZE,
            depth_or_array_layers: MAX_TEXTURES,
        };

        let texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("Thumbnail Texture Array"),
            size,
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8UnormSrgb,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });

        // Initialize first layer with white placeholder
        let white_data: Vec<u8> = vec![255u8; (THUMBNAIL_SIZE * THUMBNAIL_SIZE * 4) as usize];
        queue.write_texture(
            wgpu::ImageCopyTexture {
                texture: &texture,
                mip_level: 0,
                origin: wgpu::Origin3d { x: 0, y: 0, z: 0 },
                aspect: wgpu::TextureAspect::All,
            },
            &white_data,
            wgpu::ImageDataLayout {
                offset: 0,
                bytes_per_row: Some(4 * THUMBNAIL_SIZE),
                rows_per_image: Some(THUMBNAIL_SIZE),
            },
            wgpu::Extent3d {
                width: THUMBNAIL_SIZE,
                height: THUMBNAIL_SIZE,
                depth_or_array_layers: 1,
            },
        );

        let view = texture.create_view(&wgpu::TextureViewDescriptor {
            label: Some("Thumbnail Texture Array View"),
            dimension: Some(wgpu::TextureViewDimension::D2Array),
            array_layer_count: Some(MAX_TEXTURES),
            ..Default::default()
        });

        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("Texture Sampler"),
            address_mode_u: wgpu::AddressMode::ClampToEdge,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            address_mode_w: wgpu::AddressMode::ClampToEdge,
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            mipmap_filter: wgpu::FilterMode::Nearest,
            ..Default::default()
        });

        Self {
            texture,
            view,
            sampler,
            loaded_count: 0,
        }
    }

    /// Load a texture from an image file into the next available array layer
    /// Returns the texture index (array layer)
    pub fn load_texture<P: AsRef<Path>>(
        &mut self,
        queue: &Queue,
        path: P,
    ) -> Result<u32, ImageError> {
        if self.loaded_count >= MAX_TEXTURES {
            tracing::warn!("Texture array full, cannot load more textures");
            return Ok(0); // Return placeholder index
        }

        let path = path.as_ref();
        tracing::debug!("Loading texture {} from: {}", self.loaded_count, path.display());

        // Load and resize image to standard thumbnail size
        let img = image::open(path)?;
        let resized = img.resize_exact(
            THUMBNAIL_SIZE,
            THUMBNAIL_SIZE,
            image::imageops::FilterType::Lanczos3,
        );
        let rgba = resized.to_rgba8();

        // Upload to specific array layer
        queue.write_texture(
            wgpu::ImageCopyTexture {
                texture: &self.texture,
                mip_level: 0,
                origin: wgpu::Origin3d {
                    x: 0,
                    y: 0,
                    z: self.loaded_count,
                },
                aspect: wgpu::TextureAspect::All,
            },
            &rgba,
            wgpu::ImageDataLayout {
                offset: 0,
                bytes_per_row: Some(4 * THUMBNAIL_SIZE),
                rows_per_image: Some(THUMBNAIL_SIZE),
            },
            wgpu::Extent3d {
                width: THUMBNAIL_SIZE,
                height: THUMBNAIL_SIZE,
                depth_or_array_layers: 1,
            },
        );

        let texture_index = self.loaded_count;
        self.loaded_count += 1;

        tracing::debug!("Loaded texture at index {}", texture_index);
        Ok(texture_index)
    }
}
