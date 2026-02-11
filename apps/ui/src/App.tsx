import { Component, createSignal, createEffect, on, onMount, onCleanup, Show } from 'solid-js';
import GridViewport from './components/GridViewport';
import ProjectBrowser from './components/ProjectBrowser';
import Inspector from './components/Inspector';
import {
  dbInit,
  dbGetAllFolders,
  dbGetCurrentFolder,
  dbSetCurrentFolder,
  dbSearchAssets,
  dbGetAllShots,
  type Asset,
  type AssetFilter,
  type Folder,
  type Shot,
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

  // Core state
  const [assets, setAssets] = createSignal<Asset[]>([]);
  const [folders, setFolders] = createSignal<Folder[]>([]);
  const [shots, setShots] = createSignal<Shot[]>([]);
  const [currentFolderId, setCurrentFolderId] = createSignal<number | null>(null);
  const [dbInitialized, setDbInitialized] = createSignal(false);
  const [dbPath, setDbPath] = createSignal('');

  // Filter state
  const [searchQuery, setSearchQuery] = createSignal('');
  const [filterTagIds, setFilterTagIds] = createSignal<number[]>([]);
  const [filterMinRating, setFilterMinRating] = createSignal(0);
  const [filterShotId, setFilterShotId] = createSignal<number | null>(null);

  // Grid reset trigger (increment to reset view)
  const [resetTrigger, setResetTrigger] = createSignal(0);

  // Computed
  const totalItems = () => assets().length;

  const hasActiveFilters = () =>
    searchQuery() !== '' ||
    filterTagIds().length > 0 ||
    filterMinRating() > 0 ||
    filterShotId() !== null;

  // Unified asset loading with filters
  const loadFilteredAssets = async () => {
    if (!dbInitialized()) return;

    // No folders → nothing to show
    if (folders().length === 0) {
      setAssets([]);
      return;
    }

    try {
      const filter: AssetFilter = {
        folderId: currentFolderId() ?? undefined,
        searchQuery: searchQuery() || undefined,
        tagIds: filterTagIds().length > 0 ? filterTagIds() : undefined,
        minRating: filterMinRating() > 0 ? filterMinRating() : undefined,
        shotId: filterShotId() ?? undefined,
      };
      const results = await dbSearchAssets(filter);
      setAssets(results);
    } catch (error) {
      console.error('Failed to load filtered assets:', error);
    }
  };

  // Initialize database on mount
  onMount(async () => {
    try {
      const defaultDbPath = 'noviforma-data/noviforma.db';
      setDbPath(defaultDbPath);

      console.log('Initializing database at:', defaultDbPath);
      const result = await dbInit(defaultDbPath);
      console.log('Database init result:', result);

      setDbInitialized(true);

      // Load folders and shots
      await Promise.all([loadFolders(), loadShots()]);

      // Load current folder if set
      const current = await dbGetCurrentFolder();
      if (current) {
        setCurrentFolderId(current);
      }

      // Initial asset load
      await loadFilteredAssets();
    } catch (error) {
      console.error('Failed to initialize database:', error);
      alert(`Database initialization failed: ${error}\n\nCheck the console for details.`);
      setDbInitialized(true);
    }
  });

  // Debounced reactive effect for filter changes
  let searchTimeout: number | null = null;
  createEffect(on(
    () => [searchQuery(), filterTagIds(), filterMinRating(), filterShotId(), currentFolderId()],
    () => {
      if (searchTimeout) clearTimeout(searchTimeout);
      searchTimeout = window.setTimeout(() => {
        if (dbInitialized()) {
          loadFilteredAssets();
        }
      }, 150);
    },
    { defer: true }
  ));

  const loadFolders = async () => {
    try {
      const allFolders = await dbGetAllFolders();
      setFolders(allFolders);
    } catch (error) {
      console.error('Failed to load folders:', error);
    }
  };

  const loadShots = async () => {
    try {
      const allShots = await dbGetAllShots();
      setShots(allShots);
    } catch (error) {
      console.error('Failed to load shots:', error);
    }
  };

  const handleFolderChange = async (folderId: number) => {
    await dbSetCurrentFolder(folderId);
    setCurrentFolderId(folderId);
  };

  const handleAssetsUpdated = async () => {
    await Promise.all([loadFolders(), loadShots()]);

    const allFolders = folders();
    if (allFolders.length === 0) {
      // No folders left — clear everything
      setCurrentFolderId(null);
      setAssets([]);
      setSelectedAssets([]);
      return;
    }

    // Validate current folder still exists
    const current = await dbGetCurrentFolder();
    if (current && allFolders.some(f => f.id === current)) {
      setCurrentFolderId(current);
    } else {
      setCurrentFolderId(null);
    }

    await loadFilteredAssets();
  };

  const clearAllFilters = () => {
    setSearchQuery('');
    setFilterTagIds([]);
    setFilterMinRating(0);
    setFilterShotId(null);
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
          onTagFilterChange={setFilterTagIds}
          onShotFilterChange={setFilterShotId}
          activeTagFilters={filterTagIds()}
          activeShotFilter={filterShotId()}
        />
      </aside>

      <div class="resize-handle" onMouseDown={(e) => onResizeStart('left', e)} />

      <main class="center-viewport">
        <div class="viewport-header">
          <h2>Noviforma Grid</h2>
          <div class="viewport-actions">
            <button class="btn-view-mode" title="Recenter Grid" onClick={() => setResetTrigger(resetTrigger() + 1)}>⟐</button>
            <input
              type="search"
              placeholder="Search assets..."
              class="search-input"
              value={searchQuery()}
              onInput={(e) => setSearchQuery(e.currentTarget.value)}
            />
            <div class="rating-filter">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  class={`star-filter ${star <= filterMinRating() ? 'active' : ''}`}
                  onClick={() => setFilterMinRating(star === filterMinRating() ? 0 : star)}
                  title={`Filter: ${star}+ stars`}
                >
                  {star <= filterMinRating() ? '\u2605' : '\u2606'}
                </button>
              ))}
            </div>
            <Show when={hasActiveFilters()}>
              <button
                class="btn-clear-filters"
                onClick={clearAllFilters}
                title="Clear all filters"
              >
                Clear
              </button>
            </Show>
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
              resetTrigger={resetTrigger()}
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
          onTagsChanged={() => loadFilteredAssets()}
          onShotAssigned={() => { loadFilteredAssets(); loadShots(); }}
          allShots={shots()}
        />
      </aside>
    </div>
  );
};

export default App;
