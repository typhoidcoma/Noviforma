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
  // Convert to absolute path if relative
  let absolutePath = thumbnailPath;

  // If path doesn't start with drive letter, make it absolute from current directory
  if (!thumbnailPath.match(/^[a-zA-Z]:/)) {
    // Tauri runs from src-tauri directory, so paths are relative to that
    absolutePath = `I:/Projects/Developing/Noviforma/src-tauri/${thumbnailPath}`;
  }

  // Convert backslashes to forward slashes for web URLs
  const normalized = absolutePath.replace(/\\/g, '/');

  console.log('Converting thumbnail path:', { original: thumbnailPath, absolute: absolutePath, normalized });

  return convertFileSrc(normalized);
}
