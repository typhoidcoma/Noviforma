use fast_image_resize as fir;
use image::{DynamicImage, GenericImageView, ImageError, ImageFormat};
use std::path::{Path, PathBuf};

const THUMBNAIL_SIZE: u32 = 1024;

/// Thumbnail generator for media assets
#[derive(Clone)]
pub struct ThumbnailGenerator {
    base_cache_dir: PathBuf,
}

impl ThumbnailGenerator {
    /// Create a new thumbnail generator
    pub fn new<P: AsRef<Path>>(base_cache_dir: P) -> std::io::Result<Self> {
        let base_cache_dir = base_cache_dir.as_ref().to_path_buf();

        // Create base cache directory if it doesn't exist
        std::fs::create_dir_all(&base_cache_dir)?;

        tracing::info!("Thumbnail base cache directory: {}", base_cache_dir.display());

        Ok(Self { base_cache_dir })
    }

    /// Get cache directory for a specific folder hash
    fn get_folder_cache_dir(&self, folder_hash: &str) -> PathBuf {
        self.base_cache_dir.join(folder_hash)
    }

    /// Generate a thumbnail for an asset with folder context
    /// Returns the path to the generated thumbnail and the original image dimensions (width, height)
    pub fn generate<P: AsRef<Path>>(
        &self,
        asset_path: P,
        asset_id: i64,
        folder_hash: &str,
    ) -> Result<(PathBuf, u32, u32), ImageError> {
        let asset_path = asset_path.as_ref();

        // Get folder-specific cache directory
        let folder_cache = self.get_folder_cache_dir(folder_hash);

        // Create folder-specific cache directory if it doesn't exist
        std::fs::create_dir_all(&folder_cache)
            .map_err(|e| ImageError::IoError(e))?;

        // Load image
        let img = image::open(asset_path)?;
        let (w, h) = img.dimensions();

        // If image is already small enough, just save directly
        if w <= THUMBNAIL_SIZE && h <= THUMBNAIL_SIZE {
            let thumb_filename = format!("{}.jpg", asset_id);
            let thumb_path = folder_cache.join(thumb_filename);
            img.save_with_format(&thumb_path, ImageFormat::Jpeg)?;

            tracing::debug!(
                "Saved small image as thumbnail: {} -> {} (folder: {})",
                asset_path.display(),
                thumb_path.display(),
                folder_hash
            );
            return Ok((thumb_path, w, h));
        }

        // Calculate aspect-preserving target dimensions
        let scale = (THUMBNAIL_SIZE as f64 / w as f64)
            .min(THUMBNAIL_SIZE as f64 / h as f64);
        let tw = (w as f64 * scale).round().max(1.0) as u32;
        let th = (h as f64 * scale).round().max(1.0) as u32;

        // Convert to RGBA8 for fast_image_resize
        let rgba = img.into_rgba8();
        let src = fir::images::Image::from_vec_u8(
            w, h,
            rgba.into_raw(),
            fir::PixelType::U8x4,
        ).map_err(|e| ImageError::IoError(
            std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string())
        ))?;

        let mut dst = fir::images::Image::new(tw, th, fir::PixelType::U8x4);

        let mut resizer = fir::Resizer::new();
        resizer.resize(&src, &mut dst, &fir::ResizeOptions::new())
            .map_err(|e| ImageError::IoError(
                std::io::Error::new(std::io::ErrorKind::Other, e.to_string())
            ))?;

        // Convert back to image::RgbaImage and save as JPEG
        let result = image::RgbaImage::from_raw(tw, th, dst.into_vec())
            .ok_or_else(|| ImageError::IoError(
                std::io::Error::new(std::io::ErrorKind::InvalidData, "Failed to reconstruct image buffer")
            ))?;

        let thumb_filename = format!("{}.jpg", asset_id);
        let thumb_path = folder_cache.join(thumb_filename);

        DynamicImage::ImageRgba8(result)
            .save_with_format(&thumb_path, ImageFormat::Jpeg)?;

        tracing::debug!(
            "Generated thumbnail: {} -> {} ({}x{} -> {}x{}, folder: {})",
            asset_path.display(),
            thumb_path.display(),
            w, h, tw, th,
            folder_hash
        );

        Ok((thumb_path, w, h))
    }

    /// Check if thumbnail exists for an asset in a specific folder
    pub fn exists(&self, asset_id: i64, folder_hash: &str) -> bool {
        let thumb_path = self.get_path(asset_id, folder_hash);
        thumb_path.exists()
    }

    /// Get thumbnail path for an asset in a specific folder (doesn't check if it exists)
    pub fn get_path(&self, asset_id: i64, folder_hash: &str) -> PathBuf {
        let thumb_filename = format!("{}.jpg", asset_id);
        self.get_folder_cache_dir(folder_hash).join(thumb_filename)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_thumbnail_generator_creates_cache_dir() {
        let temp_dir = tempfile::tempdir().unwrap();
        let cache_dir = temp_dir.path().join("thumbs");

        let _gen = ThumbnailGenerator::new(&cache_dir).unwrap();

        assert!(cache_dir.exists());
    }
}
