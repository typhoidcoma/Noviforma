import { useEffect, useRef } from "react";

const TILE_SIZE = 96;
const GUTTER = 12;
const TOTAL = 5000;

export function CanvasViewport() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.floor(rect.width * dpr);
      canvas.height = Math.floor(rect.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    window.addEventListener("resize", resize);

    let rafId = 0;
    const frame = () => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      ctx.clearRect(0, 0, width, height);

      ctx.fillStyle = "#141819";
      ctx.fillRect(0, 0, width, height);

      const stride = TILE_SIZE + GUTTER;
      const cols = Math.max(1, Math.floor(width / stride));
      const rows = Math.ceil(TOTAL / cols);
      const visibleRows = Math.min(rows, Math.ceil(height / stride) + 1);
      let tileId = 0;

      for (let row = 0; row < visibleRows; row += 1) {
        for (let col = 0; col < cols; col += 1) {
          if (tileId >= TOTAL) break;
          const x = col * stride + GUTTER * 0.5;
          const y = row * stride + GUTTER * 0.5;
          ctx.fillStyle = tileId % 2 === 0 ? "#E05839" : "#5AB6C6";
          ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
          tileId += 1;
        }
      }

      ctx.fillStyle = "#E1E5C9";
      ctx.font = "12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
      ctx.fillText(
        `Canvas2D placeholder: ${tileId} visible / ${TOTAL} total`,
        12,
        height - 12,
      );

      rafId = window.requestAnimationFrame(frame);
    };

    rafId = window.requestAnimationFrame(frame);

    return () => {
      window.removeEventListener("resize", resize);
      window.cancelAnimationFrame(rafId);
    };
  }, []);

  return <canvas ref={canvasRef} className="viewport-canvas" />;
}
