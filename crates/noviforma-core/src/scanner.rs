use crate::models::Asset;
use std::path::Path;
use walkdir::WalkDir;

/// Supported image extensions
const IMAGE_EXTENSIONS: &[&str] = &["jpg", "jpeg", "png", "webp", "bmp", "tiff", "tif"];

/// Scan a directory recursively for image files
pub fn scan_directory<P: AsRef<Path>>(root_path: P, folder_id: i64) -> Vec<Asset> {
    let root_path = root_path.as_ref();
    let mut assets = Vec::new();

    tracing::info!("Scanning directory: {} (folder_id: {})", root_path.display(), folder_id);

    for entry in WalkDir::new(root_path)
        .follow_links(false)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let path = entry.path();

        // Skip directories
        if !path.is_file() {
            continue;
        }

        // Check if file has supported extension
        if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
            if IMAGE_EXTENSIONS.contains(&ext.to_lowercase().as_str()) {
                // Get file size
                if let Ok(metadata) = entry.metadata() {
                    let path_str = path.to_string_lossy().to_string();
                    let mut asset = Asset::new(path_str, metadata.len() as i64);
                    asset.folder_id = folder_id;  // Assign folder ID
                    assets.push(asset);
                }
            }
        }
    }

    tracing::info!("Found {} image files in folder {}", assets.len(), folder_id);
    assets
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_scan_empty_directory() {
        let temp_dir = tempfile::tempdir().unwrap();
        let assets = scan_directory(temp_dir.path(), 0);
        assert_eq!(assets.len(), 0);
    }
}
