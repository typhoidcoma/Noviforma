use image::{DynamicImage, ImageError, ImageFormat};
use std::path::{Path, PathBuf};

const THUMBNAIL_SIZE: u32 = 512;

/// Thumbnail generator for media assets
pub struct ThumbnailGenerator {
    cache_dir: PathBuf,
}

impl ThumbnailGenerator {
    /// Create a new thumbnail generator
    pub fn new<P: AsRef<Path>>(cache_dir: P) -> std::io::Result<Self> {
        let cache_dir = cache_dir.as_ref().to_path_buf();

        // Create cache directory if it doesn't exist
        std::fs::create_dir_all(&cache_dir)?;

        tracing::info!("Thumbnail cache directory: {}", cache_dir.display());

        Ok(Self { cache_dir })
    }

    /// Generate a thumbnail for an asset
    /// Returns the path to the generated thumbnail
    pub fn generate<P: AsRef<Path>>(&self, asset_path: P, asset_id: i64) -> Result<PathBuf, ImageError> {
        let asset_path = asset_path.as_ref();

        // Load image
        let img = image::open(asset_path)?;

        // Resize to thumbnail size (maintain aspect ratio, fit within square)
        let thumbnail = img.thumbnail(THUMBNAIL_SIZE, THUMBNAIL_SIZE);

        // Generate thumbnail filename from asset ID
        let thumb_filename = format!("{}.jpg", asset_id);
        let thumb_path = self.cache_dir.join(thumb_filename);

        // Save as JPEG with quality 85
        thumbnail.save_with_format(&thumb_path, ImageFormat::Jpeg)?;

        tracing::debug!(
            "Generated thumbnail: {} -> {}",
            asset_path.display(),
            thumb_path.display()
        );

        Ok(thumb_path)
    }

    /// Check if thumbnail exists for an asset
    pub fn exists(&self, asset_id: i64) -> bool {
        let thumb_filename = format!("{}.jpg", asset_id);
        let thumb_path = self.cache_dir.join(thumb_filename);
        thumb_path.exists()
    }

    /// Get thumbnail path for an asset (doesn't check if it exists)
    pub fn get_path(&self, asset_id: i64) -> PathBuf {
        let thumb_filename = format!("{}.jpg", asset_id);
        self.cache_dir.join(thumb_filename)
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
