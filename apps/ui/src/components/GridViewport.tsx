import { Component, createSignal, onMount, onCleanup, createEffect, For } from 'solid-js';
import { calculateVisibleTiles, GRID_PADDING } from '../lib/viewport';
import { WebGPURenderer, type TileInstance } from '../lib/webgpu-renderer';
import { getThumbnailUrl } from '../lib/asset-urls';
import type { Asset } from '../lib/database';
import './GridViewport.css';

type ViewMode = 'grid' | 'viewer';

interface GridViewportProps {
  assets: Asset[];
  totalItems: number;
  tileSize: number;
  gutter: number;
  selectedAssets: number[];
  onSelectionChange: (selectedIds: number[]) => void;
}

const GridViewport: Component<GridViewportProps> = (props) => {
  let containerRef: HTMLDivElement | undefined;
  let canvasRef: HTMLCanvasElement | undefined;
  let renderer: WebGPURenderer | null = null;

  const [viewportWidth, setViewportWidth] = createSignal(0);
  const [viewportHeight, setViewportHeight] = createSignal(0);
  const [dpr, setDpr] = createSignal(window.devicePixelRatio || 1);
  const [visibleTileCount, setVisibleTileCount] = createSignal(0);
  const [texturesLoaded, setTexturesLoaded] = createSignal(0);
  const [loadingTextures, setLoadingTextures] = createSignal(false);
  const [rendererReady, setRendererReady] = createSignal(false);
  const [visibleTiles, setVisibleTiles] = createSignal<Array<{id: number, x: number, y: number, w: number, h: number}>>([]);

  // View mode state
  const [viewMode, setViewMode] = createSignal<ViewMode>('grid');
  const [viewerAssetId, setViewerAssetId] = createSignal<number | null>(null);
  const [viewerIndex, setViewerIndex] = createSignal(0);
  const [viewerZoom, setViewerZoom] = createSignal(1.0);
  const [viewerPanX, setViewerPanX] = createSignal(0);
  const [viewerPanY, setViewerPanY] = createSignal(0);
  const [isDragging, setIsDragging] = createSignal(false);
  const [dragStart, setDragStart] = createSignal({ x: 0, y: 0 });

  // Grid pan/zoom state
  const [gridZoom, setGridZoom] = createSignal(1.0);
  const [gridPanX, setGridPanX] = createSignal(0);
  const [gridPanY, setGridPanY] = createSignal(0);
  const [isGridDragging, setIsGridDragging] = createSignal(false);
  const [gridDragStart, setGridDragStart] = createSignal({ x: 0, y: 0 });

  // Tooltip state
  const [tooltipVisible, setTooltipVisible] = createSignal(false);
  const [tooltipText, setTooltipText] = createSignal('');
  const [tooltipX, setTooltipX] = createSignal(0);
  const [tooltipY, setTooltipY] = createSignal(0);
  let tooltipTimeout: number | null = null;

  let rafId: number | null = null;
  let pendingUpdate = false;
  let loadingInProgress = false;

  // Map asset ID to texture index
  const assetTextureMap = new Map<number, number>();

  // High-res texture loading with hysteresis to prevent oscillation
  const HIRES_ENTER_THRESHOLD = 400; // Switch TO hires when tile > 400px on screen
  const HIRES_LEAVE_THRESHOLD = 250; // Switch FROM hires when tile < 250px on screen
  const hiresLoadingSet = new Set<number>(); // Track in-flight hires loads
  let hiresActive = false; // Track current hires state for hysteresis

  // Update visible tiles and render (batched via RAF)
  const scheduleUpdate = () => {
    if (pendingUpdate || !renderer || !rendererReady()) return;
    pendingUpdate = true;

    rafId = requestAnimationFrame(() => {
      pendingUpdate = false;

      if (viewMode() === 'grid') {
        const tiles = calculateVisibleTiles({
          totalItems: props.totalItems,
          tileSize: props.tileSize,
          gutter: props.gutter,
          viewportWidth: viewportWidth(),
          viewportHeight: viewportHeight(),
          zoom: gridZoom(),
          panX: gridPanX(),
          panY: gridPanY(),
          dpr: dpr(),
        });

        setVisibleTileCount(tiles.length);
        setVisibleTiles(tiles); // Store for label overlay

        // Mark visible textures as recently used (prevents eviction)
        const visibleAssetIds = tiles
          .map(t => props.assets[t.id]?.id)
          .filter((id): id is number => id !== undefined);
        renderer!.markVisibleTextures(visibleAssetIds);

        // Check if we need high-res textures based on zoom level (with hysteresis)
        const tileScreenSize = props.tileSize * gridZoom() * dpr();
        if (hiresActive) {
          hiresActive = tileScreenSize > HIRES_LEAVE_THRESHOLD;
        } else {
          hiresActive = tileScreenSize > HIRES_ENTER_THRESHOLD;
        }
        const needsHires = hiresActive;

        if (needsHires) {
          renderer!.markVisibleHiresTextures(visibleAssetIds);
        }

        // Convert to TileInstance with texture indices
        const tileInstances: TileInstance[] = tiles.map(t => {
          const asset = props.assets[t.id];
          let textureIndex = -1;
          let r = 0.2, g = 0.2, b = 0.2, a = 1.0; // Default gray

          if (asset && asset.id) {
            textureIndex = assetTextureMap.get(asset.id) ?? -1;

            // Check for high-res texture when zoomed in
            if (needsHires && asset.thumbnail_path) {
              const hiresSlot = renderer!.getHiresTextureSlot(asset.id);
              if (hiresSlot >= 0) {
                textureIndex = hiresSlot + 256; // Encode as high-res
              } else if (!hiresLoadingSet.has(asset.id)) {
                // Load from 1024px thumbnail cache (much faster than full original)
                hiresLoadingSet.add(asset.id);
                const thumbUrl = getThumbnailUrl(asset.thumbnail_path);
                renderer!.loadHiresTexture(asset.id, thumbUrl).then(slot => {
                  hiresLoadingSet.delete(asset.id);
                  if (slot >= 0) {
                    scheduleUpdate(); // Re-render with hires texture
                  }
                });
              }
              // Fall through to use low-res until hires loads
            }

            // If texture loaded, use white tint; otherwise use fallback color
            if (textureIndex >= 0) {
              r = 1.0; g = 1.0; b = 1.0;
            } else {
              // Fallback: Color based on asset ID
              const hue = ((asset.id * 137.5) % 360) / 360;
              const rgb = hslToRgb(hue, 0.5, 0.3);
              r = rgb[0]; g = rgb[1]; b = rgb[2];
            }
          }

          // Brighten selected tiles
          const isSelected = props.selectedAssets.includes(t.id);
          if (isSelected) {
            r *= 1.5; g *= 1.5; b *= 1.5;
          }

          return {
            x: t.x * dpr(),
            y: t.y * dpr(),
            w: t.w * dpr(),
            h: t.h * dpr(),
            textureIndex,
            r,
            g,
            b,
            a,
          };
        });

        // Add border instances for selected tiles
        const selectedTiles = tiles.filter(t => props.selectedAssets.includes(t.id));
        if (selectedTiles.length > 0) {
          console.log('Adding borders for tiles:', selectedTiles.map(t => ({ id: t.id, x: t.x, y: t.y })));
        }

        const borderInstances: TileInstance[] = selectedTiles
          .flatMap(t => {
            const borderWidth = 3 * dpr();
            const color = { r: 0.35, g: 0.71, b: 0.78, a: 1.0 }; // Teal #5AB6C6

            return [
              // Top border
              { x: t.x * dpr(), y: t.y * dpr(), w: t.w * dpr(), h: borderWidth, textureIndex: -1, ...color },
              // Bottom border
              { x: t.x * dpr(), y: (t.y + t.h) * dpr() - borderWidth, w: t.w * dpr(), h: borderWidth, textureIndex: -1, ...color },
              // Left border
              { x: t.x * dpr(), y: t.y * dpr(), w: borderWidth, h: t.h * dpr(), textureIndex: -1, ...color },
              // Right border
              { x: (t.x + t.w) * dpr() - borderWidth, y: t.y * dpr(), w: borderWidth, h: t.h * dpr(), textureIndex: -1, ...color },
            ];
          });

        // Combine tiles and borders (borders rendered on top)
        renderer!.updateTiles([...tileInstances, ...borderInstances]);
      }

      // Render frame
      renderer!.render();
    });
  };

  // HSL to RGB conversion for fallback colors
  const hslToRgb = (h: number, s: number, l: number): [number, number, number] => {
    let r, g, b;

    if (s === 0) {
      r = g = b = l;
    } else {
      const hue2rgb = (p: number, q: number, t: number) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1/6) return p + (q - p) * 6 * t;
        if (t < 1/2) return q;
        if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
        return p;
      };

      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = hue2rgb(p, q, h + 1/3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1/3);
    }

    return [r, g, b];
  };

  // Handle resize events
  const handleResize = () => {
    if (!containerRef || !renderer) return;

    const rect = containerRef.getBoundingClientRect();
    const newWidth = rect.width;
    const newHeight = rect.height;
    const newDpr = window.devicePixelRatio || 1;

    setViewportWidth(newWidth);
    setViewportHeight(newHeight);
    setDpr(newDpr);

    renderer.resize(newWidth, newHeight, newDpr);
    scheduleUpdate();
  };

  // Convert screen coordinates to tile ID (accounting for pan/zoom)
  const screenToTileId = (clientX: number, clientY: number): number | null => {
    if (!containerRef) return null;

    const rect = containerRef.getBoundingClientRect();

    // Screen position relative to viewport
    const screenX = (clientX - rect.left) * dpr();
    const screenY = (clientY - rect.top) * dpr();

    // Inverse transform: screen -> world coordinates
    // Forward: screen = world * zoom + pan
    // Inverse: world = (screen - pan) / zoom
    const worldX = (screenX - gridPanX()) / gridZoom();
    const worldY = (screenY - gridPanY()) / gridZoom();

    const tileSizeWithGutter = (props.tileSize + props.gutter) * dpr();
    const cols = Math.max(1, Math.floor((viewportWidth() * dpr() + props.gutter * dpr()) / tileSizeWithGutter));

    if (cols === 0) return null;

    // Subtract grid padding to get grid-local coordinates
    const gridX = worldX - GRID_PADDING * dpr();
    const gridY = worldY - GRID_PADDING * dpr();

    const col = Math.floor(gridX / tileSizeWithGutter);
    const row = Math.floor(gridY / tileSizeWithGutter);

    if (col < 0 || col >= cols) return null;

    const tileId = row * cols + col;

    if (tileId < 0 || tileId >= props.totalItems) return null;

    return tileId;
  };

  // Handle tile clicks for selection
  const handleClick = (e: MouseEvent) => {
    if (viewMode() !== 'grid') return;

    const tileId = screenToTileId(e.clientX, e.clientY);
    console.log('Click detected:', {
      screenPos: { x: e.clientX, y: e.clientY },
      tileId,
      panZoom: { zoom: gridZoom(), panX: gridPanX(), panY: gridPanY() },
      viewportSize: { width: viewportWidth(), height: viewportHeight() },
    });

    if (tileId === null) return;

    let newSelection: number[];

    if (e.ctrlKey || e.metaKey) {
      // Ctrl+click: Toggle selection
      if (props.selectedAssets.includes(tileId)) {
        newSelection = props.selectedAssets.filter(id => id !== tileId);
      } else {
        newSelection = [...props.selectedAssets, tileId];
      }
    } else if (e.shiftKey && props.selectedAssets.length > 0) {
      // Shift+click: Range selection
      const lastSelected = props.selectedAssets[props.selectedAssets.length - 1];
      const start = Math.min(lastSelected, tileId);
      const end = Math.max(lastSelected, tileId);
      const range = Array.from({ length: end - start + 1 }, (_, i) => start + i);

      const selectionSet = new Set([...props.selectedAssets, ...range]);
      newSelection = Array.from(selectionSet).sort((a, b) => a - b);
    } else {
      // Regular click: Single selection
      newSelection = [tileId];
    }

    props.onSelectionChange(newSelection);
  };

  // Enter viewer mode
  const enterViewerMode = () => {
    if (props.selectedAssets.length === 0 || !renderer) return;

    const tileId = props.selectedAssets[0];
    const asset = props.assets[tileId];
    if (!asset) return;

    console.log('Entering viewer mode for asset:', asset.id, 'tile:', tileId);

    setViewMode('viewer');
    setViewerAssetId(asset.id);
    setViewerIndex(tileId);
    setViewerZoom(1.0);
    setViewerPanX(0);
    setViewerPanY(0);

    if (containerRef) {
      containerRef.style.cursor = 'grab';
    }

    renderViewer();
  };

  // Render viewer mode
  const renderViewer = () => {
    if (viewMode() !== 'viewer' || !renderer) return;

    const asset = props.assets[viewerIndex()];
    if (!asset) return;

    let textureIndex = renderer.getCurrentTextureSlot(asset.id);

    // If texture not loaded, trigger async load
    if (textureIndex < 0 && asset.thumbnail_path) {
      console.log('Loading texture for viewer:', asset.id);
      const thumbnailUrl = getThumbnailUrl(asset.thumbnail_path);

      renderer.loadTexture(asset.id, thumbnailUrl).then(idx => {
        if (idx >= 0) {
          assetTextureMap.set(asset.id, idx);
          // Re-render once loaded
          renderViewer();
        } else {
          console.error('Failed to load texture for asset', asset.id);
        }
      });

      // Don't render invalid texture, wait for load
      return;
    }

    const aspectRatio = asset.width && asset.height ? asset.width / asset.height : 1.0;

    renderer.setViewerParams({
      textureIndex,
      aspectRatio,
      scale: viewerZoom(),
      offsetX: viewerPanX() * viewportWidth() * dpr(),
      offsetY: viewerPanY() * viewportHeight() * dpr(),
    });

    renderer.render();
  };

  // Navigate to asset by index
  const navigateToAsset = (index: number) => {
    if (viewMode() !== 'viewer') return;
    if (index < 0 || index >= props.assets.length) return;

    const asset = props.assets[index];
    if (!asset) return;

    console.log('Navigating to asset:', asset.id, 'index:', index);

    setViewerAssetId(asset.id);
    setViewerIndex(index);
    setViewerZoom(1.0);
    setViewerPanX(0);
    setViewerPanY(0);

    props.onSelectionChange([index]);

    renderViewer();
  };

  // Navigate to previous/next
  const navigatePrevious = () => {
    const currentIndex = viewerIndex();
    if (currentIndex > 0) {
      navigateToAsset(currentIndex - 1);
    }
  };

  const navigateNext = () => {
    const currentIndex = viewerIndex();
    if (currentIndex < props.assets.length - 1) {
      navigateToAsset(currentIndex + 1);
    }
  };

  // Exit viewer mode
  const exitViewerMode = () => {
    console.log('Exiting viewer mode');

    setViewMode('grid');
    setViewerAssetId(null);
    setViewerZoom(1.0);
    setViewerPanX(0);
    setViewerPanY(0);

    if (containerRef) {
      containerRef.style.cursor = 'default';
    }

    // Resync texture map with current cache state
    if (renderer) {
      const needsReload: number[] = [];

      for (const [assetId, cachedIndex] of assetTextureMap) {
        const currentSlot = renderer.getCurrentTextureSlot(assetId);

        if (currentSlot >= 0) {
          // Texture still loaded, update map if slot changed
          if (currentSlot !== cachedIndex) {
            assetTextureMap.set(assetId, currentSlot);
          }
        } else {
          // Texture was evicted, remove from map
          assetTextureMap.delete(assetId);
          needsReload.push(assetId);
        }
      }

      if (needsReload.length > 0) {
        console.log(`Reloading ${needsReload.length} evicted textures after viewer exit`);
      }
    }

    scheduleUpdate();
  };

  // Handle zoom in viewer mode
  const handleViewerWheel = (e: WheelEvent) => {
    if (viewMode() !== 'viewer') return;

    e.preventDefault();

    const zoomSpeed = 0.001;
    const delta = -e.deltaY * zoomSpeed;
    const newZoom = (viewerZoom() * (1.0 + delta)).clamp(0.25, 4.0);

    setViewerZoom(newZoom);
    renderViewer();
  };

  // Handle pan start
  const handleViewerMouseDown = (e: MouseEvent) => {
    if (viewMode() !== 'viewer') return;

    setIsDragging(true);
    setDragStart({ x: e.clientX, y: e.clientY });

    if (containerRef) {
      containerRef.style.cursor = 'grabbing';
    }
  };

  // Handle pan move
  const handleViewerMouseMove = (e: MouseEvent) => {
    if (viewMode() !== 'viewer' || !isDragging()) return;

    const start = dragStart();
    const deltaX = (e.clientX - start.x) / viewportWidth();
    const deltaY = (e.clientY - start.y) / viewportHeight();

    setDragStart({ x: e.clientX, y: e.clientY });

    setViewerPanX(viewerPanX() + deltaX);
    setViewerPanY(viewerPanY() + deltaY);

    renderViewer();
  };

  // Handle pan end
  const handleViewerMouseUp = () => {
    if (viewMode() !== 'viewer') return;

    setIsDragging(false);

    if (containerRef) {
      containerRef.style.cursor = 'grab';
    }
  };

  // Handle double-click to toggle zoom
  const handleViewerDoubleClick = () => {
    if (viewMode() !== 'viewer') return;

    const currentZoom = viewerZoom();
    const targetZoom = Math.abs(currentZoom - 1.0) < 0.1 ? 2.0 : 1.0;

    setViewerZoom(targetZoom);
    renderViewer();
  };

  // Grid pan/zoom handlers

  // Update renderer with current transform
  const updateGridTransform = () => {
    if (!renderer) return;
    renderer.setGridTransform(gridZoom(), gridPanX(), gridPanY());
  };

  // Zoom handler with mouse-centered zooming
  const handleGridWheel = (e: WheelEvent) => {
    if (viewMode() !== 'grid' || !containerRef) return;

    e.preventDefault();

    // Get mouse position in viewport
    const rect = containerRef.getBoundingClientRect();
    const mouseX = (e.clientX - rect.left) * dpr();
    const mouseY = (e.clientY - rect.top) * dpr();

    // Calculate zoom delta
    const zoomSpeed = 0.001;
    const delta = -e.deltaY * zoomSpeed;
    const oldZoom = gridZoom();
    const newZoom = (oldZoom * (1.0 + delta)).clamp(0.1, 50.0);

    // Zoom-to-point: adjust pan to keep mouse position stable
    // world_pos = (screen_pos - pan) / zoom
    // We want world_pos to stay constant, so:
    // (mouseX - oldPan) / oldZoom = (mouseX - newPan) / newZoom
    // Solving for newPan:
    // newPan = mouseX - (mouseX - oldPan) * (newZoom / oldZoom)

    const zoomRatio = newZoom / oldZoom;
    const newPanX = mouseX - (mouseX - gridPanX()) * zoomRatio;
    const newPanY = mouseY - (mouseY - gridPanY()) * zoomRatio;

    setGridZoom(newZoom);
    setGridPanX(newPanX);
    setGridPanY(newPanY);

    updateGridTransform();
    scheduleUpdate();
  };

  // Pan drag handlers
  const handleGridMouseDown = (e: MouseEvent) => {
    if (viewMode() !== 'grid') return;

    setIsGridDragging(true);
    setGridDragStart({ x: e.clientX, y: e.clientY });

    // Hide tooltip while dragging
    setTooltipVisible(false);
    if (tooltipTimeout) {
      clearTimeout(tooltipTimeout);
      tooltipTimeout = null;
    }
  };

  const handleGridMouseMove = (e: MouseEvent) => {
    if (viewMode() !== 'grid') return;

    if (isGridDragging()) {
      // Pan mode
      const start = gridDragStart();
      const deltaX = e.clientX - start.x;
      const deltaY = e.clientY - start.y;

      setGridDragStart({ x: e.clientX, y: e.clientY });

      // Apply pan in physical pixels
      setGridPanX(gridPanX() + deltaX * dpr());
      setGridPanY(gridPanY() + deltaY * dpr());

      updateGridTransform();
      scheduleUpdate();
    } else {
      // Tooltip mode - show after 300ms delay
      if (tooltipTimeout) {
        clearTimeout(tooltipTimeout);
      }

      const clientX = e.clientX;
      const clientY = e.clientY;

      tooltipTimeout = window.setTimeout(() => {
        const tileId = screenToTileId(clientX, clientY);

        if (tileId !== null && tileId < props.assets.length) {
          const asset = props.assets[tileId];
          if (asset) {
            setTooltipText(asset.filename);
            setTooltipX(clientX);
            setTooltipY(clientY);
            setTooltipVisible(true);
          }
        } else {
          setTooltipVisible(false);
        }
      }, 300);
    }
  };

  const handleGridMouseUp = () => {
    if (viewMode() !== 'grid') return;
    setIsGridDragging(false);
  };

  const handleGridMouseLeave = () => {
    if (viewMode() !== 'grid') return;
    setIsGridDragging(false);
    setTooltipVisible(false);
    if (tooltipTimeout) {
      clearTimeout(tooltipTimeout);
      tooltipTimeout = null;
    }
  };

  // Reset grid view to fit all tiles in viewport
  const resetGridView = () => {
    if (!renderer) return;

    // Calculate grid bounds
    const tileSizeWithGutter = props.tileSize + props.gutter;
    const cols = Math.max(1, Math.floor((viewportWidth() + props.gutter) / tileSizeWithGutter));
    const rows = Math.ceil(props.totalItems / cols);

    const gridWidth = cols * tileSizeWithGutter - props.gutter + GRID_PADDING * 2;
    const gridHeight = rows * tileSizeWithGutter - props.gutter + GRID_PADDING * 2;

    // Calculate zoom to fit
    const zoomX = viewportWidth() / gridWidth;
    const zoomY = viewportHeight() / gridHeight;
    const fitZoom = Math.min(zoomX, zoomY, 1.0); // Don't zoom in past 1:1

    // Calculate pan to center
    const scaledWidth = gridWidth * fitZoom;
    const scaledHeight = gridHeight * fitZoom;
    const panX = (viewportWidth() - scaledWidth) / 2;
    const panY = (viewportHeight() - scaledHeight) / 2;

    setGridZoom(fitZoom);
    setGridPanX(panX * dpr());
    setGridPanY(panY * dpr());

    updateGridTransform();
    scheduleUpdate();
  };

  // Focus on the first selected tile (zoom and pan to center it)
  const focusOnSelectedTile = () => {
    if (!renderer || props.selectedAssets.length === 0) return;

    const tileId = props.selectedAssets[0];
    if (tileId < 0 || tileId >= props.totalItems) return;

    // Calculate grid layout
    const tileSizeWithGutter = (props.tileSize + props.gutter) * dpr();
    const cols = Math.max(1, Math.floor((viewportWidth() * dpr() + props.gutter * dpr()) / tileSizeWithGutter));

    // Calculate tile position in grid
    const col = tileId % cols;
    const row = Math.floor(tileId / cols);

    // Calculate world position of tile center (with grid padding offset)
    const tileWorldX = col * tileSizeWithGutter + GRID_PADDING * dpr();
    const tileWorldY = row * tileSizeWithGutter + GRID_PADDING * dpr();
    const tileCenterX = tileWorldX + (props.tileSize * dpr()) / 2;
    const tileCenterY = tileWorldY + (props.tileSize * dpr()) / 2;

    // Calculate viewport center in screen space
    const viewportCenterX = (viewportWidth() * dpr()) / 2;
    const viewportCenterY = (viewportHeight() * dpr()) / 2;

    // Zoom so the tile fills the viewport vertically
    const focusZoom = viewportHeight() / props.tileSize;

    // Calculate pan to center the tile
    // Forward: screen = world * zoom + pan
    // We want: screen = viewportCenter, world = tileCenter
    // Therefore: pan = viewportCenter - tileCenter * zoom
    const newPanX = viewportCenterX - tileCenterX * focusZoom;
    const newPanY = viewportCenterY - tileCenterY * focusZoom;

    setGridZoom(focusZoom);
    setGridPanX(newPanX);
    setGridPanY(newPanY);

    updateGridTransform();
    scheduleUpdate();
  };

  // Handle keyboard events
  const handleKeyDown = (e: KeyboardEvent) => {
    if (viewMode() === 'grid') {
      if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        setGridZoom((gridZoom() * 1.1).clamp(0.1, 50.0));
        updateGridTransform();
        scheduleUpdate();
      } else if (e.key === '-') {
        e.preventDefault();
        setGridZoom((gridZoom() / 1.1).clamp(0.1, 50.0));
        updateGridTransform();
        scheduleUpdate();
      } else if (e.key === '0') {
        e.preventDefault();
        resetGridView();
      } else if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        focusOnSelectedTile();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setGridPanY(gridPanY() + 50 * dpr());
        updateGridTransform();
        scheduleUpdate();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setGridPanY(gridPanY() - 50 * dpr());
        updateGridTransform();
        scheduleUpdate();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setGridPanX(gridPanX() + 50 * dpr());
        updateGridTransform();
        scheduleUpdate();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setGridPanX(gridPanX() - 50 * dpr());
        updateGridTransform();
        scheduleUpdate();
      } else if (e.key === 'Enter' && props.selectedAssets.length > 0) {
        e.preventDefault();
        enterViewerMode();
      } else if (e.key === 'Escape' && props.selectedAssets.length > 0) {
        e.preventDefault();
        props.onSelectionChange([]);
      }
    } else if (viewMode() === 'viewer') {
      if (e.key === 'Escape') {
        e.preventDefault();
        exitViewerMode();
      } else if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        const newZoom = (viewerZoom() * 1.1).clamp(0.25, 4.0);
        setViewerZoom(newZoom);
        renderViewer();
      } else if (e.key === '-') {
        e.preventDefault();
        const newZoom = (viewerZoom() / 1.1).clamp(0.25, 4.0);
        setViewerZoom(newZoom);
        renderViewer();
      } else if (e.key === '0') {
        e.preventDefault();
        setViewerZoom(1.0);
        setViewerPanX(0);
        setViewerPanY(0);
        renderViewer();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        navigatePrevious();
      } else if (e.key === 'ArrowRight' || e.key === ' ') {
        e.preventDefault();
        navigateNext();
      } else if (e.key === 'Home') {
        e.preventDefault();
        navigateToAsset(0);
      } else if (e.key === 'End') {
        e.preventDefault();
        navigateToAsset(props.totalItems - 1);
      } else if (e.key === 'PageUp') {
        e.preventDefault();
        navigateToAsset(Math.max(0, viewerIndex() - 10));
      } else if (e.key === 'PageDown') {
        e.preventDefault();
        navigateToAsset(Math.min(props.totalItems - 1, viewerIndex() + 10));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setViewerPanY(viewerPanY() + 0.1);
        renderViewer();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setViewerPanY(viewerPanY() - 0.1);
        renderViewer();
      }
    }
  };

  // Initialize WebGPU renderer
  onMount(async () => {
    if (!canvasRef) {
      console.error('Canvas ref not available');
      return;
    }

    try {
      console.log('Initializing WebGPU renderer...');
      renderer = new WebGPURenderer();
      await renderer.init(canvasRef);
      setRendererReady(true);
      console.log('WebGPU renderer initialized');

      // Setup resize observer
      if (containerRef) {
        const resizeObserver = new ResizeObserver(handleResize);
        resizeObserver.observe(containerRef);

        // Initial resize
        handleResize();

        // Set initial grid view (fit to viewport)
        setTimeout(() => {
          if (props.totalItems > 0) {
            resetGridView();
          }
        }, 50);

        onCleanup(() => {
          resizeObserver.disconnect();
          if (rafId) cancelAnimationFrame(rafId);
        });
      }

      // Listen for DPR changes
      const mediaQuery = window.matchMedia(`(resolution: ${dpr()}dppx)`);
      const handleDprChange = () => handleResize();
      mediaQuery.addEventListener('change', handleDprChange);

      // Listen for keyboard events
      window.addEventListener('keydown', handleKeyDown);

      // Listen for viewer interactions
      if (containerRef) {
        containerRef.addEventListener('wheel', handleViewerWheel, { passive: false });
        containerRef.addEventListener('mousedown', handleViewerMouseDown);
        containerRef.addEventListener('mousemove', handleViewerMouseMove);
        containerRef.addEventListener('mouseup', handleViewerMouseUp);
        containerRef.addEventListener('mouseleave', handleViewerMouseUp);
        containerRef.addEventListener('dblclick', handleViewerDoubleClick);
      }

      onCleanup(() => {
        mediaQuery.removeEventListener('change', handleDprChange);
        window.removeEventListener('keydown', handleKeyDown);

        if (containerRef) {
          containerRef.removeEventListener('wheel', handleViewerWheel);
          containerRef.removeEventListener('mousedown', handleViewerMouseDown);
          containerRef.removeEventListener('mousemove', handleViewerMouseMove);
          containerRef.removeEventListener('mouseup', handleViewerMouseUp);
          containerRef.removeEventListener('mouseleave', handleViewerMouseUp);
          containerRef.removeEventListener('dblclick', handleViewerDoubleClick);
        }
      });
    } catch (error) {
      console.error('Failed to initialize WebGPU:', error);
      alert(`WebGPU initialization failed: ${error}\n\nMake sure your browser supports WebGPU.`);
    }
  });

  // React to prop changes
  createEffect(() => {
    const _ = props.totalItems + props.tileSize + props.gutter;
    scheduleUpdate();
  });

  // React to selection changes
  createEffect(() => {
    const _ = props.selectedAssets.length;
    scheduleUpdate();
  });

  // Load textures when assets change
  createEffect(() => {
    const assetList = props.assets;

    if (assetList.length === 0 || loadingInProgress || !renderer || !rendererReady()) return;

    setTimeout(() => {
      if (loadingInProgress) return;

      loadingInProgress = true;
      setLoadingTextures(true);

      (async () => {
        try {
          console.log(`Loading ${assetList.length} textures...`);
          let totalLoaded = 0;

          for (const asset of assetList) {
            if (!asset.thumbnail_path) continue;

            try {
              const thumbnailUrl = getThumbnailUrl(asset.thumbnail_path);
              const textureIndex = await renderer!.loadTexture(asset.id, thumbnailUrl);

              if (textureIndex >= 0) {
                assetTextureMap.set(asset.id, textureIndex);
                totalLoaded++;
                setTexturesLoaded(totalLoaded);

                // Trigger re-render every 10 textures
                if (totalLoaded % 10 === 0) {
                  scheduleUpdate();
                }
              }
            } catch (error) {
              console.error(`Failed to load texture for asset ${asset.id}:`, error);
            }

            // Small delay to keep UI responsive
            if (totalLoaded % 50 === 0) {
              await new Promise(resolve => setTimeout(resolve, 10));
            }
          }

          console.log(`Texture loading complete: ${totalLoaded} loaded`);
          scheduleUpdate();
        } catch (error) {
          console.error('Texture loading failed:', error);
        } finally {
          setLoadingTextures(false);
          loadingInProgress = false;
        }
      })();
    }, 100);
  });

  // Clamp helper for numbers
  Number.prototype.clamp = function(min: number, max: number): number {
    return Math.min(Math.max(this.valueOf(), min), max);
  };

  return (
    <div class="grid-viewport" ref={containerRef}>
      {viewMode() === 'grid' ? (
        <>
          {props.totalItems > 0 && (
            <div class="grid-viewport-info">
              <span>Visible: {visibleTileCount()} tiles</span>
              <span>Total: {props.totalItems.toLocaleString()} items</span>
              {loadingTextures() && (
                <span style="color: #5AB6C6;">
                  Loading textures: {texturesLoaded()} / {props.totalItems}
                </span>
              )}
              <span style="color: #5AB6C6;">
                Zoom: {(gridZoom() * 100).toFixed(0)}%
              </span>
              <span>Viewport: {viewportWidth().toFixed(0)}x{viewportHeight().toFixed(0)} @ {dpr().toFixed(2)}x</span>
              {props.selectedAssets.length > 0 && (
                <span style="color: #5AB6C6;">
                  {props.selectedAssets.length} selected • Press Enter to view
                </span>
              )}
              <span style="color: #8a8e7a;">
                Wheel zoom • Drag pan • +/- • Arrows • 0 reset • F focus
              </span>
            </div>
          )}

          {props.totalItems === 0 && (
            <div class="grid-empty-state">
              <div class="grid-empty-icon">&#9634;</div>
              <div class="grid-empty-title">No assets loaded</div>
              <div class="grid-empty-hint">
                Scan a folder from the project panel to get started
              </div>
            </div>
          )}

          <div
            class={`grid-content ${isGridDragging() ? 'dragging' : ''}`}
            onClick={handleClick}
            onMouseDown={handleGridMouseDown}
            onMouseMove={handleGridMouseMove}
            onMouseUp={handleGridMouseUp}
            onMouseLeave={handleGridMouseLeave}
            onWheel={handleGridWheel}
          >
            {/* WebGPU canvas for tiles */}
            <canvas
              id="gpu-grid-canvas"
              ref={canvasRef}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                'pointer-events': 'none',
                'z-index': 1
              }}
            />

            {/* Tooltip overlay */}
            <div
              style={{
                position: 'absolute',
                padding: '6px 10px',
                background: 'rgba(0, 0, 0, 0.9)',
                color: '#E2FEFD',
                'border-radius': '4px',
                'font-size': '12px',
                'pointer-events': 'none',
                'white-space': 'nowrap',
                'z-index': 3,
                display: tooltipVisible() ? 'block' : 'none',
                left: `${tooltipX()}px`,
                top: `${tooltipY()}px`,
                transform: 'translate(10px, 10px)'
              }}
            >
              {tooltipText()}
            </div>
          </div>
        </>
      ) : (
        <>
          <div class="grid-viewport-info" style="background: #1a2228;">
            <span style="color: #5AB6C6;">
              {(() => {
                const asset = props.assets[viewerIndex()];
                return asset?.filename || 'Unknown';
              })()}
            </span>
            <span>
              {(() => {
                const asset = props.assets[viewerIndex()];
                if (asset?.width && asset?.height) {
                  return `${asset.width} × ${asset.height}`;
                }
                return '';
              })()}
            </span>
            <span>
              Image {viewerIndex() + 1} / {props.totalItems}
              {viewerIndex() === 0 && <span style="color: #6a7060;"> (First)</span>}
              {viewerIndex() === props.totalItems - 1 && <span style="color: #6a7060;"> (Last)</span>}
            </span>
            <span style="color: #5AB6C6;">Zoom: {(viewerZoom() * 100).toFixed(0)}%</span>
            <span style="color: #8a8e7a;">← → navigate • Double-click zoom • Wheel • Drag • PgUp/PgDn • Home/End • Esc</span>
          </div>

          <div class="viewer-container">
            <canvas id="gpu-grid-canvas" ref={canvasRef} />
          </div>
        </>
      )}
    </div>
  );
};

// TypeScript extension for Number.prototype.clamp
declare global {
  interface Number {
    clamp(min: number, max: number): number;
  }
}

export default GridViewport;
