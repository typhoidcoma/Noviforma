use noviforma_core::{Asset, Database, ThumbnailGenerator};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

/// Tauri-managed database state
#[derive(Clone)]
pub struct DatabaseState {
    db: Arc<Mutex<Option<Database>>>,
    thumb_gen: Arc<Mutex<Option<ThumbnailGenerator>>>,
    db_path: Arc<Mutex<Option<PathBuf>>>,
}

impl DatabaseState {
    pub fn new() -> Self {
        Self {
            db: Arc::new(Mutex::new(None)),
            thumb_gen: Arc::new(Mutex::new(None)),
            db_path: Arc::new(Mutex::new(None)),
        }
    }

    /// Initialize the database at the specified path
    pub fn init(&self, db_path: PathBuf) -> Result<(), String> {
        // Ensure parent directory exists
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create database directory: {}", e))?;
            tracing::info!("Ensured database directory exists: {}", parent.display());
        }

        // Create database
        let db = Database::new(&db_path)
            .map_err(|e| format!("Failed to create database: {}", e))?;

        // Create thumbnail generator (cache dir next to database)
        let cache_dir = db_path.parent()
            .ok_or("Invalid database path")?
            .join("thumbnails");

        let thumb_gen = ThumbnailGenerator::new(&cache_dir)
            .map_err(|e| format!("Failed to create thumbnail generator: {}", e))?;

        // Store state
        *self.db.lock().unwrap() = Some(db);
        *self.thumb_gen.lock().unwrap() = Some(thumb_gen);
        *self.db_path.lock().unwrap() = Some(db_path.clone());

        tracing::info!("Database initialized at: {}", db_path.display());
        Ok(())
    }

    /// Scan a directory and add assets to the database
    pub fn scan_directory(&self, path: PathBuf) -> Result<ScanResult, String> {
        let db = self.db.lock().unwrap();
        let db = db.as_ref().ok_or("Database not initialized")?;

        let assets = noviforma_core::scan_directory(&path);

        let mut result = ScanResult {
            indexed: 0,
            errors: 0,
        };

        for asset in assets {
            match db.insert_asset(&asset) {
                Ok(_) => result.indexed += 1,
                Err(e) => {
                    tracing::warn!("Failed to insert asset: {}", e);
                    result.errors += 1;
                }
            }
        }

        tracing::info!(
            "Scanned {}: {} indexed, {} errors",
            path.display(),
            result.indexed,
            result.errors
        );

        Ok(result)
    }

    /// Generate thumbnails for all assets that don't have one
    pub fn generate_thumbnails(&self) -> Result<ThumbnailResult, String> {
        self.generate_thumbnails_with_progress(|_, _, _| {})
    }

    /// Generate thumbnails with progress callback
    pub fn generate_thumbnails_with_progress<F>(&self, mut progress_callback: F) -> Result<ThumbnailResult, String>
    where
        F: FnMut(usize, usize, &str),
    {
        let db = self.db.lock().unwrap();
        let db = db.as_ref().ok_or("Database not initialized")?;

        let thumb_gen = self.thumb_gen.lock().unwrap();
        let thumb_gen = thumb_gen.as_ref().ok_or("Thumbnail generator not initialized")?;

        let assets = db.get_all_assets()
            .map_err(|e| format!("Failed to get assets: {}", e))?;

        let total = assets.len();
        let mut result = ThumbnailResult {
            generated: 0,
            skipped: 0,
            errors: 0,
        };

        for (idx, asset) in assets.iter().enumerate() {
            // Emit progress every 10 items or on first/last
            if idx % 10 == 0 || idx == total - 1 {
                progress_callback(
                    idx + 1,
                    total,
                    &format!("Processing {} of {}", idx + 1, total),
                );
            }

            // Skip if thumbnail already exists
            if thumb_gen.exists(asset.id) {
                result.skipped += 1;
                continue;
            }

            match thumb_gen.generate(&asset.path, asset.id) {
                Ok(thumb_path) => {
                    // Update database with thumbnail path
                    let thumb_path_str = thumb_path.to_string_lossy().to_string();
                    if let Err(e) = db.update_thumbnail(asset.id, &thumb_path_str) {
                        tracing::warn!("Failed to update thumbnail path: {}", e);
                    }
                    result.generated += 1;
                }
                Err(e) => {
                    tracing::warn!("Failed to generate thumbnail for {}: {}", asset.path, e);
                    result.errors += 1;
                }
            }
        }

        tracing::info!(
            "Thumbnail generation: {} generated, {} skipped, {} errors",
            result.generated,
            result.skipped,
            result.errors
        );

        Ok(result)
    }

    /// Get all assets from the database
    pub fn get_all_assets(&self) -> Result<Vec<Asset>, String> {
        let db = self.db.lock().unwrap();
        let db = db.as_ref().ok_or("Database not initialized")?;

        db.get_all_assets()
            .map_err(|e| format!("Failed to get assets: {}", e))
    }

    /// Get asset by ID
    pub fn get_asset(&self, id: i64) -> Result<Option<Asset>, String> {
        let db = self.db.lock().unwrap();
        let db = db.as_ref().ok_or("Database not initialized")?;

        db.get_asset(id)
            .map_err(|e| format!("Failed to get asset: {}", e))
    }

    /// Get total asset count
    pub fn count_assets(&self) -> Result<i64, String> {
        let db = self.db.lock().unwrap();
        let db = db.as_ref().ok_or("Database not initialized")?;

        db.count_assets()
            .map_err(|e| format!("Failed to count assets: {}", e))
    }

    /// Get thumbnail path for an asset
    pub fn get_thumbnail_path(&self, asset_id: i64) -> Result<Option<PathBuf>, String> {
        let thumb_gen = self.thumb_gen.lock().unwrap();
        let thumb_gen = thumb_gen.as_ref().ok_or("Thumbnail generator not initialized")?;

        let path = thumb_gen.get_path(asset_id);
        if path.exists() {
            Ok(Some(path))
        } else {
            Ok(None)
        }
    }

    /// Clear all assets from the database
    pub fn clear_all_assets(&self) -> Result<usize, String> {
        let db = self.db.lock().unwrap();
        let db = db.as_ref().ok_or("Database not initialized")?;

        let deleted = db.clear_all_assets()
            .map_err(|e| format!("Failed to clear assets: {}", e))?;

        tracing::info!("Cleared {} assets from database", deleted);
        Ok(deleted)
    }
}

#[derive(Debug, serde::Serialize)]
pub struct ScanResult {
    pub indexed: usize,
    pub errors: usize,
}

#[derive(Debug, serde::Serialize)]
pub struct ThumbnailResult {
    pub generated: usize,
    pub skipped: usize,
    pub errors: usize,
}
