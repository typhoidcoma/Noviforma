/**
 * Tauri IPC wrapper for database commands
 */

import { invoke } from '@tauri-apps/api/core';

export interface Asset {
  id: number;
  path: string;
  filename: string;
  file_size: number;
  width: number | null;
  height: number | null;
  thumbnail_path: string | null;
  folder_id: number;
  created_at: number;
  indexed_at: number;
}

export interface Folder {
  id: number;
  path: string;
  name: string;
  hash: string;
  asset_count: number;
  scanned_at: number;
  last_accessed: number;
}

export interface ScanResult {
  indexed: number;
  errors: number;
}

export interface ThumbnailResult {
  generated: number;
  skipped: number;
  errors: number;
}

/**
 * Initialize the database
 */
export async function dbInit(dbPath: string): Promise<string> {
  return await invoke('db_init', { dbPath });
}

/**
 * Scan a directory for images
 */
export async function dbScanDirectory(path: string): Promise<ScanResult> {
  return await invoke('db_scan_directory', { path });
}

/**
 * Generate thumbnails for all assets
 */
export async function dbGenerateThumbnails(): Promise<ThumbnailResult> {
  return await invoke('db_generate_thumbnails');
}

/**
 * Get all assets from the database
 */
export async function dbGetAllAssets(): Promise<Asset[]> {
  return await invoke('db_get_all_assets');
}

/**
 * Get a single asset by ID
 */
export async function dbGetAsset(id: number): Promise<Asset | null> {
  return await invoke('db_get_asset', { id });
}

/**
 * Get total number of assets
 */
export async function dbCountAssets(): Promise<number> {
  return await invoke('db_count_assets');
}

/**
 * Get thumbnail path for an asset
 */
export async function dbGetThumbnailPath(assetId: number): Promise<string | null> {
  return await invoke('db_get_thumbnail_path', { assetId });
}

// ============================================================
// Folder Functions
// ============================================================

/**
 * Get all scanned folders
 */
export async function dbGetAllFolders(): Promise<Folder[]> {
  return await invoke('db_get_all_folders');
}

/**
 * Get a folder by ID
 */
export async function dbGetFolder(folderId: number): Promise<Folder | null> {
  return await invoke('db_get_folder', { folderId });
}

/**
 * Set the current active folder
 */
export async function dbSetCurrentFolder(folderId: number): Promise<void> {
  return await invoke('db_set_current_folder', { folderId });
}

/**
 * Get the current active folder ID
 */
export async function dbGetCurrentFolder(): Promise<number | null> {
  return await invoke('db_get_current_folder');
}

/**
 * Get all assets in a specific folder
 */
export async function dbGetAssetsByFolder(folderId: number): Promise<Asset[]> {
  return await invoke('db_get_assets_by_folder', { folderId });
}

/**
 * Delete a folder and all its assets
 * Warning: This also deletes the thumbnail cache directory
 */
export async function dbDeleteFolder(folderId: number): Promise<void> {
  return await invoke('db_delete_folder', { folderId });
}
