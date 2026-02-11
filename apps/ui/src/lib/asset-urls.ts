/**
 * Helper functions for converting local file paths to Tauri-compatible URLs
 */

import { convertFileSrc } from '@tauri-apps/api/core';

/**
 * Convert a local file path to a URL that can be loaded by the webview
 * @param filePath - Local filesystem path
 * @returns URL string that can be used with fetch() or Image
 */
export function getAssetUrl(filePath: string): string {
  return convertFileSrc(filePath);
}

/**
 * Get the thumbnail URL for an asset
 * Assumes thumbnails are stored relative to the app's data directory
 * @param thumbnailPath - Relative or absolute path to thumbnail
 * @returns URL string for the thumbnail
 */
export function getThumbnailUrl(thumbnailPath: string): string {
  return convertFileSrc(thumbnailPath);
}
