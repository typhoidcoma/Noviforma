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

export interface ProgressInfo {
  current: number;
  total: number;
}

/**
 * Poll current thumbnail generation progress
 */
export async function dbGetThumbnailProgress(): Promise<ProgressInfo> {
  return await invoke('db_get_thumbnail_progress');
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

// ============================================================
// Tag Types & Functions
// ============================================================

export interface Tag {
  id: number;
  name: string;
  color: string | null;
  created_at: number;
}

export interface TagWithCount extends Tag {
  count: number;
}

export async function dbCreateTag(name: string, color?: string): Promise<number> {
  return await invoke('db_create_tag', { name, color: color ?? null });
}

export async function dbGetAllTags(): Promise<Tag[]> {
  return await invoke('db_get_all_tags');
}

export async function dbGetAllTagsWithCounts(): Promise<TagWithCount[]> {
  return await invoke('db_get_all_tags_with_counts');
}

export async function dbUpdateTag(tagId: number, name: string, color?: string): Promise<void> {
  return await invoke('db_update_tag', { tagId, name, color: color ?? null });
}

export async function dbDeleteTag(tagId: number): Promise<void> {
  return await invoke('db_delete_tag', { tagId });
}

export async function dbAddTagToAsset(assetId: number, tagId: number): Promise<void> {
  return await invoke('db_add_tag_to_asset', { assetId, tagId });
}

export async function dbRemoveTagFromAsset(assetId: number, tagId: number): Promise<void> {
  return await invoke('db_remove_tag_from_asset', { assetId, tagId });
}

export async function dbGetAssetTags(assetId: number): Promise<Tag[]> {
  return await invoke('db_get_asset_tags', { assetId });
}

// ============================================================
// Note Types & Functions
// ============================================================

export interface Note {
  id: number;
  asset_id: number;
  content: string;
  created_at: number;
  updated_at: number;
}

export async function dbSetAssetNote(assetId: number, content: string): Promise<void> {
  return await invoke('db_set_asset_note', { assetId, content });
}

export async function dbGetAssetNote(assetId: number): Promise<Note | null> {
  return await invoke('db_get_asset_note', { assetId });
}

// ============================================================
// Rating Types & Functions
// ============================================================

export interface Rating {
  id: number;
  asset_id: number;
  rating: number;
  created_at: number;
  updated_at: number;
}

export async function dbSetAssetRating(assetId: number, rating: number): Promise<void> {
  return await invoke('db_set_asset_rating', { assetId, rating });
}

export async function dbGetAssetRating(assetId: number): Promise<Rating | null> {
  return await invoke('db_get_asset_rating', { assetId });
}

// ============================================================
// Shot Types & Functions
// ============================================================

export interface Shot {
  id: number;
  name: string;
  sequence: string | null;
  status: string;
  description: string | null;
  created_at: number;
  updated_at: number;
}

export interface ShotAsset {
  shot_id: number;
  asset_id: number;
  role: string | null;
  version: number | null;
  added_at: number;
}

export async function dbCreateShot(name: string, sequence?: string, description?: string): Promise<number> {
  return await invoke('db_create_shot', { name, sequence: sequence ?? null, description: description ?? null });
}

export async function dbGetAllShots(): Promise<Shot[]> {
  return await invoke('db_get_all_shots');
}

export async function dbGetShot(shotId: number): Promise<Shot | null> {
  return await invoke('db_get_shot', { shotId });
}

export async function dbUpdateShot(shotId: number, name: string, sequence: string | null, status: string, description: string | null): Promise<void> {
  return await invoke('db_update_shot', { shotId, name, sequence, status, description });
}

export async function dbDeleteShot(shotId: number): Promise<void> {
  return await invoke('db_delete_shot', { shotId });
}

export async function dbAddAssetToShot(shotId: number, assetId: number, role?: string, version?: number): Promise<void> {
  return await invoke('db_add_asset_to_shot', { shotId, assetId, role: role ?? null, version: version ?? null });
}

export async function dbRemoveAssetFromShot(shotId: number, assetId: number): Promise<void> {
  return await invoke('db_remove_asset_from_shot', { shotId, assetId });
}

export async function dbGetShotAssets(shotId: number): Promise<ShotAsset[]> {
  return await invoke('db_get_shot_assets', { shotId });
}

export async function dbGetAssetShots(assetId: number): Promise<Shot[]> {
  return await invoke('db_get_asset_shots', { assetId });
}

// ============================================================
// Search / Filter
// ============================================================

export interface AssetFilter {
  folderId?: number | null;
  searchQuery?: string | null;
  tagIds?: number[] | null;
  minRating?: number | null;
  shotId?: number | null;
}

export async function dbSearchAssets(filter: AssetFilter): Promise<Asset[]> {
  return await invoke('db_search_assets', { filter });
}
