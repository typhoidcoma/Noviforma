import { Component, createSignal, onMount, onCleanup, createEffect } from 'solid-js';
import { calculateVisibleTiles, calculateContentHeight } from '../lib/viewport';
import { rendererInit, rendererResize, rendererUpdateTiles } from '../lib/tauri';
import './GridViewport.css';

interface GridViewportProps {
  totalItems: number;
  tileSize: number;
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

  const gutter = 8; // Gap between tiles
  let rafId: number | null = null;
  let pendingUpdate = false;

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

      // Send to Rust via IPC
      try {
        await rendererUpdateTiles({
          tiles: tiles.map(t => ({ id: t.id, x: t.x, y: t.y, w: t.w, h: t.h })),
          viewport_w: viewportWidth(),
          viewport_h: viewportHeight(),
          dpr: dpr(),
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

  return (
    <div class="grid-viewport" ref={containerRef}>
      <div class="grid-viewport-info">
        <span>Visible: {visibleTileCount()} tiles</span>
        <span>Total: {props.totalItems.toLocaleString()} items</span>
        <span>Viewport: {viewportWidth().toFixed(0)}x{viewportHeight().toFixed(0)} @ {dpr().toFixed(2)}x</span>
      </div>

      <div class="grid-scroller" ref={scrollerRef} onScroll={handleScroll}>
        <div class="grid-content" style={{ height: `${contentHeight()}px` }}>
          {/* GPU canvas will go here in Phase 3 */}
          <canvas id="gpu-grid-canvas" />
        </div>
      </div>
    </div>
  );
};

export default GridViewport;
