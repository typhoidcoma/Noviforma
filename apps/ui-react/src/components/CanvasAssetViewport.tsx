import { useEffect, useMemo, useRef, useState } from "react";
import type { Asset } from "../lib/database";
import { getAssetUrl } from "../lib/asset-urls";

interface CanvasAssetViewportProps {
  assets: Asset[];
  selectedAssetIds: number[];
  onSelectAsset: (assetId: number, options: { multi: boolean; range: boolean }) => void;
  onSetSelection: (assetIds: number[], merge: boolean) => void;
  resetTrigger: number;
}

const TILE_SIZE = 140;
const GUTTER = 12;
const HEADER_HEIGHT = 26;
const MIN_ZOOM = 0.35;
const MAX_ZOOM = 3.2;
const LOADS_PER_FRAME = 6;

export function CanvasAssetViewport({
  assets,
  selectedAssetIds,
  onSelectAsset,
  onSetSelection,
  resetTrigger,
}: CanvasAssetViewportProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageCache = useRef<Map<number, HTMLImageElement>>(new Map());
  const imageLoading = useRef<Set<number>>(new Set());
  const loadQueue = useRef<number[]>([]);
  const loadQueueSet = useRef<Set<number>>(new Set());

  const [viewportWidth, setViewportWidth] = useState(1);
  const [viewportHeight, setViewportHeight] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(12);
  const [panY, setPanY] = useState(12);
  const [isPanning, setIsPanning] = useState(false);
  const [isLassoActive, setIsLassoActive] = useState(false);
  const [lassoStart, setLassoStart] = useState({ x: 0, y: 0 });
  const [lassoCurrent, setLassoCurrent] = useState({ x: 0, y: 0 });

  const dpr = window.devicePixelRatio || 1;
  const stride = TILE_SIZE + GUTTER;
  const worldViewportW = viewportWidth / zoom;
  const cols = Math.max(1, Math.floor(Math.max(worldViewportW - GUTTER, TILE_SIZE) / stride));
  const rowCount = Math.ceil(assets.length / cols);

  const visibleTiles = useMemo(() => {
    const left = (-panX) / zoom;
    const top = (-panY) / zoom;
    const right = left + viewportWidth / zoom;
    const bottom = top + viewportHeight / zoom;

    const startCol = Math.max(0, Math.floor((left - GUTTER) / stride) - 1);
    const endCol = Math.min(cols - 1, Math.ceil((right - GUTTER) / stride) + 1);
    const startRow = Math.max(0, Math.floor((top - GUTTER) / stride) - 1);
    const endRow = Math.min(rowCount - 1, Math.ceil((bottom - GUTTER) / stride) + 1);

    const result: Array<{ index: number; asset: Asset; x: number; y: number }> = [];
    for (let row = startRow; row <= endRow; row += 1) {
      for (let col = startCol; col <= endCol; col += 1) {
        const index = row * cols + col;
        const asset = assets[index];
        if (!asset) continue;
        result.push({
          index,
          asset,
          x: col * stride + GUTTER,
          y: row * stride + GUTTER,
        });
      }
    }
    return result;
  }, [assets, cols, panX, panY, rowCount, stride, viewportHeight, viewportWidth, zoom]);

  const gridWorldWidth = Math.max(0, cols * stride + GUTTER);
  const gridWorldHeight = Math.max(0, rowCount * stride + GUTTER);
  const gridScreenWidth = gridWorldWidth * zoom;
  const gridScreenHeight = gridWorldHeight * zoom;

  const lastPointer = useRef({ x: 0, y: 0 });
  const didDrag = useRef(false);
  const spaceDown = useRef(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect;
      if (!next) return;
      setViewportWidth(Math.floor(next.width));
      setViewportHeight(Math.floor(next.height));
    });
    observer.observe(container);
    setViewportWidth(Math.floor(container.clientWidth));
    setViewportHeight(Math.floor(container.clientHeight));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setZoom(1);
    setPanX(12);
    setPanY(12);
  }, [resetTrigger]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = Math.max(1, Math.floor(viewportWidth * dpr));
    canvas.height = Math.max(1, Math.floor(viewportHeight * dpr));
    canvas.style.width = `${viewportWidth}px`;
    canvas.style.height = `${viewportHeight}px`;
  }, [viewportWidth, viewportHeight, dpr]);

  useEffect(() => {
    let rafId = 0;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const draw = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, viewportWidth, viewportHeight);
      ctx.fillStyle = "#10161a";
      ctx.fillRect(0, 0, viewportWidth, viewportHeight);

      // Queue visible thumbnails by viewport order and process a fixed budget each frame.
      for (const tile of visibleTiles) {
        if (imageCache.current.has(tile.asset.id) || imageLoading.current.has(tile.asset.id)) continue;
        if (loadQueueSet.current.has(tile.asset.id)) continue;
        loadQueue.current.push(tile.asset.id);
        loadQueueSet.current.add(tile.asset.id);
      }

      for (let i = 0; i < LOADS_PER_FRAME; i += 1) {
        const assetId = loadQueue.current.shift();
        if (assetId === undefined) break;
        loadQueueSet.current.delete(assetId);
        if (imageCache.current.has(assetId) || imageLoading.current.has(assetId)) continue;
        const asset = assets.find((a) => a.id === assetId);
        if (!asset) continue;

        imageLoading.current.add(assetId);
        const img = new Image();
        img.src = getAssetUrl(asset.path);
        img.onload = () => {
          imageCache.current.set(assetId, img);
          imageLoading.current.delete(assetId);
        };
        img.onerror = () => {
          imageLoading.current.delete(assetId);
        };
      }

      for (const tile of visibleTiles) {
        const sx = tile.x * zoom + panX;
        const sy = tile.y * zoom + panY;
        const sw = TILE_SIZE * zoom;
        const sh = TILE_SIZE * zoom;
        const labelH = HEADER_HEIGHT * zoom;

        if (sx > viewportWidth || sy > viewportHeight || sx + sw < 0 || sy + sh + labelH < 0) continue;

        const selected = selectedAssetIds.includes(tile.asset.id);
        ctx.fillStyle = selected ? "#25444a" : "#151b20";
        ctx.fillRect(sx - 2, sy - 2, sw + 4, sh + labelH + 4);

        ctx.fillStyle = "#0c1013";
        ctx.fillRect(sx, sy, sw, sh);

        const img = imageCache.current.get(tile.asset.id);
        if (img) {
          ctx.drawImage(img, sx, sy, sw, sh);
        }

        ctx.fillStyle = "#0f1317cc";
        ctx.fillRect(sx, sy + sh - 20 * zoom, sw, 20 * zoom);

        ctx.fillStyle = "#d2d8c3";
        ctx.font = `${Math.max(11, 12 * zoom)}px 'Segoe UI', sans-serif`;
        const label = tile.asset.filename.length > 20 ? `${tile.asset.filename.slice(0, 20)}...` : tile.asset.filename;
        ctx.fillText(label, sx + 6 * zoom, sy + sh + 16 * zoom);
      }

      if (isLassoActive) {
        const minX = Math.min(lassoStart.x, lassoCurrent.x);
        const minY = Math.min(lassoStart.y, lassoCurrent.y);
        const w = Math.abs(lassoCurrent.x - lassoStart.x);
        const h = Math.abs(lassoCurrent.y - lassoStart.y);
        ctx.fillStyle = "rgba(90, 182, 198, 0.2)";
        ctx.fillRect(minX, minY, w, h);
        ctx.strokeStyle = "#5ab6c6";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 4]);
        ctx.strokeRect(minX, minY, w, h);
        ctx.setLineDash([]);
      }

      ctx.fillStyle = "#9ca38f";
      ctx.font = "12px 'Segoe UI', sans-serif";
      ctx.fillText(
        `Zoom ${Math.round(zoom * 100)}%  Pan(${Math.round(panX)}, ${Math.round(panY)})  Visible ${visibleTiles.length}/${assets.length}`,
        12,
        viewportHeight - 12,
      );

      rafId = window.requestAnimationFrame(draw);
    };

    rafId = window.requestAnimationFrame(draw);
    return () => window.cancelAnimationFrame(rafId);
  }, [
    assets,
    dpr,
    isLassoActive,
    lassoCurrent.x,
    lassoCurrent.y,
    lassoStart.x,
    lassoStart.y,
    panX,
    panY,
    selectedAssetIds,
    viewportHeight,
    viewportWidth,
    visibleTiles,
    zoom,
  ]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === "Space") spaceDown.current = true;
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") spaceDown.current = false;
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  const handleClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (didDrag.current) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const localX = event.clientX - rect.left;
    const localY = event.clientY - rect.top;
    const worldX = (localX - panX) / zoom;
    const worldY = (localY - panY) / zoom;

    const col = Math.floor((worldX - GUTTER) / stride);
    const row = Math.floor((worldY - GUTTER) / stride);
    if (col < 0 || row < 0 || col >= cols) return;
    const tileX = col * stride + GUTTER;
    const tileY = row * stride + GUTTER;
    if (worldX < tileX || worldX > tileX + TILE_SIZE) return;
    if (worldY < tileY || worldY > tileY + TILE_SIZE + HEADER_HEIGHT) return;

    const index = row * cols + col;
    const asset = assets[index];
    if (!asset) return;
    onSelectAsset(asset.id, {
      multi: event.ctrlKey || event.metaKey,
      range: event.shiftKey,
    });
  };

  const handleMouseDown = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    lastPointer.current = { x, y };
    didDrag.current = false;

    if (spaceDown.current || event.button === 1 || event.button === 2) {
      event.preventDefault();
      setIsPanning(true);
      return;
    }

    if (event.button === 0) {
      setIsLassoActive(true);
      setLassoStart({ x, y });
      setLassoCurrent({ x, y });
    }
  };

  const handleMouseMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    if (isPanning) {
      const dx = x - lastPointer.current.x;
      const dy = y - lastPointer.current.y;
      if (Math.abs(dx) > 0 || Math.abs(dy) > 0) didDrag.current = true;
      setPanX((v) => v + dx);
      setPanY((v) => v + dy);
      lastPointer.current = { x, y };
      return;
    }

    if (isLassoActive) {
      if (
        Math.abs(x - lassoStart.x) > 3 ||
        Math.abs(y - lassoStart.y) > 3
      ) {
        didDrag.current = true;
      }
      setLassoCurrent({ x, y });
    }
  };

  const handleMouseUp = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (isPanning) {
      setIsPanning(false);
    }

    if (isLassoActive) {
      const minX = Math.min(lassoStart.x, lassoCurrent.x);
      const maxX = Math.max(lassoStart.x, lassoCurrent.x);
      const minY = Math.min(lassoStart.y, lassoCurrent.y);
      const maxY = Math.max(lassoStart.y, lassoCurrent.y);

      if (didDrag.current) {
        const picked: number[] = [];
        for (const tile of visibleTiles) {
          const sx = tile.x * zoom + panX;
          const sy = tile.y * zoom + panY;
          const sw = TILE_SIZE * zoom;
          const sh = (TILE_SIZE + HEADER_HEIGHT) * zoom;
          const intersects = !(sx > maxX || sy > maxY || sx + sw < minX || sy + sh < minY);
          if (intersects) picked.push(tile.asset.id);
        }
        onSetSelection(picked, event.ctrlKey || event.metaKey);
      }
      setIsLassoActive(false);
    }
  };

  const handleWheel = (event: React.WheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const mx = event.clientX - rect.left;
    const my = event.clientY - rect.top;

    const worldX = (mx - panX) / zoom;
    const worldY = (my - panY) / zoom;
    const factor = event.deltaY < 0 ? 1.08 : 0.92;
    const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * factor));

    setZoom(nextZoom);
    setPanX(mx - worldX * nextZoom);
    setPanY(my - worldY * nextZoom);
  };

  return (
    <div ref={containerRef} className="canvas-grid-container">
      <canvas
        ref={canvasRef}
        className="canvas-grid-canvas"
        onClick={handleClick}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
        onContextMenu={(e) => e.preventDefault()}
      />
      <div
        className="grid-bounds-hint"
        style={{
          width: `${Math.max(viewportWidth, gridScreenWidth + Math.abs(Math.min(0, panX)))}px`,
          height: `${Math.max(viewportHeight, gridScreenHeight + Math.abs(Math.min(0, panY)))}px`,
        }}
      />
    </div>
  );
}
