/**
 * Tauri IPC wrapper for renderer commands
 */

import { invoke } from '@tauri-apps/api/tauri';

export interface TileData {
  id: number;
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
