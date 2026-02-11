/**
 * Viewport utilities for calculating visible tiles in a grid layout with pan/zoom
 */

export interface TileRect {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface GridConfig {
  totalItems: number;
  tileSize: number;
  gutter: number;
  viewportWidth: number;
  viewportHeight: number;
  zoom: number;
  panX: number;
  panY: number;
  dpr: number;
}

/**
 * Calculate which tiles are visible in the viewport with pan/zoom support
 */
export function calculateVisibleTiles(config: GridConfig): TileRect[] {
  const { totalItems, tileSize, gutter, viewportWidth, viewportHeight, zoom, panX, panY, dpr } = config;

  const effectiveTileWidth = (tileSize + gutter) * dpr;
  const effectiveTileHeight = (tileSize + gutter) * dpr;
  const cols = Math.max(1, Math.floor((viewportWidth * dpr + gutter * dpr) / effectiveTileWidth));

  // Add margin for smooth panning (preload tiles just outside viewport)
  const margin = effectiveTileWidth * 2;

  // Calculate world-space viewport bounds
  const viewportWorldLeft = (0 - panX - margin) / zoom;
  const viewportWorldTop = (0 - panY - margin) / zoom;
  const viewportWorldRight = (viewportWidth * dpr - panX + margin) / zoom;
  const viewportWorldBottom = (viewportHeight * dpr - panY + margin) / zoom;

  // Calculate visible row/column range
  const startRow = Math.max(0, Math.floor(viewportWorldTop / effectiveTileHeight));
  const endRow = Math.ceil(viewportWorldBottom / effectiveTileHeight);
  const startCol = Math.max(0, Math.floor(viewportWorldLeft / effectiveTileWidth));
  const endCol = Math.min(cols, Math.ceil(viewportWorldRight / effectiveTileWidth));

  const visibleTiles: TileRect[] = [];

  for (let row = startRow; row <= endRow; row++) {
    for (let col = startCol; col < endCol; col++) {
      const id = row * cols + col;

      if (id >= totalItems) break;

      // World-space position (GPU will transform)
      const worldX = col * effectiveTileWidth;
      const worldY = row * effectiveTileHeight;

      visibleTiles.push({
        id,
        x: worldX / dpr, // Convert to logical pixels
        y: worldY / dpr,
        w: tileSize,
        h: tileSize,
      });
    }
  }

  return visibleTiles;
}
