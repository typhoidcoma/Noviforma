import { Component, createSignal, onMount, onCleanup, createEffect } from 'solid-js';
import { calculateVisibleTiles, calculateContentHeight } from '../lib/viewport';
import { rendererInit, rendererResize, rendererUpdateTiles, rendererLoadTexturesBatch } from '../lib/tauri';
import type { Asset } from '../lib/database';
import './GridViewport.css';

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

  // Initialize
  onMount(async () => {
    // Initialize renderer
    try {
      const result = await rendererInit();
      console.log('Renderer initialized:', result);
    } catch (error) {
      console.error('Failed to initialize renderer:', error);
    }

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

    onCleanup(() => {
      mediaQuery.removeEventListener('change', handleDprChange);
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
    if (assetList.length === 0 || loadingInProgress) return;

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
  });

  return (
    <div class="grid-viewport" ref={containerRef}>
      <div class="grid-viewport-info">
        <span>Visible: {visibleTileCount()} tiles</span>
        <span>Total: {props.totalItems.toLocaleString()} items</span>
        {loadingTextures() && (
          <span style="color: #4a90e2;">
            Loading textures: {texturesLoaded()} / {props.totalItems}
          </span>
        )}
        <span>Viewport: {viewportWidth().toFixed(0)}x{viewportHeight().toFixed(0)} @ {dpr().toFixed(2)}x</span>
      </div>

      <div class="grid-scroller" ref={scrollerRef} onScroll={handleScroll}>
        <div class="grid-content" style={{ height: `${contentHeight()}px` }} onClick={handleClick}>
          {/* GPU canvas will go here in Phase 3 */}
          <canvas id="gpu-grid-canvas" />
        </div>
      </div>
    </div>
  );
};

export default GridViewport;
