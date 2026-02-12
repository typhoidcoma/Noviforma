import { Component, createSignal, onMount, onCleanup, createEffect, on, For, Show } from 'solid-js';
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
  columns?: number;
  selectedAssets: number[];
  onSelectionChange: (selectedIds: number[]) => void;
  resetTrigger?: number;
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

  // Momentum state
  const [gridVelocityX, setGridVelocityX] = createSignal(0);
  const [gridVelocityY, setGridVelocityY] = createSignal(0);
  const [isMomentumActive, setIsMomentumActive] = createSignal(false);

  // Lasso selection state
  const [isLassoActive, setIsLassoActive] = createSignal(false);
  const [lassoStart, setLassoStart] = createSignal({ x: 0, y: 0 });
  const [lassoCurrent, setLassoCurrent] = createSignal({ x: 0, y: 0 });
  let mouseDownPos = { x: 0, y: 0 };
  let mouseDownButton = -1;
  let didDrag = false;
  let lassoPreviewSet = new Set<number>();

  // Velocity tracking for momentum
  let lastPanTime = 0;
  let lastPanX = 0;
  let lastPanY = 0;
  let velocitySamples: Array<{vx: number, vy: number, time: number}> = [];
  let momentumRafId: number | null = null;

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
          columnsOverride: props.columns,
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
          let r = 0.102, g = 0.133, b = 0.157, a = 1.0; // #1a2228

          if (asset && asset.id) {
            textureIndex = assetTextureMap.get(asset.id) ?? -1;

            // Check for high-res texture when zoomed in
            if (needsHires && asset.thumbnail_path) {
              const hiresSlot = renderer!.getHiresTextureSlot(asset.id);
              if (hiresSlot >= 0) {
                // Encode as high-res using dynamic offset
                const hiresOffset = renderer!.getTextureArraySize();
                textureIndex = hiresSlot + hiresOffset;
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
              // Fixed orange color #E05839 = RGB(224, 88, 57) normalized to [0, 1]
              r = 224 / 255;  // 0.878
              g = 88 / 255;   // 0.345
              b = 57 / 255;   // 0.224
            }
          }

          // Tint lasso preview tiles (subtle brighten during drag)
          const isLassoPreview = lassoPreviewSet.has(t.id);
          if (isLassoPreview) {
            r *= 1.15; g *= 1.15; b *= 1.15;
          }

          // Render thumbnails slightly larger than the grid cell (bleed)
          const bleed = 2 * dpr();
          return {
            x: t.x * dpr() - bleed,
            y: t.y * dpr() - bleed,
            w: t.w * dpr() + 2 * bleed,
            h: t.h * dpr() + 2 * bleed,
            textureIndex,
            r,
            g,
            b,
            a,
          };
        });

        // Build rounded-corner selection backgrounds (rendered BEHIND tiles)
        const borderWidth = 3 * dpr();
        const selectionBgs: TileInstance[] = [];

        for (const t of tiles) {
          const isSelected = props.selectedAssets.includes(t.id);
          const isLassoPreview = lassoPreviewSet.has(t.id);

          if (isSelected) {
            // Solid teal background behind selected tiles
            selectionBgs.push({
              x: t.x * dpr() - borderWidth,
              y: t.y * dpr() - borderWidth,
              w: t.w * dpr() + 2 * borderWidth,
              h: t.h * dpr() + 2 * borderWidth,
              textureIndex: -1,
              r: 1.0, g: 1.0, b: 1.0, a: 0.8, // Teal #E2FEFD
            });
          } else if (isLassoPreview) {
            // Translucent teal background for lasso preview
            selectionBgs.push({
              x: t.x * dpr() - borderWidth,
              y: t.y * dpr() - borderWidth,
              w: t.w * dpr() + 2 * borderWidth,
              h: t.h * dpr() + 2 * borderWidth,
              textureIndex: -1,
              r: 0.35, g: 0.71, b: 0.78, a: 0.5,
            });
          }
        }

        // Backgrounds first (behind), then tiles on top
        renderer!.updateTiles([...selectionBgs, ...tileInstances]);
      }

      // Render frame
      renderer!.render();
    });
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
    const worldX = (screenX - gridPanX()) / gridZoom();
    const worldY = (screenY - gridPanY()) / gridZoom();

    // Check each visible tile to see if mouse is inside its bounds
    // This approach works correctly with any column configuration (auto or fixed)
    const tiles = visibleTiles();
    const paddingScaled = GRID_PADDING * dpr();

    for (const tile of tiles) {
      const tileWorldX = tile.x * dpr() + paddingScaled;
      const tileWorldY = tile.y * dpr() + paddingScaled;
      const tileWorldW = tile.w * dpr();
      const tileWorldH = tile.h * dpr();

      // Check if world coordinates are inside this tile
      if (worldX >= tileWorldX && worldX < tileWorldX + tileWorldW &&
          worldY >= tileWorldY && worldY < tileWorldY + tileWorldH) {
        return tile.id;
      }
    }

    return null;
  };

  // Handle tile clicks for selection
  const handleClick = (e: MouseEvent) => {
    if (viewMode() !== 'grid') return;
    // Ignore clicks that were part of a drag operation (lasso already handled selection)
    if (didDrag) return;

    const tileId = screenToTileId(e.clientX, e.clientY);

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

  // Find all tiles that intersect the lasso rectangle
  const tilesInLassoRect = (): number[] => {
    if (!containerRef) return [];
    const rect = containerRef.getBoundingClientRect();

    const s = lassoStart(), c = lassoCurrent();
    const minSX = Math.min(s.x, c.x) - rect.left;
    const maxSX = Math.max(s.x, c.x) - rect.left;
    const minSY = Math.min(s.y, c.y) - rect.top;
    const maxSY = Math.max(s.y, c.y) - rect.top;

    // Convert screen CSS pixels to world coordinates
    const toWorldX = (sx: number) => (sx * dpr() - gridPanX()) / gridZoom();
    const toWorldY = (sy: number) => (sy * dpr() - gridPanY()) / gridZoom();

    const wMinX = toWorldX(minSX);
    const wMaxX = toWorldX(maxSX);
    const wMinY = toWorldY(minSY);
    const wMaxY = toWorldY(maxSY);

    const d = dpr();
    const tileSizeWithGutter = (props.tileSize + props.gutter) * d;
    const tileSizePx = props.tileSize * d;
    const cols = props.columns && props.columns > 0
      ? props.columns
      : Math.max(1, Math.floor((viewportWidth() * d + props.gutter * d) / tileSizeWithGutter));
    const padding = GRID_PADDING * d;

    const result: number[] = [];
    for (let tileId = 0; tileId < props.totalItems; tileId++) {
      const col = tileId % cols;
      const row = Math.floor(tileId / cols);
      const tileX = col * tileSizeWithGutter + padding;
      const tileY = row * tileSizeWithGutter + padding;

      if (tileX + tileSizePx > wMinX && tileX < wMaxX &&
          tileY + tileSizePx > wMinY && tileY < wMaxY) {
        result.push(tileId);
      }
    }
    return result;
  };

  // Apply lasso selection with modifier key support
  const applyLassoSelection = (lassoTiles: number[], e: MouseEvent) => {
    if (lassoTiles.length === 0 && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      props.onSelectionChange([]);
      return;
    }
    if (e.shiftKey) {
      const combined = new Set([...props.selectedAssets, ...lassoTiles]);
      props.onSelectionChange(Array.from(combined).sort((a, b) => a - b));
    } else if (e.ctrlKey || e.metaKey) {
      const current = new Set(props.selectedAssets);
      for (const id of lassoTiles) {
        if (current.has(id)) current.delete(id); else current.add(id);
      }
      props.onSelectionChange(Array.from(current).sort((a, b) => a - b));
    } else {
      props.onSelectionChange(lassoTiles);
    }
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

    // Cancel any active momentum
    cancelMomentum();

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

  /**
   * Calculate average velocity from recent samples with exponential weighting
   */
  const calculateAverageVelocity = (): { vx: number, vy: number } => {
    if (velocitySamples.length === 0) {
      return { vx: 0, vy: 0 };
    }

    // Weight recent samples more heavily
    let totalWeight = 0;
    let weightedVx = 0;
    let weightedVy = 0;

    const now = performance.now();

    for (const sample of velocitySamples) {
      // Samples decay with age (50ms decay constant)
      const age = now - sample.time;
      const weight = Math.exp(-age / 50);

      weightedVx += sample.vx * weight;
      weightedVy += sample.vy * weight;
      totalWeight += weight;
    }

    if (totalWeight === 0) {
      return { vx: 0, vy: 0 };
    }

    return {
      vx: weightedVx / totalWeight,
      vy: weightedVy / totalWeight,
    };
  };

  /**
   * Cancel any active momentum animation
   */
  const cancelMomentum = () => {
    if (momentumRafId !== null) {
      cancelAnimationFrame(momentumRafId);
      momentumRafId = null;
    }
    setIsMomentumActive(false);
    setGridVelocityX(0);
    setGridVelocityY(0);
  };

  /**
   * Start momentum animation with current velocity
   */
  const startMomentum = () => {
    // Cancel any existing animation RAF without resetting velocity
    // (cancelMomentum() would zero the velocities we just set)
    if (momentumRafId !== null) {
      cancelAnimationFrame(momentumRafId);
      momentumRafId = null;
    }

    setIsMomentumActive(true);

    // Clamp velocity to prevent excessive momentum
    const MAX_VELOCITY = 5.0; // px/ms (5000 px/s)
    let vx = gridVelocityX();
    let vy = gridVelocityY();

    const speed = Math.sqrt(vx * vx + vy * vy);
    if (speed > MAX_VELOCITY) {
      const scale = MAX_VELOCITY / speed;
      setGridVelocityX(vx * scale);
      setGridVelocityY(vy * scale);
    }

    let lastFrameTime = performance.now();

    const momentumFrame = () => {
      const now = performance.now();
      const deltaTime = now - lastFrameTime;
      lastFrameTime = now;

      // Get current velocity
      let vx = gridVelocityX();
      let vy = gridVelocityY();

      // Apply exponential decay (frame-rate independent)
      const DECAY_FACTOR = 0.92; // Per 60fps frame
      const VELOCITY_STOP_THRESHOLD = 0.01; // px/ms (10 px/s)

      const decayFactor = Math.pow(DECAY_FACTOR, deltaTime / 16.67);
      vx *= decayFactor;
      vy *= decayFactor;

      // Calculate velocity magnitude
      const speed = Math.sqrt(vx * vx + vy * vy);

      // Stop if velocity is negligible
      if (speed < VELOCITY_STOP_THRESHOLD) {
        cancelMomentum();
        return;
      }

      // Update velocity signals
      setGridVelocityX(vx);
      setGridVelocityY(vy);

      // Apply velocity to pan position
      const displacementX = vx * deltaTime;
      const displacementY = vy * deltaTime;

      setGridPanX(gridPanX() + displacementX * dpr());
      setGridPanY(gridPanY() + displacementY * dpr());

      updateGridTransform();
      scheduleUpdate();

      // Continue animation
      momentumRafId = requestAnimationFrame(momentumFrame);
    };

    momentumRafId = requestAnimationFrame(momentumFrame);
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

  // Mouse handlers: left-drag = lasso select, middle-drag = pan
  const handleGridMouseDown = (e: MouseEvent) => {
    if (viewMode() !== 'grid') return;

    mouseDownPos = { x: e.clientX, y: e.clientY };
    mouseDownButton = e.button;
    didDrag = false;

    if (e.button === 1) {
      // Middle button → pan
      e.preventDefault();

      // Cancel any active momentum
      cancelMomentum();

      setIsGridDragging(true);
      setGridDragStart({ x: e.clientX, y: e.clientY });

      // Initialize velocity tracking
      lastPanTime = performance.now();
      lastPanX = e.clientX;
      lastPanY = e.clientY;
      velocitySamples = [];
    }
    // Left button: wait for drag threshold in mouseMove
  };

  const handleGridMouseMove = (e: MouseEvent) => {
    if (viewMode() !== 'grid') return;

    if (isGridDragging()) {
      // Middle-button pan
      const start = gridDragStart();
      const deltaX = e.clientX - start.x;
      const deltaY = e.clientY - start.y;

      setGridDragStart({ x: e.clientX, y: e.clientY });

      setGridPanX(gridPanX() + deltaX * dpr());
      setGridPanY(gridPanY() + deltaY * dpr());

      // Track velocity
      const now = performance.now();
      const dt = now - lastPanTime;

      if (dt > 0) {
        // Calculate instantaneous velocity in px/ms
        const vx = (e.clientX - lastPanX) / dt;
        const vy = (e.clientY - lastPanY) / dt;

        // Store sample
        velocitySamples.push({ vx, vy, time: now });

        // Keep only samples from last 100ms
        const cutoffTime = now - 100;
        velocitySamples = velocitySamples.filter(s => s.time > cutoffTime);

        lastPanTime = now;
        lastPanX = e.clientX;
        lastPanY = e.clientY;
      }

      updateGridTransform();
      scheduleUpdate();
    } else if (isLassoActive()) {
      // Update lasso rectangle and compute live preview
      setLassoCurrent({ x: e.clientX, y: e.clientY });
      lassoPreviewSet = new Set(tilesInLassoRect());
      scheduleUpdate();
    } else if (mouseDownButton === 0) {
      // Left button held — check drag threshold
      const dx = e.clientX - mouseDownPos.x;
      const dy = e.clientY - mouseDownPos.y;
      if (Math.abs(dx) + Math.abs(dy) >= 5) {
        // Cancel momentum when starting lasso
        if (isMomentumActive()) {
          cancelMomentum();
        }

        didDrag = true;
        setIsLassoActive(true);
        setLassoStart({ x: mouseDownPos.x, y: mouseDownPos.y });
        setLassoCurrent({ x: e.clientX, y: e.clientY });
      }
    }
  };

  const handleGridMouseUp = (e: MouseEvent) => {
    if (viewMode() !== 'grid') return;

    if (isGridDragging()) {
      setIsGridDragging(false);

      // Calculate final velocity and start momentum
      const finalVelocity = calculateAverageVelocity();

      // Only apply momentum if velocity is significant
      const velocityMagnitude = Math.sqrt(finalVelocity.vx ** 2 + finalVelocity.vy ** 2);
      const MIN_VELOCITY_THRESHOLD = 0.1; // px/ms (100 px/s)

      if (velocityMagnitude > MIN_VELOCITY_THRESHOLD) {
        setGridVelocityX(finalVelocity.vx);
        setGridVelocityY(finalVelocity.vy);
        startMomentum();
      } else {
        // Velocity too low, don't apply momentum
        setGridVelocityX(0);
        setGridVelocityY(0);
      }

      // Clear velocity tracking
      velocitySamples = [];
    }

    if (isLassoActive()) {
      const selected = tilesInLassoRect();
      applyLassoSelection(selected, e);
      setIsLassoActive(false);
      lassoPreviewSet = new Set();
      scheduleUpdate();
    }

    // Reset drag flag after click event has had a chance to check it
    // (mouseup fires before click in the event cycle)
    if (didDrag) {
      setTimeout(() => { didDrag = false; }, 0);
    }
    mouseDownButton = -1;
  };

  const handleGridMouseLeave = () => {
    if (viewMode() !== 'grid') return;

    // If dragging when mouse leaves, calculate momentum
    if (isGridDragging()) {
      setIsGridDragging(false);

      const finalVelocity = calculateAverageVelocity();
      const velocityMagnitude = Math.sqrt(finalVelocity.vx ** 2 + finalVelocity.vy ** 2);
      const MIN_VELOCITY_THRESHOLD = 0.1;

      if (velocityMagnitude > MIN_VELOCITY_THRESHOLD) {
        setGridVelocityX(finalVelocity.vx);
        setGridVelocityY(finalVelocity.vy);
        startMomentum();
      }

      velocitySamples = [];
    }

    if (isLassoActive()) {
      setIsLassoActive(false);
      lassoPreviewSet = new Set();
      scheduleUpdate();
    }
    mouseDownButton = -1;
  };

  // Reset grid view to fit all tiles in viewport
  const resetGridView = () => {
    if (!renderer) return;

    // Calculate grid bounds in device pixels
    const tileSizeWithGutter = (props.tileSize + props.gutter) * dpr();
    const cols = Math.max(1, Math.floor((viewportWidth() * dpr() + props.gutter * dpr()) / tileSizeWithGutter));

    // Limit to a reasonable number of rows for comfortable viewing
    // Instead of fitting ALL items (which could be thousands), fit ~3-5 screens worth
    const maxRowsToFit = Math.ceil(viewportHeight() * dpr() / tileSizeWithGutter) * 3;
    const actualRows = Math.ceil(props.totalItems / cols);
    const rows = Math.min(actualRows, maxRowsToFit);

    const gridWidth = cols * tileSizeWithGutter - props.gutter * dpr() + GRID_PADDING * 2 * dpr();
    const gridHeight = rows * tileSizeWithGutter - props.gutter * dpr() + GRID_PADDING * 2 * dpr();

    // Calculate zoom to fit
    const zoomX = (viewportWidth() * dpr()) / gridWidth;
    const zoomY = (viewportHeight() * dpr()) / gridHeight;
    const fitZoom = Math.min(zoomX, zoomY, 1.0); // Don't zoom in past 1:1

    // Set a minimum zoom to prevent zooming out too far on large libraries
    const finalZoom = Math.max(fitZoom, 0.15);

    // Position grid 12px from top-left corner (in device pixels)
    const offsetPx = 12 * dpr();
    const panX = offsetPx;
    const panY = offsetPx;

    setGridZoom(finalZoom);
    setGridPanX(panX);
    setGridPanY(panY);

    updateGridTransform();
    scheduleUpdate();
  };

  // Focus on selected tiles — zoom/pan so the selection bounding box fills the viewport
  const focusOnSelection = () => {
    if (!renderer || props.selectedAssets.length === 0) return;

    // Calculate grid layout (must match calculateVisibleTiles logic)
    const tileSizeWithGutter = (props.tileSize + props.gutter) * dpr();
    const cols = props.columns && props.columns > 0
      ? props.columns
      : Math.max(1, Math.floor((viewportWidth() * dpr() + props.gutter * dpr()) / tileSizeWithGutter));
    const paddingPx = GRID_PADDING * dpr();
    const tileSizePx = props.tileSize * dpr();

    // Compute bounding box of all selected tiles in world space
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    for (const tileId of props.selectedAssets) {
      if (tileId < 0 || tileId >= props.totalItems) continue;

      const col = tileId % cols;
      const row = Math.floor(tileId / cols);

      const worldX = col * tileSizeWithGutter + paddingPx;
      const worldY = row * tileSizeWithGutter + paddingPx;

      minX = Math.min(minX, worldX);
      minY = Math.min(minY, worldY);
      maxX = Math.max(maxX, worldX + tileSizePx);
      maxY = Math.max(maxY, worldY + tileSizePx);
    }

    if (!isFinite(minX)) return;

    const selectionWidth = maxX - minX;
    const selectionHeight = maxY - minY;
    const selectionCenterX = (minX + maxX) / 2;
    const selectionCenterY = (minY + maxY) / 2;

    // Viewport size in device pixels
    const vpW = viewportWidth() * dpr();
    const vpH = viewportHeight() * dpr();

    // Add some padding around the selection (5% on each side)
    const padding = 0.05;
    const zoomX = vpW / (selectionWidth * (1 + 2 * padding));
    const zoomY = vpH / (selectionHeight * (1 + 2 * padding));
    const focusZoom = Math.min(zoomX, zoomY);

    // Forward transform: screen = world * zoom + pan
    // Center selection in viewport: pan = viewportCenter - selectionCenter * zoom
    const newPanX = vpW / 2 - selectionCenterX * focusZoom;
    const newPanY = vpH / 2 - selectionCenterY * focusZoom;

    cancelMomentum();
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
        focusOnSelection();
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

          // Cleanup momentum RAF
          if (momentumRafId) cancelAnimationFrame(momentumRafId);
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

  // React to external reset trigger (explicit tracking to avoid resetGridView's signal reads)
  createEffect(on(() => props.resetTrigger, (trigger) => {
    if (trigger && trigger > 0) {
      resetGridView();
    }
  }));

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
          <div class="grid-viewport-info">
            <span>Visible: {visibleTileCount()} tiles</span>
            <span>Total: {props.totalItems.toLocaleString()} items</span>
            {loadingTextures() && (
              <span style="color: #E2FEFD;">
                Loading textures: {texturesLoaded()} / {props.totalItems}
              </span>
            )}
            <span style="color: #E2FEFD;">
              Zoom: {(gridZoom() * 100).toFixed(0)}%
            </span>
            <span>Viewport: {viewportWidth().toFixed(0)}x{viewportHeight().toFixed(0)} @ {dpr().toFixed(2)}x</span>
            {props.selectedAssets.length > 0 && (
              <span style="color: #E2FEFD;">
                {props.selectedAssets.length} selected
              </span>
            )}
            <span style="color: #8a8e7a;">
              Drag select • Middle pan • Wheel zoom • +/- • 0 reset • F focus
            </span>
          </div>

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
            class={`grid-content ${isGridDragging() ? 'dragging' : ''} ${isLassoActive() ? 'lasso-active' : ''}`}
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

            {/* Lasso selection rectangle */}
            <Show when={isLassoActive()}>
              {(() => {
                const rect = containerRef?.getBoundingClientRect();
                if (!rect) return null;
                const s = lassoStart(), c = lassoCurrent();
                const left = Math.min(s.x, c.x) - rect.left;
                const top = Math.min(s.y, c.y) - rect.top;
                const width = Math.abs(c.x - s.x);
                const height = Math.abs(c.y - s.y);
                return (
                  <div class="lasso-rect" style={{
                    left: `${left}px`,
                    top: `${top}px`,
                    width: `${width}px`,
                    height: `${height}px`,
                  }} />
                );
              })()}
            </Show>
          </div>
        </>
      ) : (
        <>
          <div class="grid-viewport-info" style="background: #1a2228;">
            <span style="color: #E2FEFD;">
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
            <span style="color: #E2FEFD;">Zoom: {(viewerZoom() * 100).toFixed(0)}%</span>
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
