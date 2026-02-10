use serde::{Deserialize, Serialize};

/// Represents a media asset in the database
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Asset {
    pub id: i64,
    pub path: String,
    pub filename: String,
    pub file_size: i64,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub thumbnail_path: Option<String>,
    pub created_at: i64,
    pub indexed_at: i64,
}

impl Asset {
    pub fn new(path: String, file_size: i64) -> Self {
        let filename = std::path::Path::new(&path)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();

        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;

        Self {
            id: 0, // Will be set by database
            path,
            filename,
            file_size,
            width: None,
            height: None,
            thumbnail_path: None,
            created_at: now,
            indexed_at: now,
        }
    }
}
