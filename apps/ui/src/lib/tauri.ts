/**
 * Tauri IPC wrapper for renderer commands
 */

import { invoke } from '@tauri-apps/api/core';

export interface TileData {
  id: number;
  asset_id: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface VisibleTilesPayload {
  tiles: TileData[];
  viewport_w: number;
  viewport_h: number;
  dpr: number;
  selected_ids: number[];
}

/**
 * Initialize the renderer
 */
export async function rendererInit(): Promise<string> {
  return await invoke('renderer_init');
}

/**
 * Notify renderer of viewport resize
 */
export async function rendererResize(width: number, height: number, dpr: number): Promise<void> {
  await invoke('renderer_resize', { width, height, dpr });
}

/**
 * Update visible tiles in the renderer
 */
export async function rendererUpdateTiles(payload: VisibleTilesPayload): Promise<void> {
  await invoke('renderer_update_tiles', { payload });
}

/**
 * Load a texture into the GPU for an asset
 * Returns the texture index in the GPU texture array
 */
export async function rendererLoadTexture(assetId: number, texturePath: string): Promise<number> {
  return await invoke('renderer_load_texture', { assetId, texturePath });
}

/**
 * Load multiple textures in a batch (non-blocking)
 * Returns the number of textures successfully loaded
 */
export async function rendererLoadTexturesBatch(assetIds: number[]): Promise<number> {
  return await invoke('renderer_load_textures_batch', { assetIds });
}
