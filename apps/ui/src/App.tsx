import { Component, createSignal } from 'solid-js';
import GridViewport from './components/GridViewport';
import StressControls from './components/StressControls';
import './App.css';

const App: Component = () => {
  const [totalItems, setTotalItems] = createSignal(1000);
  const [tileSize, setTileSize] = createSignal(128);

  return (
    <div class="app-container">
      <aside class="left-panel">
        <h3>Project / Tags / Shots</h3>
        <p>(Placeholder for M3)</p>

        <StressControls
          totalItems={totalItems()}
          tileSize={tileSize()}
          onTotalItemsChange={setTotalItems}
          onTileSizeChange={setTileSize}
        />
      </aside>

      <main class="center-viewport">
        <div class="viewport-header">
          <h2>GPU Grid Viewport (M0 - Phase 2)</h2>
        </div>
        <div class="viewport-canvas-container">
          <GridViewport totalItems={totalItems()} tileSize={tileSize()} />
        </div>
      </main>

      <aside class="right-panel">
        <h3>Inspector</h3>
        <p>(Placeholder for M3)</p>
      </aside>
    </div>
  );
};

export default App;
