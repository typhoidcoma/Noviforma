use noviforma_core::{Asset, Database, ThumbnailGenerator, Tag, Note, Rating, Folder};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

/// Tauri-managed database state
#[derive(Clone)]
pub struct DatabaseState {
    db: Arc<Mutex<Option<Database>>>,
    thumb_gen: Arc<Mutex<Option<ThumbnailGenerator>>>,
    db_path: Arc<Mutex<Option<PathBuf>>>,
    current_folder_id: Arc<Mutex<Option<i64>>>,
}

impl DatabaseState {
    pub fn new() -> Self {
        Self {
            db: Arc::new(Mutex::new(None)),
            thumb_gen: Arc::new(Mutex::new(None)),
            db_path: Arc::new(Mutex::new(None)),
            current_folder_id: Arc::new(Mutex::new(None)),
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

        // Get or create folder entry
        let folder = db.get_or_create_folder(&path)
            .map_err(|e| format!("Failed to get/create folder: {}", e))?;

        // Set as current folder
        *self.current_folder_id.lock().unwrap() = Some(folder.id);

        // Scan directory with folder context
        let assets = noviforma_core::scan_directory(&path, folder.id);

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

        // Update folder asset count
        if let Err(e) = db.update_folder_asset_count(folder.id) {
            tracing::warn!("Failed to update folder asset count: {}", e);
        }

        tracing::info!(
            "Scanned {}: {} indexed, {} errors (folder_id: {})",
            path.display(),
            result.indexed,
            result.errors,
            folder.id
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

        // Get current folder
        let folder_id = self.current_folder_id.lock().unwrap()
            .ok_or("No folder selected")?;

        let folder = db.get_folder(folder_id)
            .map_err(|e| format!("Failed to get folder: {}", e))?
            .ok_or("Folder not found")?;

        // Only generate thumbnails for assets in current folder
        let assets = db.get_assets_by_folder(folder_id)
            .map_err(|e| format!("Failed to get assets: {}", e))?;

        let total = assets.len();
        let mut result = ThumbnailResult {
            generated: 0,
            skipped: 0,
            errors: 0,
        };

        for (idx, asset) in assets.iter().enumerate() {
            // Emit progress every 5 items or on first/last (more frequent for smoother updates)
            if idx % 5 == 0 || idx == total - 1 {
                progress_callback(
                    idx + 1,
                    total,
                    &format!("Processing {} of {}", idx + 1, total),
                );
            }

            // Skip if thumbnail already exists
            if thumb_gen.exists(asset.id, &folder.hash) {
                result.skipped += 1;
                continue;
            }

            match thumb_gen.generate(&asset.path, asset.id, &folder.hash) {
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
            "Thumbnail generation for folder {}: {} generated, {} skipped, {} errors",
            folder.name,
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
        let db = self.db.lock().unwrap();
        let db = db.as_ref().ok_or("Database not initialized")?;

        let thumb_gen = self.thumb_gen.lock().unwrap();
        let thumb_gen = thumb_gen.as_ref().ok_or("Thumbnail generator not initialized")?;

        // Get asset to find its folder
        let asset = db.get_asset(asset_id)
            .map_err(|e| format!("Failed to get asset: {}", e))?
            .ok_or("Asset not found")?;

        // Get folder to get its hash
        let folder = db.get_folder(asset.folder_id)
            .map_err(|e| format!("Failed to get folder: {}", e))?
            .ok_or("Folder not found")?;

        let path = thumb_gen.get_path(asset_id, &folder.hash);
        if path.exists() {
            Ok(Some(path))
        } else {
            Ok(None)
        }
    }

    // ============================================================
    // Tag Methods
    // ============================================================

    pub fn create_tag(&self, name: &str, color: Option<&str>) -> Result<i64, String> {
        let db = self.db.lock().unwrap();
        let db = db.as_ref().ok_or("Database not initialized")?;
        db.create_tag(name, color)
            .map_err(|e| format!("Failed to create tag: {}", e))
    }

    pub fn get_all_tags(&self) -> Result<Vec<Tag>, String> {
        let db = self.db.lock().unwrap();
        let db = db.as_ref().ok_or("Database not initialized")?;
        db.get_all_tags()
            .map_err(|e| format!("Failed to get tags: {}", e))
    }

    pub fn delete_tag(&self, tag_id: i64) -> Result<(), String> {
        let db = self.db.lock().unwrap();
        let db = db.as_ref().ok_or("Database not initialized")?;
        db.delete_tag(tag_id)
            .map_err(|e| format!("Failed to delete tag: {}", e))
    }

    pub fn add_tag_to_asset(&self, asset_id: i64, tag_id: i64) -> Result<(), String> {
        let db = self.db.lock().unwrap();
        let db = db.as_ref().ok_or("Database not initialized")?;
        db.add_tag_to_asset(asset_id, tag_id)
            .map_err(|e| format!("Failed to add tag to asset: {}", e))
    }

    pub fn remove_tag_from_asset(&self, asset_id: i64, tag_id: i64) -> Result<(), String> {
        let db = self.db.lock().unwrap();
        let db = db.as_ref().ok_or("Database not initialized")?;
        db.remove_tag_from_asset(asset_id, tag_id)
            .map_err(|e| format!("Failed to remove tag from asset: {}", e))
    }

    pub fn get_asset_tags(&self, asset_id: i64) -> Result<Vec<Tag>, String> {
        let db = self.db.lock().unwrap();
        let db = db.as_ref().ok_or("Database not initialized")?;
        db.get_asset_tags(asset_id)
            .map_err(|e| format!("Failed to get asset tags: {}", e))
    }

    // ============================================================
    // Note Methods
    // ============================================================

    pub fn set_note(&self, asset_id: i64, content: &str) -> Result<(), String> {
        let db = self.db.lock().unwrap();
        let db = db.as_ref().ok_or("Database not initialized")?;
        db.set_note(asset_id, content)
            .map_err(|e| format!("Failed to set note: {}", e))
    }

    pub fn get_note(&self, asset_id: i64) -> Result<Option<Note>, String> {
        let db = self.db.lock().unwrap();
        let db = db.as_ref().ok_or("Database not initialized")?;
        db.get_note(asset_id)
            .map_err(|e| format!("Failed to get note: {}", e))
    }

    // ============================================================
    // Rating Methods
    // ============================================================

    pub fn set_rating(&self, asset_id: i64, rating: u32) -> Result<(), String> {
        let db = self.db.lock().unwrap();
        let db = db.as_ref().ok_or("Database not initialized")?;
        db.set_rating(asset_id, rating)
            .map_err(|e| format!("Failed to set rating: {}", e))
    }

    pub fn get_rating(&self, asset_id: i64) -> Result<Option<Rating>, String> {
        let db = self.db.lock().unwrap();
        let db = db.as_ref().ok_or("Database not initialized")?;
        db.get_rating(asset_id)
            .map_err(|e| format!("Failed to get rating: {}", e))
    }

    // ============================================================
    // Folder Methods
    // ============================================================

    pub fn set_current_folder(&self, folder_id: i64) -> Result<(), String> {
        *self.current_folder_id.lock().unwrap() = Some(folder_id);
        Ok(())
    }

    pub fn get_current_folder(&self) -> Option<i64> {
        *self.current_folder_id.lock().unwrap()
    }

    pub fn get_all_folders(&self) -> Result<Vec<Folder>, String> {
        let db = self.db.lock().unwrap();
        let db = db.as_ref().ok_or("Database not initialized")?;
        db.get_all_folders()
            .map_err(|e| format!("Failed to get folders: {}", e))
    }

    pub fn get_folder(&self, folder_id: i64) -> Result<Option<Folder>, String> {
        let db = self.db.lock().unwrap();
        let db = db.as_ref().ok_or("Database not initialized")?;
        db.get_folder(folder_id)
            .map_err(|e| format!("Failed to get folder: {}", e))
    }

    pub fn get_assets_by_folder(&self, folder_id: i64) -> Result<Vec<Asset>, String> {
        let db = self.db.lock().unwrap();
        let db = db.as_ref().ok_or("Database not initialized")?;
        db.get_assets_by_folder(folder_id)
            .map_err(|e| format!("Failed to get assets by folder: {}", e))
    }

    pub fn delete_folder(&self, folder_id: i64) -> Result<(), String> {
        let db = self.db.lock().unwrap();
        let db = db.as_ref().ok_or("Database not initialized")?;

        // Get folder info before deletion (for cache cleanup)
        let folder = db.get_folder(folder_id)
            .map_err(|e| format!("Failed to get folder: {}", e))?
            .ok_or("Folder not found")?;

        // Delete from database (cascades to assets)
        db.delete_folder(folder_id)
            .map_err(|e| format!("Failed to delete folder: {}", e))?;

        // Clean up thumbnail cache directory
        let db_path = self.db_path.lock().unwrap();
        if let Some(path) = db_path.as_ref() {
            let cache_dir = path.parent()
                .ok_or("Invalid database path")?
                .join("thumbnails")
                .join(&folder.hash);

            if cache_dir.exists() {
                std::fs::remove_dir_all(&cache_dir)
                    .map_err(|e| format!("Failed to remove cache directory: {}", e))?;
                tracing::info!("Removed cache directory: {}", cache_dir.display());
            }
        }

        // If this was the current folder, clear current folder
        let mut current = self.current_folder_id.lock().unwrap();
        if *current == Some(folder_id) {
            *current = None;
        }

        Ok(())
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
