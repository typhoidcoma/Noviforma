import { useEffect, useMemo, useState } from "react";
import type { Folder, Shot, TagWithCount } from "../lib/database";
import {
  dbCreateShot,
  dbCreateTag,
  dbDeleteFolder,
  dbDeleteShot,
  dbDeleteTag,
  dbGenerateThumbnailsForFolder,
  dbGetAllShots,
  dbGetAllTagsWithCounts,
  dbGetThumbnailProgress,
  dbScanDirectory,
  dbUpdateTag,
} from "../lib/database";

type Tab = "files" | "tags" | "shots";

interface ProjectBrowserProps {
  dbInitialized: boolean;
  folders: Folder[];
  currentFolderId: number | null;
  activeTagFilters: number[];
  activeShotFilter: number | null;
  onFolderSelect: (folderId: number) => Promise<void>;
  onAssetsUpdated: () => Promise<void>;
  onTagFilterChange: (tagIds: number[]) => void;
  onShotFilterChange: (shotId: number | null) => void;
}

export function ProjectBrowser(props: ProjectBrowserProps) {
  const [tab, setTab] = useState<Tab>("files");
  const [tags, setTags] = useState<TagWithCount[]>([]);
  const [shots, setShots] = useState<Shot[]>([]);
  const [scanning, setScanning] = useState(false);
  const [status, setStatus] = useState("");
  const [progress, setProgress] = useState({ current: 0, total: 0 });

  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState("#5AB6C6");
  const [newShotName, setNewShotName] = useState("");
  const [newShotSeq, setNewShotSeq] = useState("");

  const loadTaxonomy = async () => {
    const [allTags, allShots] = await Promise.all([dbGetAllTagsWithCounts(), dbGetAllShots()]);
    setTags(allTags);
    setShots(allShots);
  };

  useEffect(() => {
    if (!props.dbInitialized) return;
    loadTaxonomy().catch(console.error);
  }, [props.dbInitialized]);

  useEffect(() => {
    if (!scanning) return;
    const id = window.setInterval(async () => {
      try {
        const info = await dbGetThumbnailProgress();
        setProgress(info);
      } catch {
        // no-op
      }
    }, 200);
    return () => window.clearInterval(id);
  }, [scanning]);

  const progressText = useMemo(() => {
    if (progress.total <= 0) return "0%";
    return `${Math.round((progress.current / progress.total) * 100)}%`;
  }, [progress]);

  const handleScan = async () => {
    const path = window.prompt("Enter directory path to scan:");
    if (!path) return;
    setScanning(true);
    setStatus("Scanning directory...");
    try {
      const scan = await dbScanDirectory(path);
      if (scan.indexed > 0) {
        setStatus("Generating thumbnails...");
        await dbGenerateThumbnailsForFolder(scan.folder_id);
      }
      await props.onAssetsUpdated();
      await props.onFolderSelect(scan.folder_id);
      await loadTaxonomy();
    } catch (error) {
      window.alert(`Scan failed: ${String(error)}`);
    } finally {
      setScanning(false);
      setStatus("");
      setProgress({ current: 0, total: 0 });
    }
  };

  const handleRescanAll = async () => {
    if (props.folders.length === 0) return;
    setScanning(true);
    try {
      for (let i = 0; i < props.folders.length; i += 1) {
        const folder = props.folders[i];
        setStatus(`Scanning ${folder.name} (${i + 1}/${props.folders.length})`);
        const scan = await dbScanDirectory(folder.path);
        if (scan.indexed > 0) {
          setStatus(`Generating thumbnails for ${folder.name}`);
          await dbGenerateThumbnailsForFolder(scan.folder_id);
        }
      }
      await props.onAssetsUpdated();
      await loadTaxonomy();
    } catch (error) {
      window.alert(`Rescan failed: ${String(error)}`);
    } finally {
      setScanning(false);
      setStatus("");
      setProgress({ current: 0, total: 0 });
    }
  };

  return (
    <div className="browser">
      <div className="browser-head">
        <strong>Project</strong>
      </div>

      <div className="tab-row">
        <button className={tab === "files" ? "active" : ""} onClick={() => setTab("files")}>Files</button>
        <button className={tab === "tags" ? "active" : ""} onClick={() => setTab("tags")}>Tags</button>
        <button className={tab === "shots" ? "active" : ""} onClick={() => setTab("shots")}>Shots</button>
      </div>

      {scanning && (
        <div className="status-panel">
          <div>{status}</div>
          <div>{progressText} ({progress.current}/{progress.total})</div>
        </div>
      )}

      {tab === "files" && (
        <div className="list-panel">
          <div className="row-actions">
            <button onClick={handleScan} disabled={!props.dbInitialized || scanning}>+ Scan Folder</button>
            <button onClick={handleRescanAll} disabled={!props.dbInitialized || scanning || props.folders.length === 0}>Rescan All</button>
          </div>
          {props.folders.map((folder) => (
            <div
              key={folder.id}
              className={`list-item ${props.currentFolderId === folder.id ? "selected" : ""}`}
              onClick={() => props.onFolderSelect(folder.id)}
            >
              <div>
                <div>{folder.name}</div>
                <small>{folder.asset_count} assets</small>
              </div>
              <button
                onClick={async (e) => {
                  e.stopPropagation();
                  if (!window.confirm(`Delete folder "${folder.name}"?`)) return;
                  await dbDeleteFolder(folder.id);
                  await props.onAssetsUpdated();
                }}
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      )}

      {tab === "tags" && (
        <div className="list-panel">
          <div className="inline-form">
            <input value={newTagName} onChange={(e) => setNewTagName(e.target.value)} placeholder="Tag name" />
            <input type="color" value={newTagColor} onChange={(e) => setNewTagColor(e.target.value)} />
            <button
              onClick={async () => {
                if (!newTagName.trim()) return;
                await dbCreateTag(newTagName.trim(), newTagColor);
                setNewTagName("");
                await loadTaxonomy();
              }}
            >
              Add
            </button>
          </div>
          {tags.map((tag) => (
            <div
              key={tag.id}
              className={`list-item ${props.activeTagFilters.includes(tag.id) ? "selected" : ""}`}
              onClick={() => {
                if (props.activeTagFilters.includes(tag.id)) {
                  props.onTagFilterChange(props.activeTagFilters.filter((id) => id !== tag.id));
                } else {
                  props.onTagFilterChange([...props.activeTagFilters, tag.id]);
                }
              }}
            >
              <div className="tag-main">
                <input
                  type="color"
                  value={tag.color ?? "#8a8e7a"}
                  onClick={(e) => e.stopPropagation()}
                  onChange={async (e) => {
                    await dbUpdateTag(tag.id, tag.name, e.target.value);
                    await loadTaxonomy();
                  }}
                />
                <span>{tag.name}</span>
                <small>{tag.count}</small>
              </div>
              <button
                onClick={async (e) => {
                  e.stopPropagation();
                  await dbDeleteTag(tag.id);
                  props.onTagFilterChange(props.activeTagFilters.filter((id) => id !== tag.id));
                  await loadTaxonomy();
                }}
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      )}

      {tab === "shots" && (
        <div className="list-panel">
          <div className="inline-form">
            <input value={newShotName} onChange={(e) => setNewShotName(e.target.value)} placeholder="Shot" />
            <input value={newShotSeq} onChange={(e) => setNewShotSeq(e.target.value)} placeholder="Sequence" />
            <button
              onClick={async () => {
                if (!newShotName.trim()) return;
                await dbCreateShot(newShotName.trim(), newShotSeq.trim() || undefined);
                setNewShotName("");
                setNewShotSeq("");
                await loadTaxonomy();
              }}
            >
              Add
            </button>
          </div>
          {shots.map((shot) => (
            <div
              key={shot.id}
              className={`list-item ${props.activeShotFilter === shot.id ? "selected" : ""}`}
              onClick={() => props.onShotFilterChange(props.activeShotFilter === shot.id ? null : shot.id)}
            >
              <div>
                <div>{shot.sequence ? `${shot.sequence} / ` : ""}{shot.name}</div>
                <small>{shot.status}</small>
              </div>
              <button
                onClick={async (e) => {
                  e.stopPropagation();
                  await dbDeleteShot(shot.id);
                  if (props.activeShotFilter === shot.id) props.onShotFilterChange(null);
                  await loadTaxonomy();
                }}
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
