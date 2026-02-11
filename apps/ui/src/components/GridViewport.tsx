import { Component, createSignal, onMount, onCleanup, createEffect, For } from 'solid-js';
import { calculateVisibleTiles, calculateContentHeight } from '../lib/viewport';
import { WebGPURenderer, type TileInstance } from '../lib/webgpu-renderer';
import { getThumbnailUrl } from '../lib/asset-urls';
import type { Asset } from '../lib/database';
import './GridViewport.css';

type ViewMode = 'grid' | 'viewer';

interface GridViewportProps {
  assets: Asset[];
  totalItems: number;
  tileSize: number;
  selectedAssets: number[];
  onSelectionChange: (selectedIds: number[]) => void;
}

const GridViewport: Component<GridViewportProps> = (props) => {
  let containerRef: HTMLDivElement | undefined;
  let scrollerRef: HTMLDivElement | undefined;
  let canvasRef: HTMLCanvasElement | undefined;
  let renderer: WebGPURenderer | null = null;

  const [viewportWidth, setViewportWidth] = createSignal(0);
  const [viewportHeight, setViewportHeight] = createSignal(0);
  const [scrollTop, setScrollTop] = createSignal(0);
  const [scrollLeft, setScrollLeft] = createSignal(0);
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

  const gutter = 8; // Gap between tiles
  let rafId: number | null = null;
  let pendingUpdate = false;
  let loadingInProgress = false;

  // Map asset ID to texture index
  const assetTextureMap = new Map<number, number>();

  // Calculate content height for scrolling
  const contentHeight = () => calculateContentHeight(
    props.totalItems,
    props.tileSize,
    gutter,
    viewportWidth()
  );

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
          gutter,
          viewportWidth: viewportWidth(),
          viewportHeight: viewportHeight(),
          scrollTop: scrollTop(),
          scrollLeft: scrollLeft(),
        });

        setVisibleTileCount(tiles.length);
        setVisibleTiles(tiles); // Store for label overlay

        // Convert to TileInstance with texture indices
        const tileInstances: TileInstance[] = tiles.map(t => {
          const asset = props.assets[t.id];
          let textureIndex = -1;
          let r = 0.2, g = 0.2, b = 0.2, a = 1.0; // Default gray

          if (asset && asset.id) {
            textureIndex = assetTextureMap.get(asset.id) ?? -1;

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
            x: t.x,
            y: t.y,
            w: t.w,
            h: t.h,
            textureIndex,
            r,
            g,
            b,
            a,
          };
        });

        renderer!.updateTiles(tileInstances);
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

  // Handle scroll events
  const handleScroll = () => {
    if (!scrollerRef) return;
    setScrollTop(scrollerRef.scrollTop);
    setScrollLeft(scrollerRef.scrollLeft);
    scheduleUpdate();
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

  // Convert screen coordinates to tile ID
  const screenToTileId = (clientX: number, clientY: number): number | null => {
    if (!containerRef || !scrollerRef) return null;

    const rect = containerRef.getBoundingClientRect();
    const x = clientX - rect.left + scrollLeft();
    const y = clientY - rect.top + scrollTop();

    const tileSizeWithGutter = props.tileSize + gutter;
    const cols = Math.floor(viewportWidth() / tileSizeWithGutter);

    if (cols === 0) return null;

    const col = Math.floor(x / tileSizeWithGutter);
    const row = Math.floor(y / tileSizeWithGutter);

    if (col < 0 || col >= cols) return null;

    const tileId = row * cols + col;

    if (tileId < 0 || tileId >= props.totalItems) return null;

    return tileId;
  };

  // Handle tile clicks for selection
  const handleClick = (e: MouseEvent) => {
    if (viewMode() !== 'grid') return;

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

    const textureIndex = assetTextureMap.get(asset.id) ?? -1;
    if (textureIndex < 0) {
      console.warn('Texture not loaded for asset:', asset.id);
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

  // Handle keyboard events
  const handleKeyDown = (e: KeyboardEvent) => {
    if (viewMode() === 'grid') {
      if (e.key === 'Enter' && props.selectedAssets.length > 0) {
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
    const _ = props.totalItems + props.tileSize;
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
              const textureIndex = await renderer!.loadTexture(thumbnailUrl);

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
              <span style="color: #4a90e2;">
                Loading textures: {texturesLoaded()} / {props.totalItems}
              </span>
            )}
            <span>Viewport: {viewportWidth().toFixed(0)}x{viewportHeight().toFixed(0)} @ {dpr().toFixed(2)}x</span>
            {props.selectedAssets.length > 0 && (
              <span style="color: #4a90e2;">
                {props.selectedAssets.length} selected • Press Enter to view
              </span>
            )}
          </div>

          <div class="grid-scroller" ref={scrollerRef} onScroll={handleScroll}>
            <div class="grid-content" style={{ height: `${contentHeight()}px` }} onClick={handleClick}>
              <canvas id="gpu-grid-canvas" ref={canvasRef} />

              {/* Filename labels overlay */}
              <div class="tile-labels-overlay">
                <For each={visibleTiles()}>
                  {(tile) => {
                    const asset = props.assets[tile.id];
                    if (!asset) return null;

                    // Position label below the tile
                    const labelTop = tile.y + tile.h + 2;
                    const labelLeft = tile.x;
                    const labelWidth = tile.w;

                    return (
                      <div
                        class="tile-label"
                        style={{
                          top: `${labelTop}px`,
                          left: `${labelLeft}px`,
                          width: `${labelWidth}px`,
                        }}
                        title={asset.filename}
                      >
                        {asset.filename}
                      </div>
                    );
                  }}
                </For>
              </div>
            </div>
          </div>
        </>
      ) : (
        <>
          <div class="grid-viewport-info" style="background: #1a1a1a;">
            <span style="color: #4a90e2;">
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
              {viewerIndex() === 0 && <span style="color: #666;"> (First)</span>}
              {viewerIndex() === props.totalItems - 1 && <span style="color: #666;"> (Last)</span>}
            </span>
            <span style="color: #4a90e2;">Zoom: {(viewerZoom() * 100).toFixed(0)}%</span>
            <span style="color: #888;">← → navigate • Double-click zoom • Wheel • Drag • PgUp/PgDn • Home/End • Esc</span>
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
