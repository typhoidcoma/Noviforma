/**
 * Viewport utilities for calculating visible tiles in a grid layout
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
  scrollTop: number;
  scrollLeft: number;
}

/**
 * Calculate which tiles are visible in the viewport
 * Uses a simple grid layout with fixed-size tiles
 */
export function calculateVisibleTiles(config: GridConfig): TileRect[] {
  const { totalItems, tileSize, gutter, viewportWidth, viewportHeight, scrollTop, scrollLeft } = config;

  // Calculate how many columns fit in the viewport
  const effectiveTileWidth = tileSize + gutter;
  const cols = Math.max(1, Math.floor((viewportWidth + gutter) / effectiveTileWidth));

  // Calculate row range that's visible
  const effectiveTileHeight = tileSize + gutter;
  const startRow = Math.floor(scrollTop / effectiveTileHeight);
  const endRow = Math.ceil((scrollTop + viewportHeight) / effectiveTileHeight);

  // Calculate column range that's visible
  const startCol = Math.floor(scrollLeft / effectiveTileWidth);
  const endCol = Math.min(cols, Math.ceil((scrollLeft + viewportWidth) / effectiveTileWidth));

  const visibleTiles: TileRect[] = [];

  // Generate tiles for visible rows and columns
  for (let row = startRow; row <= endRow; row++) {
    for (let col = startCol; col < endCol; col++) {
      const id = row * cols + col;

      // Don't exceed total items
      if (id >= totalItems) break;

      const x = col * effectiveTileWidth;
      const y = row * effectiveTileHeight;

      visibleTiles.push({
        id,
        x: x - scrollLeft,
        y: y - scrollTop,
        w: tileSize,
        h: tileSize,
      });
    }
  }

  return visibleTiles;
}

/**
 * Calculate total content height for scrolling
 */
export function calculateContentHeight(totalItems: number, tileSize: number, gutter: number, viewportWidth: number): number {
  if (totalItems === 0) return 0;

  const effectiveTileWidth = tileSize + gutter;
  const cols = Math.max(1, Math.floor((viewportWidth + gutter) / effectiveTileWidth));
  const rows = Math.ceil(totalItems / cols);
  const effectiveTileHeight = tileSize + gutter;

  // Account for tile labels below each tile (approx 25px for label height + 2px gap)
  const labelHeight = 27;

  // Last row doesn't need trailing gutter, so: (rows - 1) * effectiveTileHeight + tileSize + labelHeight
  return (rows - 1) * effectiveTileHeight + tileSize + labelHeight;
}
