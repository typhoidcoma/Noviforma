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

/**
 * Enter viewer mode for a specific asset
 */
export async function rendererEnterViewer(assetId: number): Promise<void> {
  await invoke('renderer_enter_viewer', { assetId });
}

/**
 * Exit viewer mode and return to grid
 */
export async function rendererExitViewer(): Promise<void> {
  await invoke('renderer_exit_viewer');
}

/**
 * Render the viewer with the specified asset
 */
export async function rendererRenderViewer(assetId: number, aspectRatio: number): Promise<void> {
  await invoke('renderer_render_viewer', { assetId, aspectRatio });
}

/**
 * Update viewer pan offset
 */
export async function rendererUpdateViewerPan(deltaX: number, deltaY: number): Promise<void> {
  await invoke('renderer_update_viewer_pan', { deltaX, deltaY });
}

/**
 * Update viewer zoom
 */
export async function rendererUpdateViewerZoom(delta: number): Promise<void> {
  await invoke('renderer_update_viewer_zoom', { delta });
}
