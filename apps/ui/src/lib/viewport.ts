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
  columnsOverride?: number; // 0 or undefined = auto, 1-20 = fixed
}

/** Grid padding: inset from top-left in logical pixels */
export const GRID_PADDING = 32;

/**
 * Calculate which tiles are visible in the viewport with pan/zoom support
 */
export function calculateVisibleTiles(config: GridConfig): TileRect[] {
  const { totalItems, tileSize, gutter, viewportWidth, viewportHeight, zoom, panX, panY, dpr } = config;

  const effectiveTileWidth = (tileSize + gutter) * dpr;
  const effectiveTileHeight = (tileSize + gutter) * dpr;
  const cols = config.columnsOverride && config.columnsOverride > 0
    ? config.columnsOverride
    : Math.max(1, Math.floor((viewportWidth * dpr + gutter * dpr) / effectiveTileWidth));
  const paddingPx = GRID_PADDING * dpr;

  // Add margin for smooth panning (preload tiles just outside viewport)
  const margin = effectiveTileWidth * 2;

  // Calculate world-space viewport bounds
  const viewportWorldLeft = (0 - panX - margin) / zoom;
  const viewportWorldTop = (0 - panY - margin) / zoom;
  const viewportWorldRight = (viewportWidth * dpr - panX + margin) / zoom;
  const viewportWorldBottom = (viewportHeight * dpr - panY + margin) / zoom;

  // Subtract grid padding to convert to grid-local coordinates for row/col lookup
  const gridWorldLeft = viewportWorldLeft - paddingPx;
  const gridWorldTop = viewportWorldTop - paddingPx;
  const gridWorldRight = viewportWorldRight - paddingPx;
  const gridWorldBottom = viewportWorldBottom - paddingPx;

  // Calculate visible row/column range
  const startRow = Math.max(0, Math.floor(gridWorldTop / effectiveTileHeight));
  const endRow = Math.ceil(gridWorldBottom / effectiveTileHeight);
  const startCol = Math.max(0, Math.floor(gridWorldLeft / effectiveTileWidth));
  const endCol = Math.min(cols, Math.ceil(gridWorldRight / effectiveTileWidth));

  const visibleTiles: TileRect[] = [];

  for (let row = startRow; row <= endRow; row++) {
    for (let col = startCol; col < endCol; col++) {
      const id = row * cols + col;

      if (id >= totalItems) break;

      // World-space position with padding offset (GPU will transform)
      const worldX = col * effectiveTileWidth + paddingPx;
      const worldY = row * effectiveTileHeight + paddingPx;

      visibleTiles.push({
        id,
        x: worldX / dpr, // Convert to logical pixels
        y: worldY / dpr,
        w: tileSize,
        h: Math.round(tileSize * 0.75), // 4:3 aspect ratio
      });
    }
  }

  return visibleTiles;
}
