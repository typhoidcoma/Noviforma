import { Component } from 'solid-js';
import './GridControls.css';

interface GridControlsProps {
  tileSize: number;
  gutter: number;
  onTileSizeChange: (value: number) => void;
  onGutterChange: (value: number) => void;
}

const GridControls: Component<GridControlsProps> = (props) => {
  const handleSizeChange = (e: Event) => {
    const value = parseInt((e.target as HTMLInputElement).value);
    props.onTileSizeChange(value);
  };

  const handleGutterChange = (e: Event) => {
    const value = parseInt((e.target as HTMLInputElement).value);
    props.onGutterChange(value);
  };

  return (
    <div class="grid-controls">
      <h3>Grid Controls</h3>

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

      <div class="control-group">
        <label>
          <span class="control-label">Grid Spacing</span>
          <span class="control-value">{props.gutter}px</span>
        </label>
        <input
          type="range"
          min="0"
          max="32"
          step="2"
          value={props.gutter}
          onInput={handleGutterChange}
        />
        <div class="control-hint">0px - 32px</div>
      </div>
    </div>
  );
};

export default GridControls;
