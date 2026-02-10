import { Component } from 'solid-js';
import './StressControls.css';

interface StressControlsProps {
  totalItems: number;
  tileSize: number;
  onTotalItemsChange: (value: number) => void;
  onTileSizeChange: (value: number) => void;
}

const StressControls: Component<StressControlsProps> = (props) => {
  const handleItemsChange = (e: Event) => {
    const value = parseInt((e.target as HTMLInputElement).value);
    props.onTotalItemsChange(value);
  };

  const handleSizeChange = (e: Event) => {
    const value = parseInt((e.target as HTMLInputElement).value);
    props.onTileSizeChange(value);
  };

  return (
    <div class="stress-controls">
      <h3>Grid Controls</h3>

      <div class="control-group">
        <label>
          <span class="control-label">Total Items</span>
          <span class="control-value">{props.totalItems.toLocaleString()}</span>
        </label>
        <input
          type="range"
          min="1"
          max="1000"
          step="1"
          value={props.totalItems}
          onInput={handleItemsChange}
        />
        <div class="control-hint">1 - 1,000</div>
      </div>

      <div class="control-group">
        <label>
          <span class="control-label">Tile Size</span>
          <span class="control-value">{props.tileSize}px</span>
        </label>
        <input
          type="range"
          min="64"
          max="256"
          step="8"
          value={props.tileSize}
          onInput={handleSizeChange}
        />
        <div class="control-hint">64px - 256px</div>
      </div>

      <div class="control-info">
        <p>Adjust these values to stress-test the viewport tracking and IPC performance.</p>
      </div>
    </div>
  );
};

export default StressControls;
