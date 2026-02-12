use crate::database::Database;
use crate::models::Asset;
use std::fs;
use std::path::Path;
use walkdir::WalkDir;

/// Supported image extensions
const IMAGE_EXTENSIONS: &[&str] = &["jpg", "jpeg", "png", "webp", "tiff", "tif", "bmp"];

/// Indexer for scanning directories and adding assets to the database
pub struct Indexer {
    db: Database,
}

impl Indexer {
    pub fn new(db: Database) -> Self {
        Self { db }
    }

    /// Scan a directory recursively and index all image files
    pub fn scan_directory<P: AsRef<Path>>(&self, root_path: P) -> Result<ScanResult, String> {
        let root = root_path.as_ref();
        if !root.exists() {
            return Err(format!("Path does not exist: {}", root.display()));
        }

        if !root.is_dir() {
            return Err(format!("Path is not a directory: {}", root.display()));
        }

        tracing::info!("Scanning directory: {}", root.display());

        let mut result = ScanResult::default();

        for entry in WalkDir::new(root).follow_links(false) {
            match entry {
                Ok(entry) => {
                    if entry.file_type().is_file() {
                        if let Some(ext) = entry.path().extension() {
                            if IMAGE_EXTENSIONS.contains(&ext.to_string_lossy().to_lowercase().as_ref()) {
                                match self.index_file(entry.path()) {
                                    Ok(was_new) => {
                                        if was_new {
                                            result.indexed += 1;
                                            tracing::debug!("Indexed: {}", entry.path().display());
                                        }
                                    }
                                    Err(e) => {
                                        result.errors += 1;
                                        tracing::warn!("Failed to index {}: {}", entry.path().display(), e);
                                    }
                                }
                            }
                        }
                    }
                }
                Err(e) => {
                    result.errors += 1;
                    tracing::warn!("Error walking directory: {}", e);
                }
            }
        }

        tracing::info!(
            "Scan complete: {} indexed, {} errors",
            result.indexed,
            result.errors
        );

        Ok(result)
    }

    /// Index a single file. Returns true if newly inserted, false if already existed.
    fn index_file<P: AsRef<Path>>(&self, path: P) -> Result<bool, String> {
        let path = path.as_ref();

        // Get file metadata
        let metadata = fs::metadata(path)
            .map_err(|e| format!("Failed to read metadata: {}", e))?;

        let file_size = metadata.len() as i64;
        let path_str = path.to_string_lossy().to_string();

        // Try to get image dimensions
        let (width, height) = match image::image_dimensions(path) {
            Ok((w, h)) => (Some(w), Some(h)),
            Err(e) => {
                tracing::debug!("Could not read image dimensions for {}: {}", path.display(), e);
                (None, None)
            }
        };

        // Create asset
        let mut asset = Asset::new(path_str, file_size);
        asset.width = width;
        asset.height = height;

        // Insert into database (returns true if new, false if already existed)
        self.db.insert_asset(&asset)
            .map_err(|e| format!("Database error: {}", e))
    }

    /// Get total number of indexed assets
    pub fn count_assets(&self) -> Result<i64, String> {
        self.db.count_assets()
            .map_err(|e| format!("Database error: {}", e))
    }
}

/// Result of a directory scan operation
#[derive(Debug, Default)]
pub struct ScanResult {
    pub indexed: usize,
    pub errors: usize,
}
