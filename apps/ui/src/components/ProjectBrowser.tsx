import { Component, createSignal, createEffect, For, onCleanup, Show } from 'solid-js';
import {
  dbScanDirectory, dbGenerateThumbnails, dbDeleteFolder, dbGetThumbnailProgress,
  dbGetAllTagsWithCounts, dbCreateTag, dbDeleteTag,
  dbGetAllShots, dbCreateShot, dbDeleteShot,
  type Folder, type TagWithCount, type Shot,
} from '../lib/database';
import { Modal } from './Modal';
import './ProjectBrowser.css';

interface ProjectBrowserProps {
  dbInitialized: boolean;
  folders: Folder[];
  currentFolderId: number | null;
  onFolderSelect: (folderId: number) => void;
  onAssetsUpdated: () => void;
  onTagFilterChange: (tagIds: number[]) => void;
  onShotFilterChange: (shotId: number | null) => void;
  activeTagFilters: number[];
  activeShotFilter: number | null;
}

const ProjectBrowser: Component<ProjectBrowserProps> = (props) => {
  const [activeTab, setActiveTab] = createSignal<'files' | 'tags' | 'shots'>('files');
  const [scanning, setScanning] = createSignal(false);
  const [generatingThumbs, setGeneratingThumbs] = createSignal(false);
  const [progressCurrent, setProgressCurrent] = createSignal(0);
  const [progressTotal, setProgressTotal] = createSignal(0);
  const [scanComplete, setScanComplete] = createSignal<string | null>(null);
  const [statusText, setStatusText] = createSignal('');

  // Tag state
  const [tags, setTags] = createSignal<TagWithCount[]>([]);
  const [showCreateTag, setShowCreateTag] = createSignal(false);
  const [newTagName, setNewTagName] = createSignal('');
  const [newTagColor, setNewTagColor] = createSignal('#5AB6C6');

  // Shot state
  const [shots, setShots] = createSignal<Shot[]>([]);
  const [showCreateShot, setShowCreateShot] = createSignal(false);
  const [newShotName, setNewShotName] = createSignal('');
  const [newShotSequence, setNewShotSequence] = createSignal('');

  let pollInterval: number | null = null;

  const startPolling = () => {
    stopPolling();
    pollInterval = window.setInterval(async () => {
      try {
        const progress = await dbGetThumbnailProgress();
        setProgressCurrent(progress.current);
        setProgressTotal(progress.total);
      } catch {
        // Ignore polling errors
      }
    }, 200);
  };

  const stopPolling = () => {
    if (pollInterval !== null) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
  };

  onCleanup(() => {
    stopPolling();
  });

  createEffect(() => {
    const complete = scanComplete();
    if (complete) {
      setTimeout(() => {
        setGeneratingThumbs(false);
        setScanComplete(null);
      }, 2000);
    }
  });

  const percentage = () => {
    const total = progressTotal();
    if (total === 0) return 0;
    return Math.round((progressCurrent() / total) * 100);
  };

  // Load tags when db is initialized
  const loadTags = async () => {
    try {
      const allTags = await dbGetAllTagsWithCounts();
      setTags(allTags);
    } catch (error) {
      console.error('Failed to load tags:', error);
    }
  };

  // Load shots when db is initialized
  const loadShots = async () => {
    try {
      const allShots = await dbGetAllShots();
      setShots(allShots);
    } catch (error) {
      console.error('Failed to load shots:', error);
    }
  };

  createEffect(() => {
    if (props.dbInitialized) {
      loadTags();
      loadShots();
    }
  });

  // Tag handlers
  const handleCreateTag = async () => {
    if (!newTagName().trim()) return;
    try {
      await dbCreateTag(newTagName().trim(), newTagColor());
      setNewTagName('');
      setShowCreateTag(false);
      await loadTags();
    } catch (error) {
      console.error('Failed to create tag:', error);
    }
  };

  const handleDeleteTag = async (tagId: number, e: MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Delete this tag?')) return;
    try {
      await dbDeleteTag(tagId);
      props.onTagFilterChange(props.activeTagFilters.filter(id => id !== tagId));
      await loadTags();
    } catch (error) {
      console.error('Failed to delete tag:', error);
    }
  };

  const handleTagClick = (tagId: number) => {
    const current = props.activeTagFilters;
    if (current.includes(tagId)) {
      props.onTagFilterChange(current.filter(id => id !== tagId));
    } else {
      props.onTagFilterChange([...current, tagId]);
    }
  };

  // Shot handlers
  const handleCreateShot = async () => {
    if (!newShotName().trim()) return;
    try {
      await dbCreateShot(newShotName().trim(), newShotSequence().trim() || undefined);
      setNewShotName('');
      setNewShotSequence('');
      setShowCreateShot(false);
      await loadShots();
    } catch (error) {
      console.error('Failed to create shot:', error);
    }
  };

  const handleDeleteShot = async (shotId: number, e: MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Delete this shot?')) return;
    try {
      await dbDeleteShot(shotId);
      if (props.activeShotFilter === shotId) {
        props.onShotFilterChange(null);
      }
      await loadShots();
    } catch (error) {
      console.error('Failed to delete shot:', error);
    }
  };

  const handleShotClick = (shotId: number) => {
    if (props.activeShotFilter === shotId) {
      props.onShotFilterChange(null);
    } else {
      props.onShotFilterChange(shotId);
    }
  };

  // Folder handlers
  const handleDeleteFolder = async (folderId: number, folderName: string, e: MouseEvent) => {
    e.stopPropagation();
    if (!props.dbInitialized) return;

    const confirmed = confirm(
      `Delete folder "${folderName}"?\n\n` +
      `This will remove:\n` +
      `• The folder from the project list\n` +
      `• All assets in this folder\n` +
      `• All thumbnail caches\n\n` +
      `This action cannot be undone.`
    );

    if (!confirmed) return;

    try {
      await dbDeleteFolder(folderId);
      console.log(`Deleted folder ${folderId}: ${folderName}`);
      await props.onAssetsUpdated();
    } catch (error) {
      console.error('Failed to delete folder:', error);
      alert(`Failed to delete folder: ${error}`);
    }
  };

  const handleScanDirectory = async () => {
    if (!props.dbInitialized || scanning()) return;

    setScanComplete(null);
    setProgressCurrent(0);
    setProgressTotal(0);

    const directoryPath = prompt('Enter directory path to scan:');
    if (!directoryPath) return;

    setScanning(true);
    setStatusText('Scanning directory...');

    try {
      console.log('Scanning directory:', directoryPath);
      const result = await dbScanDirectory(directoryPath);
      console.log(`Scan complete: ${result.indexed} indexed, ${result.errors} errors`);

      setScanning(false);
      setGeneratingThumbs(true);
      setStatusText('Generating thumbnails...');

      startPolling();

      console.log('Generating thumbnails...');
      const thumbResult = await dbGenerateThumbnails();
      console.log(`Thumbnails: ${thumbResult.generated} generated, ${thumbResult.skipped} skipped`);

      stopPolling();

      const finalProgress = await dbGetThumbnailProgress();
      setProgressCurrent(finalProgress.current);
      setProgressTotal(finalProgress.total);

      await props.onAssetsUpdated();
      // Also reload tags (counts may have changed)
      await loadTags();

      const msg = result.indexed > 0
        ? `${result.indexed} assets indexed, ${thumbResult.generated} thumbnails generated`
        : `No new assets found (${thumbResult.skipped} already cached)`;
      setScanComplete(msg);

    } catch (error) {
      console.error('Scan failed:', error);
      stopPolling();
      alert(`Scan failed: ${error}`);
      setScanning(false);
      setGeneratingThumbs(false);
    }
  };

  return (
    <div class="project-browser">
      {/* Progress Modal */}
      <Modal show={scanning() || generatingThumbs()} closeOnOverlayClick={false}>
        <div style="text-align: center;">
          <Show when={scanComplete()}>
            <div style="color: #6c6; font-size: 16px; margin-bottom: 8px;">
              Scan complete
            </div>
            <div style="color: #E1E5C9; font-size: 13px;">
              {scanComplete()}
            </div>
          </Show>

          <Show when={!scanComplete()}>
            <Show when={scanning()}>
              <div style="color: #E2FEFD; font-size: 14px; margin-bottom: 12px;">
                {statusText()}
              </div>
              <div style="font-size: 0.9em; color: #8a8e7a;">
                This may take a moment...
              </div>
            </Show>

            <Show when={generatingThumbs()}>
              <div style="color: #E2FEFD; font-size: 14px; margin-bottom: 16px;">
                Generating thumbnails...
              </div>
              <div style="font-size: 36px; font-weight: bold; color: #5AB6C6; margin-bottom: 8px;">
                {percentage()}%
              </div>
              <div style="font-size: 13px; color: #8a8e7a;">
                {progressCurrent()} / {progressTotal()} assets
              </div>
            </Show>
          </Show>
        </div>
      </Modal>

      <div class="browser-header">
        <h3>Project</h3>
        <button class="btn-icon" title="Project Settings">⚙</button>
      </div>

      <div class="browser-tabs">
        <button
          class={`tab ${activeTab() === 'files' ? 'active' : ''}`}
          onClick={() => setActiveTab('files')}
        >
          Files
        </button>
        <button
          class={`tab ${activeTab() === 'tags' ? 'active' : ''}`}
          onClick={() => setActiveTab('tags')}
        >
          Tags
        </button>
        <button
          class={`tab ${activeTab() === 'shots' ? 'active' : ''}`}
          onClick={() => setActiveTab('shots')}
        >
          Shots
        </button>
      </div>

      <div class="browser-content">
        {activeTab() === 'files' && (
          <div class="files-panel">
            <div class="section-header">
              <h4>Scanned Folders</h4>
              <button
                class="btn-add"
                title="Scan Folder"
                onClick={handleScanDirectory}
                disabled={!props.dbInitialized || scanning()}
              >
                +
              </button>
            </div>
            <div class="folder-list">
              <Show
                when={props.folders.length > 0}
                fallback={
                  <div class="placeholder-text">
                    No folders scanned yet. Click + to scan a directory.
                  </div>
                }
              >
                <For each={props.folders}>
                  {(folder) => (
                    <div
                      class="folder-item"
                      classList={{ active: folder.id === props.currentFolderId }}
                      onClick={() => props.onFolderSelect(folder.id)}
                      title={folder.path}
                    >
                      <div class="folder-icon">📁</div>
                      <div class="folder-info">
                        <div class="folder-name">{folder.name}</div>
                        <div class="folder-stats">{folder.asset_count} assets</div>
                      </div>

                      <button
                        class="btn-delete-folder"
                        onClick={(e) => handleDeleteFolder(folder.id, folder.name, e)}
                        title="Delete folder"
                      >
                        🗑
                      </button>
                    </div>
                  )}
                </For>
              </Show>
            </div>
          </div>
        )}

        {activeTab() === 'tags' && (
          <div class="tags-panel">
            <div class="section-header">
              <h4>All Tags</h4>
              <button class="btn-add" title="Create Tag" onClick={() => setShowCreateTag(!showCreateTag())}>+</button>
            </div>

            <Show when={showCreateTag()}>
              <div class="tag-create-form">
                <input
                  type="text"
                  class="tag-name-input"
                  placeholder="Tag name..."
                  value={newTagName()}
                  onInput={(e) => setNewTagName(e.currentTarget.value)}
                />
                <input
                  type="color"
                  class="tag-color-input"
                  value={newTagColor()}
                  onInput={(e) => setNewTagColor(e.currentTarget.value)}
                />
                <button class="btn-add" onClick={handleCreateTag}>OK</button>
              </div>
            </Show>

            <div class="tag-list-browser">
              <Show
                when={tags().length > 0}
                fallback={
                  <div class="placeholder-text">
                    No tags yet. Click + to create one.
                  </div>
                }
              >
                <For each={tags()}>
                  {(tag) => (
                    <div
                      class="tag-item"
                      classList={{ active: props.activeTagFilters.includes(tag.id) }}
                      onClick={() => handleTagClick(tag.id)}
                    >
                      <div class="tag-color" style={{ 'background-color': tag.color || '#8a8e7a' }} />
                      <span class="tag-name">{tag.name}</span>
                      <span class="tag-count">{tag.count}</span>
                      <button class="btn-delete-tag" onClick={(e) => handleDeleteTag(tag.id, e)}>×</button>
                    </div>
                  )}
                </For>
              </Show>
            </div>
          </div>
        )}

        {activeTab() === 'shots' && (
          <div class="shots-panel">
            <div class="section-header">
              <h4>Shots</h4>
              <button class="btn-add" title="Create Shot" onClick={() => setShowCreateShot(!showCreateShot())}>+</button>
            </div>

            <Show when={showCreateShot()}>
              <div class="shot-create-form">
                <input
                  type="text"
                  class="tag-name-input"
                  placeholder="Shot name..."
                  value={newShotName()}
                  onInput={(e) => setNewShotName(e.currentTarget.value)}
                />
                <input
                  type="text"
                  class="tag-name-input"
                  placeholder="Sequence..."
                  value={newShotSequence()}
                  onInput={(e) => setNewShotSequence(e.currentTarget.value)}
                  style={{ width: '80px', flex: 'none' }}
                />
                <button class="btn-add" onClick={handleCreateShot}>OK</button>
              </div>
            </Show>

            <div class="shot-list">
              <Show
                when={shots().length > 0}
                fallback={
                  <div class="placeholder-text">
                    No shots yet. Click + to create one.
                  </div>
                }
              >
                <For each={shots()}>
                  {(shot) => (
                    <div
                      class="shot-item"
                      classList={{ active: props.activeShotFilter === shot.id }}
                      onClick={() => handleShotClick(shot.id)}
                    >
                      <div class="shot-header">
                        <span class="shot-name">
                          {shot.sequence ? `${shot.sequence} / ` : ''}{shot.name}
                        </span>
                        <span class={`shot-status status-${shot.status}`}>
                          {shot.status}
                        </span>
                      </div>
                      <button class="btn-delete-tag" onClick={(e) => handleDeleteShot(shot.id, e)}>×</button>
                    </div>
                  )}
                </For>
              </Show>
            </div>
          </div>
        )}
      </div>

      <div class="browser-footer">
        <button
          class="btn-footer"
          onClick={handleScanDirectory}
          disabled={!props.dbInitialized || scanning()}
          title="Scan a directory for images"
        >
          <span>⟳</span> Scan Assets
        </button>
      </div>
    </div>
  );
};

export default ProjectBrowser;
