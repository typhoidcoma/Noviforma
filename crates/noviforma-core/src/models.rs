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
    pub folder_id: i64,
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
            folder_id: 0, // Will be set by scanner
            created_at: now,
            indexed_at: now,
        }
    }
}

/// Represents a tag in the database
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tag {
    pub id: i64,
    pub name: String,
    pub color: Option<String>,
    pub created_at: i64,
}

/// Represents a note attached to an asset
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Note {
    pub id: i64,
    pub asset_id: i64,
    pub content: String,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Represents a rating for an asset
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Rating {
    pub id: i64,
    pub asset_id: i64,
    pub rating: u32,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Represents a scanned folder/project in the database
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Folder {
    pub id: i64,
    pub path: String,
    pub name: String,
    pub hash: String,
    pub asset_count: i64,
    pub scanned_at: i64,
    pub last_accessed: i64,
}

/// Represents a shot (or sequence child) in the database
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Shot {
    pub id: i64,
    pub name: String,
    pub sequence: Option<String>,
    pub status: String,
    pub description: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Junction record linking an asset to a shot
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShotAsset {
    pub shot_id: i64,
    pub asset_id: i64,
    pub role: Option<String>,
    pub version: Option<i32>,
    pub added_at: i64,
}

/// Combined filter criteria for searching assets
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetFilter {
    pub folder_id: Option<i64>,
    pub search_query: Option<String>,
    pub tag_ids: Option<Vec<i64>>,
    pub min_rating: Option<u32>,
    pub shot_id: Option<i64>,
}

/// Tag with its usage count (for browser display)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TagWithCount {
    pub id: i64,
    pub name: String,
    pub color: Option<String>,
    pub created_at: i64,
    pub count: i64,
}
