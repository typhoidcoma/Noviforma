use crate::models::Asset;
use rusqlite::{params, Connection, Result};
use std::path::Path;

/// Database manager for Noviforma assets
pub struct Database {
    conn: Connection,
}

impl Database {
    /// Create or open database at the specified path
    pub fn new<P: AsRef<Path>>(db_path: P) -> Result<Self> {
        let conn = Connection::open(db_path)?;
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

    /// Initialize database schema
    fn init_schema(&self) -> Result<()> {
        self.conn.execute(
            "CREATE TABLE IF NOT EXISTS assets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                path TEXT NOT NULL UNIQUE,
                filename TEXT NOT NULL,
                file_size INTEGER NOT NULL,
                width INTEGER,
                height INTEGER,
                thumbnail_path TEXT,
                created_at INTEGER NOT NULL,
                indexed_at INTEGER NOT NULL
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

        tracing::info!("Database schema initialized");
        Ok(())
    }

    /// Insert a new asset
    pub fn insert_asset(&self, asset: &Asset) -> Result<i64> {
        self.conn.execute(
            "INSERT INTO assets (path, filename, file_size, width, height, thumbnail_path, created_at, indexed_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                asset.path,
                asset.filename,
                asset.file_size,
                asset.width,
                asset.height,
                asset.thumbnail_path,
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

    /// Get all assets
    pub fn get_all_assets(&self) -> Result<Vec<Asset>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, path, filename, file_size, width, height, thumbnail_path, created_at, indexed_at
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
                    created_at: row.get(7)?,
                    indexed_at: row.get(8)?,
                })
            })?
            .collect::<Result<Vec<_>>>()?;

        Ok(assets)
    }

    /// Get asset by ID
    pub fn get_asset(&self, id: i64) -> Result<Option<Asset>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, path, filename, file_size, width, height, thumbnail_path, created_at, indexed_at
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
                created_at: row.get(7)?,
                indexed_at: row.get(8)?,
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
}
