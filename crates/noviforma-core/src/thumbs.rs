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

        // Detect original format from file extension
        let format = ImageFormat::from_path(asset_path)
            .unwrap_or(ImageFormat::Jpeg); // Default to JPEG if unknown

        // Get file extension for thumbnail
        let ext = match format {
            ImageFormat::Png => "png",
            ImageFormat::Jpeg => "jpg",
            ImageFormat::WebP => "webp",
            ImageFormat::Gif => "gif",
            ImageFormat::Bmp => "bmp",
            ImageFormat::Tiff => "tiff",
            _ => "jpg", // Fallback for exotic formats
        };

        // Load image
        let img = image::open(asset_path)?;
        let (w, h) = img.dimensions();

        // If image is already small enough, just save directly in original format
        if w <= THUMBNAIL_SIZE && h <= THUMBNAIL_SIZE {
            let thumb_filename = format!("{}.{}", asset_id, ext);
            let thumb_path = folder_cache.join(thumb_filename);
            img.save_with_format(&thumb_path, format)?;

            tracing::debug!(
                "Saved small image as thumbnail: {} -> {} (folder: {}, format: {:?})",
                asset_path.display(),
                thumb_path.display(),
                folder_hash,
                format
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

        // Convert back to image::RgbaImage and save in original format
        let result = image::RgbaImage::from_raw(tw, th, dst.into_vec())
            .ok_or_else(|| ImageError::IoError(
                std::io::Error::new(std::io::ErrorKind::InvalidData, "Failed to reconstruct image buffer")
            ))?;

        let thumb_filename = format!("{}.{}", asset_id, ext);
        let thumb_path = folder_cache.join(thumb_filename);

        DynamicImage::ImageRgba8(result)
            .save_with_format(&thumb_path, format)?;

        tracing::debug!(
            "Generated thumbnail: {} -> {} ({}x{} -> {}x{}, folder: {}, format: {:?})",
            asset_path.display(),
            thumb_path.display(),
            w, h, tw, th,
            folder_hash,
            format
        );

        Ok((thumb_path, w, h))
    }

    /// Check if thumbnail exists for an asset in a specific folder
    /// Checks for any supported image format extension
    pub fn exists(&self, asset_id: i64, folder_hash: &str) -> bool {
        let folder_cache = self.get_folder_cache_dir(folder_hash);
        // Check for common extensions since we preserve original format
        for ext in &["jpg", "jpeg", "png", "webp", "gif", "bmp", "tiff"] {
            let thumb_path = folder_cache.join(format!("{}.{}", asset_id, ext));
            if thumb_path.exists() {
                return true;
            }
        }
        false
    }

    /// Get thumbnail path for an asset in a specific folder
    /// Searches for existing thumbnail with any supported format
    pub fn get_path(&self, asset_id: i64, folder_hash: &str) -> PathBuf {
        let folder_cache = self.get_folder_cache_dir(folder_hash);
        // Check for existing thumbnail with any extension
        for ext in &["jpg", "jpeg", "png", "webp", "gif", "bmp", "tiff"] {
            let thumb_path = folder_cache.join(format!("{}.{}", asset_id, ext));
            if thumb_path.exists() {
                return thumb_path;
            }
        }
        // Default to .jpg if not found (for compatibility)
        folder_cache.join(format!("{}.jpg", asset_id))
    }

    /// Check if thumbnail is fresh (source file hasn't been modified since thumbnail generation)
    /// Returns true if thumbnail exists AND is up-to-date
    /// Returns false if thumbnail doesn't exist OR source is newer
    pub fn is_fresh<P: AsRef<Path>>(&self, asset_path: P, asset_id: i64, folder_hash: &str) -> bool {
        let asset_path = asset_path.as_ref();
        let folder_cache = self.get_folder_cache_dir(folder_hash);

        // Find existing thumbnail with any extension
        let thumb_path = {
            let mut found_path = None;
            for ext in &["jpg", "jpeg", "png", "webp", "gif", "bmp", "tiff"] {
                let path = folder_cache.join(format!("{}.{}", asset_id, ext));
                if path.exists() {
                    found_path = Some(path);
                    break;
                }
            }
            found_path
        };

        // If thumbnail doesn't exist, it's not fresh
        let thumb_path = match thumb_path {
            Some(p) => p,
            None => return false,
        };

        // Get source file metadata (mtime)
        let source_mtime = match std::fs::metadata(asset_path) {
            Ok(meta) => match meta.modified() {
                Ok(time) => time,
                Err(e) => {
                    tracing::warn!("Failed to get mtime for source {}: {}", asset_path.display(), e);
                    return false; // Can't verify, assume stale
                }
            },
            Err(e) => {
                tracing::warn!("Source file inaccessible {}: {}", asset_path.display(), e);
                return true; // Don't regenerate if source is gone (preserve thumbnail)
            }
        };

        // Get thumbnail file metadata (mtime)
        let thumb_mtime = match std::fs::metadata(&thumb_path) {
            Ok(meta) => match meta.modified() {
                Ok(time) => time,
                Err(e) => {
                    tracing::warn!("Failed to get mtime for thumbnail {}: {}", thumb_path.display(), e);
                    return false; // Can't verify, regenerate to be safe
                }
            },
            Err(_) => {
                return false; // Thumbnail disappeared (race condition)
            }
        };

        // Compare: thumbnail is fresh if it was created/modified AFTER or AT SAME TIME as source
        let is_fresh = thumb_mtime >= source_mtime;

        if !is_fresh {
            tracing::debug!(
                "Thumbnail stale for asset {}: source={:?}, thumb={:?}",
                asset_id,
                source_mtime,
                thumb_mtime
            );
        }

        is_fresh
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
