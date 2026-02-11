use crate::models::{Asset, AssetFilter, Folder, Shot, ShotAsset, TagWithCount};
use rusqlite::{params, Connection, Result};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

/// Database manager for Noviforma assets
pub struct Database {
    conn: Connection,
}

impl Database {
    /// Create or open database at the specified path
    pub fn new<P: AsRef<Path>>(db_path: P) -> Result<Self> {
        let conn = Connection::open(db_path)?;

        // Check schema version
        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap_or(0);

        // Run migrations if needed
        if version < 2 {
            Self::migrate_to_v2(&conn)?;
            conn.execute("PRAGMA user_version = 2", [])?;
            tracing::info!("Database migrated to version 2");
        }

        if version < 3 {
            Self::migrate_to_v3(&conn)?;
            conn.execute("PRAGMA user_version = 3", [])?;
            tracing::info!("Database migrated to version 3");
        }

        let db = Self { conn };
        db.init_schema()?;
        Ok(db)
    }

    /// Create in-memory database (for testing)
    pub fn in_memory() -> Result<Self> {
        let conn = Connection::open_in_memory()?;
        let db = Self { conn };
        db.init_schema()?;
        Ok(db)
    }

    /// Migrate database from v1 to v2 (adds folders table and folder_id to assets)
    fn migrate_to_v2(conn: &Connection) -> Result<()> {
        tracing::info!("Running database migration to v2...");

        // Create folders table
        conn.execute(
            "CREATE TABLE IF NOT EXISTS folders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                path TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL,
                hash TEXT NOT NULL UNIQUE,
                asset_count INTEGER NOT NULL DEFAULT 0,
                scanned_at INTEGER NOT NULL,
                last_accessed INTEGER NOT NULL
            )",
            [],
        )?;

        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_folders_path ON folders(path)",
            [],
        )?;

        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_folders_hash ON folders(hash)",
            [],
        )?;

        // Check if folder_id column already exists
        let has_folder_id: i64 = conn.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('assets') WHERE name='folder_id'",
            [],
            |row| row.get(0),
        )?;

        if has_folder_id == 0 {
            // Add folder_id column to assets
            conn.execute("ALTER TABLE assets ADD COLUMN folder_id INTEGER", [])?;

            // Create a default "Unknown" folder for existing assets
            let now = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_secs() as i64;

            // Generate hash for Unknown folder
            use sha2::{Digest, Sha256};
            let mut hasher = Sha256::new();
            hasher.update(b"unknown");
            let hash = format!("{:x}", hasher.finalize())[..16].to_string();

            conn.execute(
                "INSERT INTO folders (path, name, hash, asset_count, scanned_at, last_accessed)
                 VALUES ('Unknown', 'Unknown', ?1, 0, ?2, ?2)",
                params![hash, now],
            )?;

            let unknown_folder_id = conn.last_insert_rowid();

            // Assign all existing assets to unknown folder
            conn.execute(
                "UPDATE assets SET folder_id = ?1 WHERE folder_id IS NULL",
                params![unknown_folder_id],
            )?;

            // Update folder asset count
            conn.execute(
                "UPDATE folders SET asset_count = (SELECT COUNT(*) FROM assets WHERE folder_id = ?1) WHERE id = ?1",
                params![unknown_folder_id],
            )?;

            // Create index for folder_id
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_assets_folder_id ON assets(folder_id)",
                [],
            )?;

            tracing::info!("Migration complete: added folder_id column and created Unknown folder");
        }

        Ok(())
    }

    /// Migrate database from v2 to v3 (adds shots and shot_assets tables)
    fn migrate_to_v3(conn: &Connection) -> Result<()> {
        tracing::info!("Running database migration to v3...");

        conn.execute(
            "CREATE TABLE IF NOT EXISTS shots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                sequence TEXT,
                status TEXT NOT NULL DEFAULT 'active',
                description TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            )",
            [],
        )?;

        conn.execute(
            "CREATE TABLE IF NOT EXISTS shot_assets (
                shot_id INTEGER NOT NULL,
                asset_id INTEGER NOT NULL,
                role TEXT,
                version INTEGER,
                added_at INTEGER NOT NULL,
                PRIMARY KEY (shot_id, asset_id),
                FOREIGN KEY (shot_id) REFERENCES shots(id) ON DELETE CASCADE,
                FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
            )",
            [],
        )?;

        conn.execute("CREATE INDEX IF NOT EXISTS idx_shot_assets_asset_id ON shot_assets(asset_id)", [])?;
        conn.execute("CREATE INDEX IF NOT EXISTS idx_shot_assets_shot_id ON shot_assets(shot_id)", [])?;
        conn.execute("CREATE INDEX IF NOT EXISTS idx_shots_sequence ON shots(sequence)", [])?;
        conn.execute("CREATE INDEX IF NOT EXISTS idx_assets_filename ON assets(filename)", [])?;

        tracing::info!("Migration to v3 complete: added shots and shot_assets tables");
        Ok(())
    }

    /// Initialize database schema
    fn init_schema(&self) -> Result<()> {
        // Folders table (created first for foreign key reference)
        self.conn.execute(
            "CREATE TABLE IF NOT EXISTS folders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                path TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL,
                hash TEXT NOT NULL UNIQUE,
                asset_count INTEGER NOT NULL DEFAULT 0,
                scanned_at INTEGER NOT NULL,
                last_accessed INTEGER NOT NULL
            )",
            [],
        )?;

        self.conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_folders_path ON folders(path)",
            [],
        )?;

        self.conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_folders_hash ON folders(hash)",
            [],
        )?;

        // Assets table (includes folder_id reference)
        self.conn.execute(
            "CREATE TABLE IF NOT EXISTS assets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                path TEXT NOT NULL UNIQUE,
                filename TEXT NOT NULL,
                file_size INTEGER NOT NULL,
                width INTEGER,
                height INTEGER,
                thumbnail_path TEXT,
                folder_id INTEGER,
                created_at INTEGER NOT NULL,
                indexed_at INTEGER NOT NULL,
                FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE CASCADE
            )",
            [],
        )?;

        // Create indexes for faster lookups
        self.conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_assets_path ON assets(path)",
            [],
        )?;

        self.conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_assets_indexed_at ON assets(indexed_at)",
            [],
        )?;

        self.conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_assets_folder_id ON assets(folder_id)",
            [],
        )?;

        // Tags table
        self.conn.execute(
            "CREATE TABLE IF NOT EXISTS tags (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                color TEXT,
                created_at INTEGER NOT NULL
            )",
            [],
        )?;

        // Asset-to-tag mapping (many-to-many)
        self.conn.execute(
            "CREATE TABLE IF NOT EXISTS asset_tags (
                asset_id INTEGER NOT NULL,
                tag_id INTEGER NOT NULL,
                added_at INTEGER NOT NULL,
                PRIMARY KEY (asset_id, tag_id),
                FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE,
                FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
            )",
            [],
        )?;

        self.conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_asset_tags_tag_id ON asset_tags(tag_id)",
            [],
        )?;

        self.conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_asset_tags_asset_id ON asset_tags(asset_id)",
            [],
        )?;

        // Notes table (one per asset)
        self.conn.execute(
            "CREATE TABLE IF NOT EXISTS notes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                asset_id INTEGER NOT NULL UNIQUE,
                content TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
            )",
            [],
        )?;

        // Ratings table (one per asset)
        self.conn.execute(
            "CREATE TABLE IF NOT EXISTS ratings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                asset_id INTEGER NOT NULL UNIQUE,
                rating INTEGER NOT NULL CHECK (rating >= 0 AND rating <= 5),
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
            )",
            [],
        )?;

        // Shots table
        self.conn.execute(
            "CREATE TABLE IF NOT EXISTS shots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                sequence TEXT,
                status TEXT NOT NULL DEFAULT 'active',
                description TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            )",
            [],
        )?;

        // Shot-asset junction table
        self.conn.execute(
            "CREATE TABLE IF NOT EXISTS shot_assets (
                shot_id INTEGER NOT NULL,
                asset_id INTEGER NOT NULL,
                role TEXT,
                version INTEGER,
                added_at INTEGER NOT NULL,
                PRIMARY KEY (shot_id, asset_id),
                FOREIGN KEY (shot_id) REFERENCES shots(id) ON DELETE CASCADE,
                FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
            )",
            [],
        )?;

        self.conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_shot_assets_asset_id ON shot_assets(asset_id)",
            [],
        )?;

        self.conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_shot_assets_shot_id ON shot_assets(shot_id)",
            [],
        )?;

        self.conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_shots_sequence ON shots(sequence)",
            [],
        )?;

        self.conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_assets_filename ON assets(filename)",
            [],
        )?;

        tracing::info!("Database schema initialized");
        Ok(())
    }

    /// Insert a new asset
    pub fn insert_asset(&self, asset: &Asset) -> Result<i64> {
        self.conn.execute(
            "INSERT INTO assets (path, filename, file_size, width, height, thumbnail_path, folder_id, created_at, indexed_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(path) DO UPDATE SET
                file_size = excluded.file_size,
                folder_id = excluded.folder_id,
                indexed_at = excluded.indexed_at",
            params![
                asset.path,
                asset.filename,
                asset.file_size,
                asset.width,
                asset.height,
                asset.thumbnail_path,
                asset.folder_id,
                asset.created_at,
                asset.indexed_at,
            ],
        )?;

        Ok(self.conn.last_insert_rowid())
    }

    /// Update asset thumbnail path
    pub fn update_thumbnail(&self, asset_id: i64, thumbnail_path: &str) -> Result<()> {
        self.conn.execute(
            "UPDATE assets SET thumbnail_path = ?1 WHERE id = ?2",
            params![thumbnail_path, asset_id],
        )?;
        Ok(())
    }

    /// Update asset dimensions (width and height)
    pub fn update_dimensions(&self, asset_id: i64, width: u32, height: u32) -> Result<()> {
        self.conn.execute(
            "UPDATE assets SET width = ?1, height = ?2 WHERE id = ?3",
            params![width, height, asset_id],
        )?;
        Ok(())
    }

    /// Get all assets
    pub fn get_all_assets(&self) -> Result<Vec<Asset>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, path, filename, file_size, width, height, thumbnail_path, folder_id, created_at, indexed_at
             FROM assets
             ORDER BY indexed_at DESC",
        )?;

        let assets = stmt
            .query_map([], |row| {
                Ok(Asset {
                    id: row.get(0)?,
                    path: row.get(1)?,
                    filename: row.get(2)?,
                    file_size: row.get(3)?,
                    width: row.get(4)?,
                    height: row.get(5)?,
                    thumbnail_path: row.get(6)?,
                    folder_id: row.get(7)?,
                    created_at: row.get(8)?,
                    indexed_at: row.get(9)?,
                })
            })?
            .collect::<Result<Vec<_>>>()?;

        Ok(assets)
    }

    /// Get asset by ID
    pub fn get_asset(&self, id: i64) -> Result<Option<Asset>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, path, filename, file_size, width, height, thumbnail_path, folder_id, created_at, indexed_at
             FROM assets
             WHERE id = ?1",
        )?;

        let mut rows = stmt.query([id])?;

        if let Some(row) = rows.next()? {
            Ok(Some(Asset {
                id: row.get(0)?,
                path: row.get(1)?,
                filename: row.get(2)?,
                file_size: row.get(3)?,
                width: row.get(4)?,
                height: row.get(5)?,
                thumbnail_path: row.get(6)?,
                folder_id: row.get(7)?,
                created_at: row.get(8)?,
                indexed_at: row.get(9)?,
            }))
        } else {
            Ok(None)
        }
    }

    /// Get total asset count
    pub fn count_assets(&self) -> Result<i64> {
        let count: i64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM assets", [], |row| row.get(0))?;
        Ok(count)
    }

    // ============================================================
    // Tag Methods
    // ============================================================

    /// Create a new tag
    pub fn create_tag(&self, name: &str, color: Option<&str>) -> Result<i64> {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;

        self.conn.execute(
            "INSERT INTO tags (name, color, created_at) VALUES (?1, ?2, ?3)",
            params![name, color, now],
        )?;

        Ok(self.conn.last_insert_rowid())
    }

    /// Get all tags
    pub fn get_all_tags(&self) -> Result<Vec<crate::models::Tag>> {
        use crate::models::Tag;

        let mut stmt = self.conn.prepare(
            "SELECT id, name, color, created_at FROM tags ORDER BY name"
        )?;

        let tags = stmt
            .query_map([], |row| {
                Ok(Tag {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    color: row.get(2)?,
                    created_at: row.get(3)?,
                })
            })?
            .collect::<Result<Vec<_>>>()?;

        Ok(tags)
    }

    /// Get tag by ID
    pub fn get_tag(&self, tag_id: i64) -> Result<Option<crate::models::Tag>> {
        use crate::models::Tag;

        let mut stmt = self.conn.prepare(
            "SELECT id, name, color, created_at FROM tags WHERE id = ?1"
        )?;

        let mut rows = stmt.query([tag_id])?;

        if let Some(row) = rows.next()? {
            Ok(Some(Tag {
                id: row.get(0)?,
                name: row.get(1)?,
                color: row.get(2)?,
                created_at: row.get(3)?,
            }))
        } else {
            Ok(None)
        }
    }

    /// Delete a tag
    pub fn delete_tag(&self, tag_id: i64) -> Result<()> {
        self.conn.execute("DELETE FROM tags WHERE id = ?1", params![tag_id])?;
        Ok(())
    }

    /// Add a tag to an asset
    pub fn add_tag_to_asset(&self, asset_id: i64, tag_id: i64) -> Result<()> {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;

        self.conn.execute(
            "INSERT OR IGNORE INTO asset_tags (asset_id, tag_id, added_at) VALUES (?1, ?2, ?3)",
            params![asset_id, tag_id, now],
        )?;

        Ok(())
    }

    /// Remove a tag from an asset
    pub fn remove_tag_from_asset(&self, asset_id: i64, tag_id: i64) -> Result<()> {
        self.conn.execute(
            "DELETE FROM asset_tags WHERE asset_id = ?1 AND tag_id = ?2",
            params![asset_id, tag_id],
        )?;

        Ok(())
    }

    /// Get all tags for an asset
    pub fn get_asset_tags(&self, asset_id: i64) -> Result<Vec<crate::models::Tag>> {
        use crate::models::Tag;

        let mut stmt = self.conn.prepare(
            "SELECT t.id, t.name, t.color, t.created_at
             FROM tags t
             INNER JOIN asset_tags at ON t.id = at.tag_id
             WHERE at.asset_id = ?1
             ORDER BY t.name"
        )?;

        let tags = stmt
            .query_map([asset_id], |row| {
                Ok(Tag {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    color: row.get(2)?,
                    created_at: row.get(3)?,
                })
            })?
            .collect::<Result<Vec<_>>>()?;

        Ok(tags)
    }

    /// Get all asset IDs that have a specific tag
    pub fn get_assets_by_tag(&self, tag_id: i64) -> Result<Vec<i64>> {
        let mut stmt = self.conn.prepare(
            "SELECT asset_id FROM asset_tags WHERE tag_id = ?1"
        )?;

        let asset_ids = stmt
            .query_map([tag_id], |row| row.get(0))?
            .collect::<Result<Vec<_>>>()?;

        Ok(asset_ids)
    }

    // ============================================================
    // Note Methods
    // ============================================================

    /// Set or update a note for an asset
    pub fn set_note(&self, asset_id: i64, content: &str) -> Result<()> {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;

        self.conn.execute(
            "INSERT INTO notes (asset_id, content, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?3)
             ON CONFLICT(asset_id) DO UPDATE SET content = ?2, updated_at = ?3",
            params![asset_id, content, now],
        )?;

        Ok(())
    }

    /// Get note for an asset
    pub fn get_note(&self, asset_id: i64) -> Result<Option<crate::models::Note>> {
        use crate::models::Note;

        let mut stmt = self.conn.prepare(
            "SELECT id, asset_id, content, created_at, updated_at
             FROM notes
             WHERE asset_id = ?1"
        )?;

        let mut rows = stmt.query([asset_id])?;

        if let Some(row) = rows.next()? {
            Ok(Some(Note {
                id: row.get(0)?,
                asset_id: row.get(1)?,
                content: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
            }))
        } else {
            Ok(None)
        }
    }

    /// Delete a note for an asset
    pub fn delete_note(&self, asset_id: i64) -> Result<()> {
        self.conn.execute("DELETE FROM notes WHERE asset_id = ?1", params![asset_id])?;
        Ok(())
    }

    // ============================================================
    // Rating Methods
    // ============================================================

    /// Set or update a rating for an asset
    pub fn set_rating(&self, asset_id: i64, rating: u32) -> Result<()> {
        if rating > 5 {
            return Err(rusqlite::Error::InvalidQuery);
        }

        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;

        self.conn.execute(
            "INSERT INTO ratings (asset_id, rating, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?3)
             ON CONFLICT(asset_id) DO UPDATE SET rating = ?2, updated_at = ?3",
            params![asset_id, rating, now],
        )?;

        Ok(())
    }

    /// Get rating for an asset
    pub fn get_rating(&self, asset_id: i64) -> Result<Option<crate::models::Rating>> {
        use crate::models::Rating;

        let mut stmt = self.conn.prepare(
            "SELECT id, asset_id, rating, created_at, updated_at
             FROM ratings
             WHERE asset_id = ?1"
        )?;

        let mut rows = stmt.query([asset_id])?;

        if let Some(row) = rows.next()? {
            Ok(Some(Rating {
                id: row.get(0)?,
                asset_id: row.get(1)?,
                rating: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
            }))
        } else {
            Ok(None)
        }
    }

    /// Delete a rating for an asset
    pub fn delete_rating(&self, asset_id: i64) -> Result<()> {
        self.conn.execute("DELETE FROM ratings WHERE asset_id = ?1", params![asset_id])?;
        Ok(())
    }

    // ============================================================
    // Folder Methods
    // ============================================================

    /// Get or create a folder entry for a given path
    pub fn get_or_create_folder(&self, folder_path: &Path) -> Result<Folder> {
        let path_str = folder_path.to_string_lossy().to_string();

        // Check if folder already exists
        let mut stmt = self.conn.prepare("SELECT id, path, name, hash, asset_count, scanned_at, last_accessed FROM folders WHERE path = ?1")?;
        let result = stmt.query_row([&path_str], |row| {
            Ok(Folder {
                id: row.get(0)?,
                path: row.get(1)?,
                name: row.get(2)?,
                hash: row.get(3)?,
                asset_count: row.get(4)?,
                scanned_at: row.get(5)?,
                last_accessed: row.get(6)?,
            })
        });

        match result {
            Ok(folder) => {
                // Update last_accessed
                let now = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_secs() as i64;
                self.conn.execute(
                    "UPDATE folders SET last_accessed = ?1 WHERE id = ?2",
                    params![now, folder.id],
                )?;
                Ok(folder)
            }
            Err(rusqlite::Error::QueryReturnedNoRows) => {
                // Create new folder entry
                let name = folder_path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("Unknown")
                    .to_string();

                // Generate hash for cache directory (SHA-256 of path, first 16 chars)
                use sha2::{Digest, Sha256};
                let mut hasher = Sha256::new();
                hasher.update(path_str.as_bytes());
                let hash = format!("{:x}", hasher.finalize())[..16].to_string();

                let now = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_secs() as i64;

                self.conn.execute(
                    "INSERT INTO folders (path, name, hash, asset_count, scanned_at, last_accessed)
                     VALUES (?1, ?2, ?3, 0, ?4, ?4)",
                    params![path_str, name, hash, now],
                )?;

                let id = self.conn.last_insert_rowid();

                Ok(Folder {
                    id,
                    path: path_str,
                    name,
                    hash,
                    asset_count: 0,
                    scanned_at: now,
                    last_accessed: now,
                })
            }
            Err(e) => Err(e),
        }
    }

    /// Get all folders
    pub fn get_all_folders(&self) -> Result<Vec<Folder>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, path, name, hash, asset_count, scanned_at, last_accessed
             FROM folders
             ORDER BY last_accessed DESC",
        )?;

        let folders = stmt
            .query_map([], |row| {
                Ok(Folder {
                    id: row.get(0)?,
                    path: row.get(1)?,
                    name: row.get(2)?,
                    hash: row.get(3)?,
                    asset_count: row.get(4)?,
                    scanned_at: row.get(5)?,
                    last_accessed: row.get(6)?,
                })
            })?
            .collect::<Result<Vec<_>>>()?;

        Ok(folders)
    }

    /// Get folder by ID
    pub fn get_folder(&self, folder_id: i64) -> Result<Option<Folder>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, path, name, hash, asset_count, scanned_at, last_accessed
             FROM folders
             WHERE id = ?1",
        )?;

        let result = stmt.query_row([folder_id], |row| {
            Ok(Folder {
                id: row.get(0)?,
                path: row.get(1)?,
                name: row.get(2)?,
                hash: row.get(3)?,
                asset_count: row.get(4)?,
                scanned_at: row.get(5)?,
                last_accessed: row.get(6)?,
            })
        });

        match result {
            Ok(folder) => Ok(Some(folder)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    }

    /// Update folder asset count
    pub fn update_folder_asset_count(&self, folder_id: i64) -> Result<()> {
        self.conn.execute(
            "UPDATE folders
             SET asset_count = (SELECT COUNT(*) FROM assets WHERE folder_id = ?1)
             WHERE id = ?1",
            params![folder_id],
        )?;
        Ok(())
    }

    /// Get assets by folder ID
    pub fn get_assets_by_folder(&self, folder_id: i64) -> Result<Vec<Asset>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, path, filename, file_size, width, height, thumbnail_path, folder_id, created_at, indexed_at
             FROM assets
             WHERE folder_id = ?1
             ORDER BY indexed_at DESC",
        )?;

        let assets = stmt
            .query_map([folder_id], |row| {
                Ok(Asset {
                    id: row.get(0)?,
                    path: row.get(1)?,
                    filename: row.get(2)?,
                    file_size: row.get(3)?,
                    width: row.get(4)?,
                    height: row.get(5)?,
                    thumbnail_path: row.get(6)?,
                    folder_id: row.get(7)?,
                    created_at: row.get(8)?,
                    indexed_at: row.get(9)?,
                })
            })?
            .collect::<Result<Vec<_>>>()?;

        Ok(assets)
    }

    /// Delete a folder and all its assets (CASCADE)
    pub fn delete_folder(&self, folder_id: i64) -> Result<()> {
        self.conn.execute("DELETE FROM folders WHERE id = ?1", params![folder_id])?;
        // Assets are automatically deleted via CASCADE
        Ok(())
    }

    // ============================================================
    // Extended Tag Methods
    // ============================================================

    /// Update a tag's name and color
    pub fn update_tag(&self, tag_id: i64, name: &str, color: Option<&str>) -> Result<()> {
        self.conn.execute(
            "UPDATE tags SET name = ?1, color = ?2 WHERE id = ?3",
            params![name, color, tag_id],
        )?;
        Ok(())
    }

    /// Get all tags with their usage counts
    pub fn get_all_tags_with_counts(&self) -> Result<Vec<TagWithCount>> {
        let mut stmt = self.conn.prepare(
            "SELECT t.id, t.name, t.color, t.created_at,
                    COUNT(at.asset_id) as count
             FROM tags t
             LEFT JOIN asset_tags at ON t.id = at.tag_id
             GROUP BY t.id
             ORDER BY t.name"
        )?;

        let tags = stmt
            .query_map([], |row| {
                Ok(TagWithCount {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    color: row.get(2)?,
                    created_at: row.get(3)?,
                    count: row.get(4)?,
                })
            })?
            .collect::<Result<Vec<_>>>()?;

        Ok(tags)
    }

    // ============================================================
    // Shot Methods
    // ============================================================

    /// Create a new shot
    pub fn create_shot(&self, name: &str, sequence: Option<&str>, description: Option<&str>) -> Result<i64> {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;

        self.conn.execute(
            "INSERT INTO shots (name, sequence, status, description, created_at, updated_at)
             VALUES (?1, ?2, 'active', ?3, ?4, ?4)",
            params![name, sequence, description, now],
        )?;

        Ok(self.conn.last_insert_rowid())
    }

    /// Get a shot by ID
    pub fn get_shot(&self, shot_id: i64) -> Result<Option<Shot>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, sequence, status, description, created_at, updated_at
             FROM shots WHERE id = ?1"
        )?;

        let result = stmt.query_row([shot_id], |row| {
            Ok(Shot {
                id: row.get(0)?,
                name: row.get(1)?,
                sequence: row.get(2)?,
                status: row.get(3)?,
                description: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        });

        match result {
            Ok(shot) => Ok(Some(shot)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    }

    /// Get all shots
    pub fn get_all_shots(&self) -> Result<Vec<Shot>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, sequence, status, description, created_at, updated_at
             FROM shots
             ORDER BY sequence, name"
        )?;

        let shots = stmt
            .query_map([], |row| {
                Ok(Shot {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    sequence: row.get(2)?,
                    status: row.get(3)?,
                    description: row.get(4)?,
                    created_at: row.get(5)?,
                    updated_at: row.get(6)?,
                })
            })?
            .collect::<Result<Vec<_>>>()?;

        Ok(shots)
    }

    /// Update a shot
    pub fn update_shot(&self, shot_id: i64, name: &str, sequence: Option<&str>, status: &str, description: Option<&str>) -> Result<()> {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;

        self.conn.execute(
            "UPDATE shots SET name = ?1, sequence = ?2, status = ?3, description = ?4, updated_at = ?5 WHERE id = ?6",
            params![name, sequence, status, description, now, shot_id],
        )?;
        Ok(())
    }

    /// Delete a shot
    pub fn delete_shot(&self, shot_id: i64) -> Result<()> {
        self.conn.execute("DELETE FROM shots WHERE id = ?1", params![shot_id])?;
        Ok(())
    }

    /// Add an asset to a shot
    pub fn add_asset_to_shot(&self, shot_id: i64, asset_id: i64, role: Option<&str>, version: Option<i32>) -> Result<()> {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;

        self.conn.execute(
            "INSERT OR IGNORE INTO shot_assets (shot_id, asset_id, role, version, added_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![shot_id, asset_id, role, version, now],
        )?;
        Ok(())
    }

    /// Remove an asset from a shot
    pub fn remove_asset_from_shot(&self, shot_id: i64, asset_id: i64) -> Result<()> {
        self.conn.execute(
            "DELETE FROM shot_assets WHERE shot_id = ?1 AND asset_id = ?2",
            params![shot_id, asset_id],
        )?;
        Ok(())
    }

    /// Get all shot-asset records for a shot
    pub fn get_shot_assets(&self, shot_id: i64) -> Result<Vec<ShotAsset>> {
        let mut stmt = self.conn.prepare(
            "SELECT shot_id, asset_id, role, version, added_at
             FROM shot_assets WHERE shot_id = ?1
             ORDER BY added_at"
        )?;

        let records = stmt
            .query_map([shot_id], |row| {
                Ok(ShotAsset {
                    shot_id: row.get(0)?,
                    asset_id: row.get(1)?,
                    role: row.get(2)?,
                    version: row.get(3)?,
                    added_at: row.get(4)?,
                })
            })?
            .collect::<Result<Vec<_>>>()?;

        Ok(records)
    }

    /// Get all shots that an asset belongs to
    pub fn get_asset_shots(&self, asset_id: i64) -> Result<Vec<Shot>> {
        let mut stmt = self.conn.prepare(
            "SELECT s.id, s.name, s.sequence, s.status, s.description, s.created_at, s.updated_at
             FROM shots s
             INNER JOIN shot_assets sa ON s.id = sa.shot_id
             WHERE sa.asset_id = ?1
             ORDER BY s.sequence, s.name"
        )?;

        let shots = stmt
            .query_map([asset_id], |row| {
                Ok(Shot {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    sequence: row.get(2)?,
                    status: row.get(3)?,
                    description: row.get(4)?,
                    created_at: row.get(5)?,
                    updated_at: row.get(6)?,
                })
            })?
            .collect::<Result<Vec<_>>>()?;

        Ok(shots)
    }

    // ============================================================
    // Search / Filter
    // ============================================================

    /// Search assets with combined filter criteria
    pub fn search_assets(&self, filter: &AssetFilter) -> Result<Vec<Asset>> {
        let mut sql = String::from(
            "SELECT a.id, a.path, a.filename, a.file_size, a.width, a.height,
                    a.thumbnail_path, a.folder_id, a.created_at, a.indexed_at
             FROM assets a"
        );

        let mut conditions: Vec<String> = Vec::new();
        let mut params_vec: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
        let mut param_idx = 1;

        // folder_id filter
        if let Some(folder_id) = filter.folder_id {
            conditions.push(format!("a.folder_id = ?{}", param_idx));
            params_vec.push(Box::new(folder_id));
            param_idx += 1;
        }

        // filename LIKE filter
        if let Some(ref query) = filter.search_query {
            if !query.is_empty() {
                conditions.push(format!("a.filename LIKE ?{}", param_idx));
                params_vec.push(Box::new(format!("%{}%", query)));
                param_idx += 1;
            }
        }

        // min_rating filter (subquery)
        if let Some(min_rating) = filter.min_rating {
            if min_rating > 0 {
                conditions.push(format!(
                    "a.id IN (SELECT asset_id FROM ratings WHERE rating >= ?{})",
                    param_idx
                ));
                params_vec.push(Box::new(min_rating));
                param_idx += 1;
            }
        }

        // tag_ids filter (subquery with HAVING for AND logic)
        if let Some(ref tag_ids) = filter.tag_ids {
            if !tag_ids.is_empty() {
                let placeholders: Vec<String> = tag_ids.iter().enumerate()
                    .map(|(i, _)| format!("?{}", param_idx + i))
                    .collect();
                conditions.push(format!(
                    "a.id IN (SELECT asset_id FROM asset_tags WHERE tag_id IN ({}) GROUP BY asset_id HAVING COUNT(DISTINCT tag_id) = {})",
                    placeholders.join(", "),
                    tag_ids.len()
                ));
                for tag_id in tag_ids {
                    params_vec.push(Box::new(*tag_id));
                    param_idx += 1;
                }
            }
        }

        // shot_id filter (subquery)
        if let Some(shot_id) = filter.shot_id {
            conditions.push(format!(
                "a.id IN (SELECT asset_id FROM shot_assets WHERE shot_id = ?{})",
                param_idx
            ));
            params_vec.push(Box::new(shot_id));
            param_idx += 1;
        }

        // Build WHERE clause
        if !conditions.is_empty() {
            sql.push_str(" WHERE ");
            sql.push_str(&conditions.join(" AND "));
        }

        sql.push_str(" ORDER BY a.indexed_at DESC");

        // Suppress unused variable warning
        let _ = param_idx;

        // Execute with dynamic params
        let params_refs: Vec<&dyn rusqlite::types::ToSql> = params_vec.iter().map(|p| p.as_ref()).collect();
        let mut stmt = self.conn.prepare(&sql)?;
        let assets = stmt
            .query_map(params_refs.as_slice(), |row| {
                Ok(Asset {
                    id: row.get(0)?,
                    path: row.get(1)?,
                    filename: row.get(2)?,
                    file_size: row.get(3)?,
                    width: row.get(4)?,
                    height: row.get(5)?,
                    thumbnail_path: row.get(6)?,
                    folder_id: row.get(7)?,
                    created_at: row.get(8)?,
                    indexed_at: row.get(9)?,
                })
            })?
            .collect::<Result<Vec<_>>>()?;

        Ok(assets)
    }
}
