import { Component, Show, For } from 'solid-js';
import type { Asset } from '../lib/database';
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
                  <span>{asset.width && asset.height ? `${asset.width} × ${asset.height}` : '--'}</span>
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
                <button class="btn-primary">Open in Viewer</button>
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
