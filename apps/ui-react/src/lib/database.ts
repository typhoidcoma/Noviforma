import { invoke } from "@tauri-apps/api/core";

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
  folder_id: number;
  indexed: number;
  errors: number;
}

export interface ThumbnailResult {
  generated: number;
  skipped: number;
  errors: number;
}

export interface ProgressInfo {
  current: number;
  total: number;
}

export interface Tag {
  id: number;
  name: string;
  color: string | null;
  created_at: number;
}

export interface TagWithCount extends Tag {
  count: number;
}

export interface Note {
  id: number;
  asset_id: number;
  content: string;
  created_at: number;
  updated_at: number;
}

export interface Rating {
  id: number;
  asset_id: number;
  rating: number;
  created_at: number;
  updated_at: number;
}

export interface Shot {
  id: number;
  name: string;
  sequence: string | null;
  status: string;
  description: string | null;
  created_at: number;
  updated_at: number;
}

export interface AssetFilter {
  folderId?: number | null;
  searchQuery?: string | null;
  tagIds?: number[] | null;
  minRating?: number | null;
  shotId?: number | null;
}

export async function dbInit(dbPath: string): Promise<string> {
  return invoke("db_init", { dbPath });
}

export async function dbScanDirectory(path: string): Promise<ScanResult> {
  return invoke("db_scan_directory", { path });
}

export async function dbGenerateThumbnailsForFolder(folderId: number): Promise<ThumbnailResult> {
  return invoke("db_generate_thumbnails_for_folder", { folderId });
}

export async function dbGetThumbnailProgress(): Promise<ProgressInfo> {
  return invoke("db_get_thumbnail_progress");
}

export async function dbGetAllFolders(): Promise<Folder[]> {
  return invoke("db_get_all_folders");
}

export async function dbSetCurrentFolder(folderId: number): Promise<void> {
  return invoke("db_set_current_folder", { folderId });
}

export async function dbGetCurrentFolder(): Promise<number | null> {
  return invoke("db_get_current_folder");
}

export async function dbDeleteFolder(folderId: number): Promise<void> {
  return invoke("db_delete_folder", { folderId });
}

export async function dbGetAllTagsWithCounts(): Promise<TagWithCount[]> {
  return invoke("db_get_all_tags_with_counts");
}

export async function dbCreateTag(name: string, color?: string): Promise<number> {
  return invoke("db_create_tag", { name, color: color ?? null });
}

export async function dbDeleteTag(tagId: number): Promise<void> {
  return invoke("db_delete_tag", { tagId });
}

export async function dbUpdateTag(tagId: number, name: string, color?: string): Promise<void> {
  return invoke("db_update_tag", { tagId, name, color: color ?? null });
}

export async function dbGetAllShots(): Promise<Shot[]> {
  return invoke("db_get_all_shots");
}

export async function dbCreateShot(name: string, sequence?: string): Promise<number> {
  return invoke("db_create_shot", { name, sequence: sequence ?? null, description: null });
}

export async function dbDeleteShot(shotId: number): Promise<void> {
  return invoke("db_delete_shot", { shotId });
}

export async function dbSearchAssets(filter: AssetFilter): Promise<Asset[]> {
  return invoke("db_search_assets", { filter });
}

export async function dbGetAssetTags(assetId: number): Promise<Tag[]> {
  return invoke("db_get_asset_tags", { assetId });
}

export async function dbGetAllTags(): Promise<Tag[]> {
  return invoke("db_get_all_tags");
}

export async function dbAddTagToAsset(assetId: number, tagId: number): Promise<void> {
  return invoke("db_add_tag_to_asset", { assetId, tagId });
}

export async function dbRemoveTagFromAsset(assetId: number, tagId: number): Promise<void> {
  return invoke("db_remove_tag_from_asset", { assetId, tagId });
}

export async function dbGetAssetNote(assetId: number): Promise<Note | null> {
  return invoke("db_get_asset_note", { assetId });
}

export async function dbSetAssetNote(assetId: number, content: string): Promise<void> {
  return invoke("db_set_asset_note", { assetId, content });
}

export async function dbGetAssetRating(assetId: number): Promise<Rating | null> {
  return invoke("db_get_asset_rating", { assetId });
}

export async function dbSetAssetRating(assetId: number, rating: number): Promise<void> {
  return invoke("db_set_asset_rating", { assetId, rating });
}
