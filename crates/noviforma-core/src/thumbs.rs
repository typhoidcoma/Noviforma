use image::{ImageError, ImageFormat};
use std::path::{Path, PathBuf};

const THUMBNAIL_SIZE: u32 = 512;

/// Thumbnail generator for media assets
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
    /// Returns the path to the generated thumbnail
    pub fn generate<P: AsRef<Path>>(
        &self,
        asset_path: P,
        asset_id: i64,
        folder_hash: &str,
    ) -> Result<PathBuf, ImageError> {
        let asset_path = asset_path.as_ref();

        // Get folder-specific cache directory
        let folder_cache = self.get_folder_cache_dir(folder_hash);

        // Create folder-specific cache directory if it doesn't exist
        std::fs::create_dir_all(&folder_cache)
            .map_err(|e| ImageError::IoError(e))?;

        // Load image
        let img = image::open(asset_path)?;

        // Resize to thumbnail size (maintain aspect ratio, fit within square)
        let thumbnail = img.thumbnail(THUMBNAIL_SIZE, THUMBNAIL_SIZE);

        // Generate thumbnail filename from asset ID
        let thumb_filename = format!("{}.jpg", asset_id);
        let thumb_path = folder_cache.join(thumb_filename);

        // Save as JPEG with quality 85
        thumbnail.save_with_format(&thumb_path, ImageFormat::Jpeg)?;

        tracing::debug!(
            "Generated thumbnail: {} -> {} (folder: {})",
            asset_path.display(),
            thumb_path.display(),
            folder_hash
        );

        Ok(thumb_path)
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
