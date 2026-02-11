import { Component, createSignal, onMount, onCleanup, createEffect } from 'solid-js';
import { calculateVisibleTiles, calculateContentHeight } from '../lib/viewport';
import {
  rendererInit,
  rendererResize,
  rendererUpdateTiles,
  rendererLoadTexturesBatch,
  rendererEnterViewer,
  rendererExitViewer,
  rendererRenderViewer,
  rendererUpdateViewerPan,
  rendererUpdateViewerZoom,
} from '../lib/tauri';
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

  const [viewportWidth, setViewportWidth] = createSignal(0);
  const [viewportHeight, setViewportHeight] = createSignal(0);
  const [scrollTop, setScrollTop] = createSignal(0);
  const [scrollLeft, setScrollLeft] = createSignal(0);
  const [dpr, setDpr] = createSignal(window.devicePixelRatio || 1);
  const [visibleTileCount, setVisibleTileCount] = createSignal(0);
  const [lastUpdateTime, setLastUpdateTime] = createSignal(0);
  const [texturesLoaded, setTexturesLoaded] = createSignal(0);
  const [loadingTextures, setLoadingTextures] = createSignal(false);

  // View mode state
  const [viewMode, setViewMode] = createSignal<ViewMode>('grid');
  const [viewerAssetId, setViewerAssetId] = createSignal<number | null>(null);
  const [viewerIndex, setViewerIndex] = createSignal(0); // Current position in assets array
  const [viewerZoom, setViewerZoom] = createSignal(1.0);
  const [isDragging, setIsDragging] = createSignal(false);
  const [dragStart, setDragStart] = createSignal({ x: 0, y: 0 });
  const [rendererReady, setRendererReady] = createSignal(false);

  const gutter = 8; // Gap between tiles
  let rafId: number | null = null;
  let pendingUpdate = false;
  let loadingInProgress = false;

  // Calculate content height for scrolling
  const contentHeight = () => calculateContentHeight(
    props.totalItems,
    props.tileSize,
    gutter,
    viewportWidth()
  );

  // Update visible tiles and send to Rust (batched via RAF)
  const scheduleUpdate = () => {
    if (pendingUpdate) return;
    pendingUpdate = true;

    rafId = requestAnimationFrame(async () => {
      pendingUpdate = false;

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
      setLastUpdateTime(performance.now());

      // Send to Rust via IPC with asset IDs
      try {
        await rendererUpdateTiles({
          tiles: tiles.map(t => {
            // Map grid position to asset
            const asset = props.assets[t.id];
            const asset_id = asset ? asset.id : 0; // Use 0 for missing assets

            return {
              id: t.id,
              asset_id,
              x: t.x,
              y: t.y,
              w: t.w,
              h: t.h,
            };
          }),
          viewport_w: viewportWidth(),
          viewport_h: viewportHeight(),
          dpr: dpr(),
          selected_ids: props.selectedAssets,
        });
      } catch (error) {
        console.error('Failed to update tiles:', error);
      }
    });
  };

  // Handle scroll events
  const handleScroll = () => {
    if (!scrollerRef) return;
    setScrollTop(scrollerRef.scrollTop);
    setScrollLeft(scrollerRef.scrollLeft);
    scheduleUpdate();
  };

  // Handle resize events
  const handleResize = async () => {
    if (!containerRef) return;

    const rect = containerRef.getBoundingClientRect();
    const newWidth = rect.width;
    const newHeight = rect.height;
    const newDpr = window.devicePixelRatio || 1;

    setViewportWidth(newWidth);
    setViewportHeight(newHeight);
    setDpr(newDpr);

    // Notify Rust of resize
    try {
      await rendererResize(newWidth, newHeight, newDpr);
    } catch (error) {
      console.error('Failed to resize renderer:', error);
    }

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

      // Merge with existing selection (union)
      const selectionSet = new Set([...props.selectedAssets, ...range]);
      newSelection = Array.from(selectionSet).sort((a, b) => a - b);
    } else {
      // Regular click: Single selection
      newSelection = [tileId];
    }

    props.onSelectionChange(newSelection);
  };

  // Enter viewer mode with the first selected asset
  const enterViewerMode = async () => {
    if (props.selectedAssets.length === 0) return;

    const assetId = props.selectedAssets[0];
    const asset = props.assets.find(a => a.id === assetId);
    if (!asset) return;

    // Find the index of this asset in the full assets array
    const index = props.assets.findIndex(a => a.id === assetId);
    if (index === -1) return;

    console.log('Entering viewer mode for asset:', assetId, 'at index:', index);

    try {
      await rendererEnterViewer(assetId);
      setViewMode('viewer');
      setViewerAssetId(assetId);
      setViewerIndex(index);
      setViewerZoom(1.0);

      // Set cursor style for viewer
      if (containerRef) {
        containerRef.style.cursor = 'grab';
      }

      // Render the viewer
      const aspectRatio = asset.width && asset.height ? asset.width / asset.height : 1.0;
      await rendererRenderViewer(assetId, aspectRatio);
    } catch (error) {
      console.error('Failed to enter viewer mode:', error);
    }
  };

  // Navigate to a specific asset by index in viewer mode
  const navigateToAsset = async (index: number) => {
    if (viewMode() !== 'viewer') return;
    if (index < 0 || index >= props.assets.length) return;

    const asset = props.assets[index];
    if (!asset) return;

    console.log('Navigating to asset:', asset.id, 'at index:', index);

    try {
      await rendererEnterViewer(asset.id);
      setViewerAssetId(asset.id);
      setViewerIndex(index);
      setViewerZoom(1.0);

      // Update selection to reflect current image
      props.onSelectionChange([index]);

      // Render the new asset
      const aspectRatio = asset.width && asset.height ? asset.width / asset.height : 1.0;
      await rendererRenderViewer(asset.id, aspectRatio);
    } catch (error) {
      console.error('Failed to navigate to asset:', error);
    }
  };

  // Navigate to previous asset
  const navigatePrevious = async () => {
    const currentIndex = viewerIndex();
    if (currentIndex > 0) {
      await navigateToAsset(currentIndex - 1);
    }
  };

  // Navigate to next asset
  const navigateNext = async () => {
    const currentIndex = viewerIndex();
    if (currentIndex < props.assets.length - 1) {
      await navigateToAsset(currentIndex + 1);
    }
  };

  // Exit viewer mode and return to grid
  const exitViewerMode = async () => {
    console.log('Exiting viewer mode');

    try {
      await rendererExitViewer();
      setViewMode('grid');
      setViewerAssetId(null);
      setViewerZoom(1.0);

      // Reset cursor style
      if (containerRef) {
        containerRef.style.cursor = 'default';
      }

      // Re-render grid
      scheduleUpdate();
    } catch (error) {
      console.error('Failed to exit viewer mode:', error);
    }
  };

  // Handle zoom in viewer mode (mouse wheel)
  const handleViewerWheel = async (e: WheelEvent) => {
    if (viewMode() !== 'viewer') return;

    e.preventDefault();

    // Calculate zoom delta (negative deltaY = zoom in)
    const zoomSpeed = 0.001;
    const delta = -e.deltaY * zoomSpeed;

    try {
      await rendererUpdateViewerZoom(delta);

      // Update local zoom state for display
      const currentAssetId = viewerAssetId();
      if (currentAssetId !== null) {
        const asset = props.assets.find(a => a.id === currentAssetId);
        if (asset) {
          const newZoom = viewerZoom() * (1.0 + delta);
          setViewerZoom(Math.min(Math.max(newZoom, 0.25), 4.0));

          const aspectRatio = asset.width && asset.height ? asset.width / asset.height : 1.0;
          await rendererRenderViewer(currentAssetId, aspectRatio);
        }
      }
    } catch (error) {
      console.error('Failed to update viewer zoom:', error);
    }
  };

  // Handle pan start (mouse down)
  const handleViewerMouseDown = (e: MouseEvent) => {
    if (viewMode() !== 'viewer') return;

    setIsDragging(true);
    setDragStart({ x: e.clientX, y: e.clientY });

    if (containerRef) {
      containerRef.style.cursor = 'grabbing';
    }
  };

  // Handle pan move (mouse move)
  const handleViewerMouseMove = async (e: MouseEvent) => {
    if (viewMode() !== 'viewer' || !isDragging()) return;

    const start = dragStart();
    const deltaX = (e.clientX - start.x) / viewportWidth();
    const deltaY = (e.clientY - start.y) / viewportHeight();

    // Update drag start for next frame
    setDragStart({ x: e.clientX, y: e.clientY });

    try {
      await rendererUpdateViewerPan(deltaX, deltaY);

      const currentAssetId = viewerAssetId();
      if (currentAssetId !== null) {
        const asset = props.assets.find(a => a.id === currentAssetId);
        if (asset) {
          const aspectRatio = asset.width && asset.height ? asset.width / asset.height : 1.0;
          await rendererRenderViewer(currentAssetId, aspectRatio);
        }
      }
    } catch (error) {
      console.error('Failed to update viewer pan:', error);
    }
  };

  // Handle pan end (mouse up)
  const handleViewerMouseUp = () => {
    if (viewMode() !== 'viewer') return;

    setIsDragging(false);

    if (containerRef) {
      containerRef.style.cursor = 'grab';
    }
  };

  // Handle double-click to toggle between fit and 2x zoom
  const handleViewerDoubleClick = async () => {
    if (viewMode() !== 'viewer') return;

    const currentAssetId = viewerAssetId();
    if (currentAssetId === null) return;

    const asset = props.assets.find(a => a.id === currentAssetId);
    if (!asset) return;

    try {
      const currentZoom = viewerZoom();
      // If close to 1.0, zoom to 2.0; otherwise reset to 1.0
      const targetZoom = Math.abs(currentZoom - 1.0) < 0.1 ? 2.0 : 1.0;

      // Calculate delta to reach target zoom
      const delta = (targetZoom - currentZoom) / currentZoom;
      await rendererUpdateViewerZoom(delta);
      setViewerZoom(targetZoom);

      const aspectRatio = asset.width && asset.height ? asset.width / asset.height : 1.0;
      await rendererRenderViewer(currentAssetId, aspectRatio);
    } catch (error) {
      console.error('Failed to toggle zoom:', error);
    }
  };

  // Handle keyboard events
  const handleKeyDown = async (e: KeyboardEvent) => {
    if (viewMode() === 'grid') {
      // Grid mode: Enter to view selected image
      if (e.key === 'Enter' && props.selectedAssets.length > 0) {
        e.preventDefault();
        await enterViewerMode();
      }
      // Esc to deselect
      else if (e.key === 'Escape' && props.selectedAssets.length > 0) {
        e.preventDefault();
        props.onSelectionChange([]);
      }
    } else if (viewMode() === 'viewer') {
      const currentAssetId = viewerAssetId();
      const asset = currentAssetId !== null ? props.assets.find(a => a.id === currentAssetId) : null;
      const aspectRatio = asset && asset.width && asset.height ? asset.width / asset.height : 1.0;

      // Viewer mode: Esc to exit
      if (e.key === 'Escape') {
        e.preventDefault();
        await exitViewerMode();
      }
      // Zoom in with + or =
      else if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        try {
          await rendererUpdateViewerZoom(0.1); // 10% zoom in
          const newZoom = viewerZoom() * 1.1;
          setViewerZoom(Math.min(Math.max(newZoom, 0.25), 4.0));
          if (currentAssetId !== null) {
            await rendererRenderViewer(currentAssetId, aspectRatio);
          }
        } catch (error) {
          console.error('Failed to zoom in:', error);
        }
      }
      // Zoom out with -
      else if (e.key === '-') {
        e.preventDefault();
        try {
          await rendererUpdateViewerZoom(-0.1); // 10% zoom out
          const newZoom = viewerZoom() / 1.1;
          setViewerZoom(Math.min(Math.max(newZoom, 0.25), 4.0));
          if (currentAssetId !== null) {
            await rendererRenderViewer(currentAssetId, aspectRatio);
          }
        } catch (error) {
          console.error('Failed to zoom out:', error);
        }
      }
      // Reset zoom with 0
      else if (e.key === '0') {
        e.preventDefault();
        try {
          const currentZoom = viewerZoom();
          const delta = (1.0 - currentZoom) / currentZoom;
          await rendererUpdateViewerZoom(delta);
          setViewerZoom(1.0);
          if (currentAssetId !== null) {
            await rendererRenderViewer(currentAssetId, aspectRatio);
          }
        } catch (error) {
          console.error('Failed to reset zoom:', error);
        }
      }
      // Navigate with Left/Right arrows (or Space for next)
      else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        await navigatePrevious();
      }
      else if (e.key === 'ArrowRight' || e.key === ' ') {
        e.preventDefault();
        await navigateNext();
      }
      // Jump to first image with Home
      else if (e.key === 'Home') {
        e.preventDefault();
        await navigateToAsset(0);
      }
      // Jump to last image with End
      else if (e.key === 'End') {
        e.preventDefault();
        await navigateToAsset(props.totalItems - 1);
      }
      // Page navigation (jump 10 images at a time)
      else if (e.key === 'PageUp') {
        e.preventDefault();
        const newIndex = Math.max(0, viewerIndex() - 10);
        await navigateToAsset(newIndex);
      }
      else if (e.key === 'PageDown') {
        e.preventDefault();
        const newIndex = Math.min(props.totalItems - 1, viewerIndex() + 10);
        await navigateToAsset(newIndex);
      }
      // Pan with Up/Down arrow keys
      else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const panAmount = 0.1; // 10% of viewport
        const deltaY = e.key === 'ArrowUp' ? panAmount : -panAmount;

        try {
          await rendererUpdateViewerPan(0, deltaY);
          if (currentAssetId !== null) {
            await rendererRenderViewer(currentAssetId, aspectRatio);
          }
        } catch (error) {
          console.error('Failed to pan:', error);
        }
      }
    }
  };

  // Initialize
  onMount(async () => {
    // Renderer is initialized by Tauri on startup (in setup hook)
    // No need to call rendererInit() here
    setRendererReady(true);

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
  });

  // React to prop changes
  createEffect(() => {
    // When totalItems or tileSize changes, recalculate
    const _ = props.totalItems + props.tileSize;
    scheduleUpdate();
  });

  // React to selection changes
  createEffect(() => {
    // When selection changes, update renderer
    const _ = props.selectedAssets.length;
    scheduleUpdate();
  });

  // Load textures in background when assets change
  createEffect(() => {
    const assetList = props.assets;

    // Don't start if no assets or already loading
    if (assetList.length === 0 || loadingInProgress) return;

    // Small delay to ensure renderer is initialized
    setTimeout(() => {
      if (loadingInProgress) return;

    // Start background texture loading
    loadingInProgress = true;
    setLoadingTextures(true);

    (async () => {
      try {
        const BATCH_SIZE = 50; // Load 50 textures at a time
        const assetIds = assetList.map(a => a.id);
        let totalLoaded = 0;

        for (let i = 0; i < assetIds.length; i += BATCH_SIZE) {
          const batch = assetIds.slice(i, i + BATCH_SIZE);

          try {
            const loaded = await rendererLoadTexturesBatch(batch);
            totalLoaded += loaded;
            setTexturesLoaded(totalLoaded);

            // Trigger a re-render to show newly loaded textures
            scheduleUpdate();

            // Small delay between batches to keep UI responsive
            await new Promise(resolve => setTimeout(resolve, 10));
          } catch (error) {
            console.error('Failed to load texture batch:', error);
          }
        }

        console.log(`Background texture loading complete: ${totalLoaded} textures loaded`);
      } catch (error) {
        console.error('Background texture loading failed:', error);
      } finally {
        setLoadingTextures(false);
        loadingInProgress = false;
      }
    })();
    }, 100); // 100ms delay to let renderer initialize
  });

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
              <canvas id="gpu-grid-canvas" />
            </div>
          </div>
        </>
      ) : (
        <>
          <div class="grid-viewport-info" style="background: #1a1a1a;">
            <span style="color: #4a90e2;">
              {(() => {
                const assetId = viewerAssetId();
                const asset = assetId !== null ? props.assets.find(a => a.id === assetId) : null;
                return asset?.filename || 'Unknown';
              })()}
            </span>
            <span>
              {(() => {
                const assetId = viewerAssetId();
                const asset = assetId !== null ? props.assets.find(a => a.id === assetId) : null;
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
            <canvas id="gpu-grid-canvas" />
          </div>
        </>
      )}
    </div>
  );
};

export default GridViewport;
