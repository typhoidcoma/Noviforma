import { Component, Show, For, createSignal, createEffect } from 'solid-js';
import type { Asset } from '../lib/database';
import { getThumbnailUrl } from '../lib/asset-urls';
import './Inspector.css';

interface InspectorProps {
  selectedAssets: Asset[];
  totalAssets: number;
}

// Helper function to format file size
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

const Inspector: Component<InspectorProps> = (props) => {
  const [zoom, setZoom] = createSignal(1);
  const [panX, setPanX] = createSignal(0);
  const [panY, setPanY] = createSignal(0);
  let isPanning = false;
  let lastMouseX = 0;
  let lastMouseY = 0;

  // Reset zoom/pan when selection changes
  createEffect(() => {
    const _assets = props.selectedAssets;
    setZoom(1);
    setPanX(0);
    setPanY(0);
  });

  const handleWheel = (e: WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    const newZoom = Math.min(Math.max(zoom() * factor, 1), 20);
    if (newZoom === 1) {
      setPanX(0);
      setPanY(0);
    }
    setZoom(newZoom);
  };

  const handleMouseDown = (e: MouseEvent) => {
    if (zoom() <= 1) return;
    isPanning = true;
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
    (e.currentTarget as HTMLElement).style.cursor = 'grabbing';
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isPanning) return;
    const dx = e.clientX - lastMouseX;
    const dy = e.clientY - lastMouseY;
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
    setPanX(panX() + dx);
    setPanY(panY() + dy);
  };

  const handleMouseUp = (e: MouseEvent) => {
    isPanning = false;
    (e.currentTarget as HTMLElement).style.cursor = zoom() > 1 ? 'grab' : '';
  };

  return (
    <div class="inspector">
      <div class="inspector-header">
        <h3>Inspector</h3>
      </div>

      <Show when={props.selectedAssets.length === 0}>
        <div class="inspector-empty">
          <p>No assets selected</p>
          <p class="inspector-hint">
            Click tiles to select assets
          </p>
        </div>
      </Show>

      <Show when={props.selectedAssets.length === 1}>
        {(() => {
          const asset = props.selectedAssets[0];
          return (
            <div class="inspector-single">
              <div
                class="inspector-preview"
                onWheel={handleWheel}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                style={{ cursor: zoom() > 1 ? 'grab' : 'default' }}
              >
                <Show when={asset.thumbnail_path} fallback={
                  <div class="inspector-preview-empty">No preview</div>
                }>
                  <img
                    src={getThumbnailUrl(asset.thumbnail_path!)}
                    alt={asset.filename}
                    class="inspector-preview-img"
                    style={{
                      transform: `scale(${zoom()}) translate(${panX() / zoom()}px, ${panY() / zoom()}px)`,
                    }}
                    draggable={false}
                  />
                </Show>
              </div>

              <div class="inspector-section">
                <h4>Asset Details</h4>
                <div class="inspector-field">
                  <label>Filename:</label>
                  <span title={asset.filename}>{asset.filename}</span>
                </div>
                <div class="inspector-field">
                  <label>Path:</label>
                  <span title={asset.path} style="font-size: 10px; word-break: break-all;">
                    {asset.path}
                  </span>
                </div>
                <div class="inspector-field">
                  <label>ID:</label>
                  <span>{asset.id}</span>
                </div>
                <div class="inspector-field">
                  <label>Type:</label>
                  <span>Image</span>
                </div>
                <div class="inspector-field">
                  <label>Status:</label>
                  <span class="status-badge">Indexed</span>
                </div>
              </div>

              <div class="inspector-section">
                <h4>Metadata</h4>
                <div class="inspector-field">
                  <label>Resolution:</label>
                  <span>{asset.width && asset.height ? `${asset.width} × ${asset.height} px` : '--'}</span>
                </div>
                <div class="inspector-field">
                  <label>Format:</label>
                  <span>{asset.path?.split('.').pop()?.toUpperCase() || 'Unknown'}</span>
                </div>
                <div class="inspector-field">
                  <label>Size:</label>
                  <span>{asset.file_size ? formatBytes(asset.file_size) : '--'}</span>
                </div>
              </div>

              <div class="inspector-section">
                <h4>Tags</h4>
                <div class="tag-list">
                  <span class="tag">untagged</span>
                </div>
                <button class="btn-add-tag">+ Add Tag</button>
              </div>

              <div class="inspector-section">
                <h4>Notes</h4>
                <textarea
                  class="notes-input"
                  placeholder="Add notes about this asset..."
                  rows="4"
                />
              </div>

              <div class="inspector-actions">
                <button class="btn-secondary">Assign to Shot</button>
              </div>
            </div>
          );
        })()}
      </Show>

      <Show when={props.selectedAssets.length > 1}>
        <div class="inspector-multi">
          <div class="inspector-section">
            <h4>Selection</h4>
            <div class="inspector-field">
              <label>Count:</label>
              <span>{props.selectedAssets.length} assets</span>
            </div>
          </div>

          <div class="inspector-section">
            <h4>Batch Actions</h4>
            <div class="batch-actions">
              <button class="btn-secondary">Add Tags</button>
              <button class="btn-secondary">Assign to Shot</button>
              <button class="btn-secondary">Export Selection</button>
            </div>
          </div>

          <div class="inspector-section">
            <h4>Selected Assets</h4>
            <div class="selected-list">
              <For each={props.selectedAssets.slice(0, 10)}>
                {(asset) => (
                  <div class="selected-item">
                    <span class="selected-id" title={asset.filename}>
                      {asset.filename}
                    </span>
                    <button class="btn-remove">×</button>
                  </div>
                )}
              </For>
              <Show when={props.selectedAssets.length > 10}>
                <div class="selected-more">
                  +{props.selectedAssets.length - 10} more...
                </div>
              </Show>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
};

export default Inspector;
