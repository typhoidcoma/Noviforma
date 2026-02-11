import { Component, createSignal, onMount, onCleanup } from 'solid-js';
import GridViewport from './components/GridViewport';
import ProjectBrowser from './components/ProjectBrowser';
import Inspector from './components/Inspector';
import {
  dbInit,
  dbGetAllAssets,
  dbCountAssets,
  dbGetAllFolders,
  dbGetCurrentFolder,
  dbSetCurrentFolder,
  dbGetAssetsByFolder,
  type Asset,
  type Folder
} from './lib/database';
import './App.css';

const App: Component = () => {
  const tileSize = 128;
  const gutter = 32;
  const [selectedAssets, setSelectedAssets] = createSignal<number[]>([]);

  // Resizable panel widths
  const [leftPanelWidth, setLeftPanelWidth] = createSignal(240);
  const [rightPanelWidth, setRightPanelWidth] = createSignal(280);

  let dragging: 'left' | 'right' | null = null;
  let dragStartX = 0;
  let dragStartWidth = 0;

  const onResizeStart = (side: 'left' | 'right', e: MouseEvent) => {
    e.preventDefault();
    dragging = side;
    dragStartX = e.clientX;
    dragStartWidth = side === 'left' ? leftPanelWidth() : rightPanelWidth();
    document.addEventListener('mousemove', onResizeMove);
    document.addEventListener('mouseup', onResizeEnd);
  };

  const onResizeMove = (e: MouseEvent) => {
    if (!dragging) return;
    const delta = e.clientX - dragStartX;
    const min = 160, max = 500;
    if (dragging === 'left') {
      setLeftPanelWidth(Math.max(min, Math.min(max, dragStartWidth + delta)));
    } else {
      setRightPanelWidth(Math.max(min, Math.min(max, dragStartWidth - delta)));
    }
  };

  const onResizeEnd = () => {
    dragging = null;
    document.removeEventListener('mousemove', onResizeMove);
    document.removeEventListener('mouseup', onResizeEnd);
  };

  onCleanup(() => {
    document.removeEventListener('mousemove', onResizeMove);
    document.removeEventListener('mouseup', onResizeEnd);
  });
  const [assets, setAssets] = createSignal<Asset[]>([]);
  const [folders, setFolders] = createSignal<Folder[]>([]);
  const [currentFolderId, setCurrentFolderId] = createSignal<number | null>(null);
  const [dbInitialized, setDbInitialized] = createSignal(false);
  const [dbPath, setDbPath] = createSignal('');

  // Computed: total items always equals actual asset count
  const totalItems = () => assets().length;

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

      // Load folders
      await loadFolders();

      // Load current folder if set
      const current = await dbGetCurrentFolder();
      if (current) {
        setCurrentFolderId(current);
        await loadAssetsForFolder(current);
      }
    } catch (error) {
      console.error('Failed to initialize database:', error);
      alert(`Database initialization failed: ${error}\n\nCheck the console for details.`);
      // Still set initialized to true so UI is usable
      setDbInitialized(true);
    }
  });

  // Load assets from database (all assets)
  const loadAssets = async () => {
    try {
      const allAssets = await dbGetAllAssets();
      setAssets(allAssets);
      console.log(`Loaded ${allAssets.length} assets from database`);
    } catch (error) {
      console.error('Failed to load assets:', error);
    }
  };

  // Load folders from database
  const loadFolders = async () => {
    try {
      const allFolders = await dbGetAllFolders();
      setFolders(allFolders);
      console.log(`Loaded ${allFolders.length} folders from database`);
    } catch (error) {
      console.error('Failed to load folders:', error);
    }
  };

  // Load assets for a specific folder
  const loadAssetsForFolder = async (folderId: number) => {
    try {
      const folderAssets = await dbGetAssetsByFolder(folderId);
      setAssets(folderAssets);
      console.log(`Loaded ${folderAssets.length} assets from folder ${folderId}`);
    } catch (error) {
      console.error('Failed to load assets for folder:', error);
    }
  };

  // Handle folder selection change
  const handleFolderChange = async (folderId: number) => {
    await dbSetCurrentFolder(folderId);
    setCurrentFolderId(folderId);
    await loadAssetsForFolder(folderId);
  };

  // Refresh assets after scanning
  const handleAssetsUpdated = async () => {
    await loadFolders(); // Refresh folder list

    const current = await dbGetCurrentFolder();
    if (current) {
      setCurrentFolderId(current);
      await loadAssetsForFolder(current);
    } else {
      await loadAssets(); // Fallback to all assets
    }
  };

  return (
    <div class="app-container" style={{
      'grid-template-columns': `${leftPanelWidth()}px 4px 1fr 4px ${rightPanelWidth()}px`
    }}>
      <aside class="left-panel">
        <ProjectBrowser
          dbInitialized={dbInitialized()}
          folders={folders()}
          currentFolderId={currentFolderId()}
          onFolderSelect={handleFolderChange}
          onAssetsUpdated={handleAssetsUpdated}
        />
      </aside>

      <div class="resize-handle" onMouseDown={(e) => onResizeStart('left', e)} />

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
              tileSize={tileSize}
              gutter={gutter}
              selectedAssets={selectedAssets()}
              onSelectionChange={setSelectedAssets}
            />
          ) : (
            <div style="display: flex; align-items: center; justify-content: center; height: 100%; color: #8a8e7a;">
              Initializing database...
            </div>
          )}
        </div>
      </main>

      <div class="resize-handle" onMouseDown={(e) => onResizeStart('right', e)} />

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
