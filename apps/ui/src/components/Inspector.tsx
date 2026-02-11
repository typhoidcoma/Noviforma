import { Component, Show, For } from 'solid-js';
import './Inspector.css';

interface InspectorProps {
  selectedAssets: number[];
  totalAssets: number;
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
        <div class="inspector-single">
          <div class="inspector-section">
            <h4>Asset Details</h4>
            <div class="inspector-field">
              <label>ID:</label>
              <span>{props.selectedAssets[0]}</span>
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
              <span>512 × 512</span>
            </div>
            <div class="inspector-field">
              <label>Format:</label>
              <span>PNG</span>
            </div>
            <div class="inspector-field">
              <label>Size:</label>
              <span>--</span>
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
                {(id) => (
                  <div class="selected-item">
                    <span class="selected-id">#{id}</span>
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
