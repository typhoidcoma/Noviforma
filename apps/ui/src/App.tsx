import { Component, createSignal, onMount } from 'solid-js';
import GridViewport from './components/GridViewport';
import StressControls from './components/StressControls';
import ProjectBrowser from './components/ProjectBrowser';
import Inspector from './components/Inspector';
import { dbInit, dbGetAllAssets, dbCountAssets, type Asset } from './lib/database';
import './App.css';

const App: Component = () => {
  const [totalItems, setTotalItems] = createSignal(0);
  const [tileSize, setTileSize] = createSignal(128);
  const [selectedAssets, setSelectedAssets] = createSignal<number[]>([]);
  const [assets, setAssets] = createSignal<Asset[]>([]);
  const [dbInitialized, setDbInitialized] = createSignal(false);
  const [dbPath, setDbPath] = createSignal('');

  // Initialize database on mount
  onMount(async () => {
    try {
      // Use local directory for database and thumbnails (no permissions needed)
      const defaultDbPath = 'noviforma-data/noviforma.db';
      setDbPath(defaultDbPath);

      console.log('Initializing database at:', defaultDbPath);
      console.log('Thumbnails will be stored in: noviforma-data/thumbnails/');

      const result = await dbInit(defaultDbPath);
      console.log('Database init result:', result);

      setDbInitialized(true);

      // Load assets
      await loadAssets();
    } catch (error) {
      console.error('Failed to initialize database:', error);
      alert(`Database initialization failed: ${error}\n\nCheck the console for details.`);
      // Still set initialized to true so UI is usable
      setDbInitialized(true);
    }
  });

  // Load assets from database
  const loadAssets = async () => {
    try {
      const allAssets = await dbGetAllAssets();
      setAssets(allAssets);
      setTotalItems(allAssets.length);
      console.log(`Loaded ${allAssets.length} assets from database`);
    } catch (error) {
      console.error('Failed to load assets:', error);
    }
  };

  // Refresh assets after scanning
  const handleAssetsUpdated = async () => {
    await loadAssets();
  };

  return (
    <div class="app-container">
      <aside class="left-panel">
        <ProjectBrowser
          dbInitialized={dbInitialized()}
          onAssetsUpdated={handleAssetsUpdated}
        />

        <div class="controls-section">
          <StressControls
            totalItems={totalItems()}
            tileSize={tileSize()}
            onTotalItemsChange={setTotalItems}
            onTileSizeChange={setTileSize}
          />
        </div>
      </aside>

      <main class="center-viewport">
        <div class="viewport-header">
          <h2>Noviforma Grid</h2>
          <div class="viewport-actions">
            <button class="btn-view-mode" title="Grid View">⊞</button>
            <button class="btn-view-mode" title="List View">☰</button>
            <input
              type="search"
              placeholder="Search assets..."
              class="search-input"
            />
          </div>
        </div>
        <div class="viewport-canvas-container">
          {dbInitialized() ? (
            <GridViewport
              assets={assets()}
              totalItems={totalItems()}
              tileSize={tileSize()}
              selectedAssets={selectedAssets()}
              onSelectionChange={setSelectedAssets}
            />
          ) : (
            <div style="display: flex; align-items: center; justify-content: center; height: 100%; color: #888;">
              Initializing database...
            </div>
          )}
        </div>
      </main>

      <aside class="right-panel">
        <Inspector
          selectedAssets={selectedAssets().map(id => assets()[id]).filter(Boolean)}
          totalAssets={totalItems()}
        />
      </aside>
    </div>
  );
};

export default App;
