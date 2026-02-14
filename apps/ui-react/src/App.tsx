import { useEffect, useMemo, useState } from "react";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  type Edge,
  type Node,
} from "reactflow";
import "reactflow/dist/style.css";

import { CanvasAssetViewport } from "./components/CanvasAssetViewport";
import { Inspector } from "./components/Inspector";
import { ProjectBrowser } from "./components/ProjectBrowser";
import type { Asset, AssetFilter, Folder, Shot } from "./lib/database";
import {
  dbGetAllFolders,
  dbGetAllShots,
  dbGetCurrentFolder,
  dbInit,
  dbSearchAssets,
  dbSetCurrentFolder,
} from "./lib/database";

const nodes: Node[] = [
  { id: "source", type: "input", position: { x: 24, y: 42 }, data: { label: "Image Input" } },
  { id: "fx", position: { x: 220, y: 42 }, data: { label: "Process Node" } },
  { id: "out", type: "output", position: { x: 420, y: 42 }, data: { label: "Output" } },
];

const edges: Edge[] = [
  { id: "e1", source: "source", target: "fx" },
  { id: "e2", source: "fx", target: "out" },
];

export default function App() {
  const [dbInitialized, setDbInitialized] = useState(false);
  const [dbPath, setDbPath] = useState("");

  const [assets, setAssets] = useState<Asset[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [shots, setShots] = useState<Shot[]>([]);
  const [selectedAssetIds, setSelectedAssetIds] = useState<number[]>([]);
  const [lastSelectedAssetId, setLastSelectedAssetId] = useState<number | null>(null);
  const [viewportResetTrigger, setViewportResetTrigger] = useState(0);

  const [currentFolderId, setCurrentFolderId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterTagIds, setFilterTagIds] = useState<number[]>([]);
  const [filterMinRating, setFilterMinRating] = useState(0);
  const [filterShotId, setFilterShotId] = useState<number | null>(null);

  const selectedAssets = useMemo(
    () => assets.filter((a) => selectedAssetIds.includes(a.id)),
    [assets, selectedAssetIds],
  );

  const hasFilters =
    searchQuery.trim() !== "" ||
    filterTagIds.length > 0 ||
    filterMinRating > 0 ||
    filterShotId !== null;

  const loadFilteredAssets = async () => {
    if (!dbInitialized) return;
    if (folders.length === 0) {
      setAssets([]);
      return;
    }
    const filter: AssetFilter = {
      folderId: currentFolderId ?? undefined,
      searchQuery: searchQuery || undefined,
      tagIds: filterTagIds.length > 0 ? filterTagIds : undefined,
      minRating: filterMinRating > 0 ? filterMinRating : undefined,
      shotId: filterShotId ?? undefined,
    };
    const rows = await dbSearchAssets(filter);
    setAssets(rows);
    setSelectedAssetIds([]);
  };

  const loadFoldersAndShots = async () => {
    const [allFolders, allShots] = await Promise.all([dbGetAllFolders(), dbGetAllShots()]);
    setFolders(allFolders);
    setShots(allShots);
  };

  const handleAssetsUpdated = async () => {
    await loadFoldersAndShots();
    const active = await dbGetCurrentFolder();
    setCurrentFolderId(active);
    await loadFilteredAssets();
  };

  useEffect(() => {
    dbInit("databases/noviforma.db")
      .then(async (resolvedPath) => {
        setDbPath(resolvedPath);
        setDbInitialized(true);
        await loadFoldersAndShots();
        const active = await dbGetCurrentFolder();
        setCurrentFolderId(active);
        await loadFilteredAssets();
      })
      .catch((error) => {
        window.alert(`Database init failed: ${String(error)}`);
        setDbInitialized(true);
      });
  }, []);

  useEffect(() => {
    const id = window.setTimeout(() => {
      loadFilteredAssets().catch(console.error);
    }, 150);
    return () => window.clearTimeout(id);
  }, [dbInitialized, currentFolderId, searchQuery, filterTagIds, filterMinRating, filterShotId, folders.length]);

  const handleFolderSelect = async (folderId: number) => {
    await dbSetCurrentFolder(folderId);
    setCurrentFolderId(folderId);
  };

  const selectAsset = (assetId: number, options: { multi: boolean; range: boolean }) => {
    const { multi, range } = options;
    setSelectedAssetIds((prev) => {
      if (range && lastSelectedAssetId !== null) {
        const indexMap = new Map(assets.map((asset, idx) => [asset.id, idx]));
        const a = indexMap.get(lastSelectedAssetId);
        const b = indexMap.get(assetId);
        if (a !== undefined && b !== undefined) {
          const start = Math.min(a, b);
          const end = Math.max(a, b);
          const rangeIds = assets.slice(start, end + 1).map((asset) => asset.id);
          if (multi) {
            const merged = new Set(prev);
            for (const id of rangeIds) merged.add(id);
            return Array.from(merged);
          }
          return rangeIds;
        }
      }

      if (!multi) return [assetId];
      if (prev.includes(assetId)) {
        return prev.filter((id) => id !== assetId);
      }
      return [...prev, assetId];
    });
    setLastSelectedAssetId(assetId);
  };

  const setSelection = (assetIds: number[], merge: boolean) => {
    setSelectedAssetIds((prev) => {
      if (!merge) return assetIds;
      const set = new Set(prev);
      for (const id of assetIds) set.add(id);
      return Array.from(set);
    });
    if (assetIds.length > 0) {
      setLastSelectedAssetId(assetIds[assetIds.length - 1]);
    }
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName.toLowerCase();
      if (tag === "input" || tag === "textarea" || target?.isContentEditable) return;

      if (event.key.toLowerCase() === "r") {
        event.preventDefault();
        setViewportResetTrigger((v) => v + 1);
      } else if (event.key === "Escape") {
        event.preventDefault();
        setSelectedAssetIds([]);
        setLastSelectedAssetId(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="app-shell">
      <aside className="panel panel-left">
        <ProjectBrowser
          dbInitialized={dbInitialized}
          folders={folders}
          currentFolderId={currentFolderId}
          activeTagFilters={filterTagIds}
          activeShotFilter={filterShotId}
          onFolderSelect={handleFolderSelect}
          onAssetsUpdated={handleAssetsUpdated}
          onTagFilterChange={setFilterTagIds}
          onShotFilterChange={setFilterShotId}
        />
      </aside>

      <main className="panel panel-main">
        <header className="panel-header">
          <span>Catalog</span>
          <div className="header-controls">
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search assets..."
            />
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                className={star <= filterMinRating ? "star active" : "star"}
                onClick={() => setFilterMinRating((curr) => (curr === star ? 0 : star))}
                title={`Filter ${star}+`}
              >
                {star <= filterMinRating ? "★" : "☆"}
              </button>
            ))}
            {hasFilters && (
              <button
                onClick={() => {
                  setSearchQuery("");
                  setFilterTagIds([]);
                  setFilterMinRating(0);
                  setFilterShotId(null);
                }}
              >
                Clear
              </button>
            )}
          </div>
        </header>
        <div className="panel-body panel-body-fill">
          {dbInitialized ? (
            <CanvasAssetViewport
              assets={assets}
              selectedAssetIds={selectedAssetIds}
              onSelectAsset={selectAsset}
              onSetSelection={setSelection}
              resetTrigger={viewportResetTrigger}
            />
          ) : (
            <div className="loader">Initializing database...</div>
          )}
        </div>
      </main>

      <aside className="panel panel-right">
        <header className="panel-header">Inspector</header>
        <div className="panel-body">
          <Inspector selectedAssets={selectedAssets} />
          <p className="muted">DB: {dbPath || "not initialized"}</p>
          <p className="muted">Shots loaded: {shots.length}</p>
        </div>
      </aside>

      <section className="panel panel-bottom">
        <header className="panel-header">Node Graph (Shell)</header>
        <div className="panel-body panel-body-fill">
          <ReactFlow nodes={nodes} edges={edges} fitView>
            <MiniMap />
            <Controls />
            <Background />
          </ReactFlow>
        </div>
      </section>
    </div>
  );
}
