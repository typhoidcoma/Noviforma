import { Component, createSignal, For, onCleanup, Show } from 'solid-js';
import { dbScanDirectory, dbGenerateThumbnails, dbClearAllAssets, dbGetFolder, dbDeleteFolder, type Folder } from '../lib/database';
import { listen } from '@tauri-apps/api/event';
import { ProgressBar } from './ProgressBar';
import { Modal } from './Modal';
import './ProjectBrowser.css';

interface ProjectBrowserProps {
  dbInitialized: boolean;
  folders: Folder[];
  currentFolderId: number | null;
  onFolderSelect: (folderId: number) => void;
  onAssetsUpdated: () => void;
}

interface ThumbnailProgress {
  current: number;
  total: number;
  message: string;
}

const ProjectBrowser: Component<ProjectBrowserProps> = (props) => {
  const [activeTab, setActiveTab] = createSignal<'files' | 'tags' | 'shots'>('files');
  const [scanning, setScanning] = createSignal(false);
  const [generatingThumbs, setGeneratingThumbs] = createSignal(false);
  const [scanProgress, setScanProgress] = createSignal('');
  const [thumbProgress, setThumbProgress] = createSignal<ThumbnailProgress | null>(null);

  // Listen for thumbnail progress events
  const unsubscribe = listen<ThumbnailProgress>('thumbnail-progress', (event) => {
    setThumbProgress(event.payload);
    setScanProgress(`${event.payload.message} (${event.payload.current}/${event.payload.total})`);
  });

  onCleanup(async () => {
    (await unsubscribe)();
  });

  const mockTags = [
    { name: 'Approved', count: 45, color: '#6c6' },
    { name: 'Review', count: 23, color: '#fc6' },
    { name: 'Rejected', count: 12, color: '#e74c3c' },
    { name: 'Hero', count: 8, color: '#4a90e2' },
    { name: 'WIP', count: 156, color: '#999' },
  ];

  const mockShots = [
    { name: 'SH010', tasks: 5, status: 'active' },
    { name: 'SH020', tasks: 3, status: 'review' },
    { name: 'SH030', tasks: 8, status: 'active' },
  ];

  const handleClearDatabase = async () => {
    if (!props.dbInitialized) return;

    const confirmed = confirm('Are you sure you want to clear all assets from the database?');
    if (!confirmed) return;

    try {
      const deleted = await dbClearAllAssets();
      console.log(`Cleared ${deleted} assets from database`);

      // Notify parent to reload (will show empty state)
      await props.onAssetsUpdated();

      alert(`Database cleared: ${deleted} assets removed`);
    } catch (error) {
      console.error('Failed to clear database:', error);
      alert(`Failed to clear database: ${error}`);
    }
  };

  const handleDeleteFolder = async (folderId: number, folderName: string, e: MouseEvent) => {
    e.stopPropagation(); // Prevent folder selection when clicking delete

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

      // Refresh folder list and assets
      await props.onAssetsUpdated();

      alert(`Folder "${folderName}" deleted successfully.`);
    } catch (error) {
      console.error('Failed to delete folder:', error);
      alert(`Failed to delete folder: ${error}`);
    }
  };

  const handleScanDirectory = async () => {
    if (!props.dbInitialized || scanning()) return;

    // For now, use a hardcoded path - you can add a file picker later
    const directoryPath = prompt('Enter directory path to scan:');
    if (!directoryPath) return;

    setScanning(true);
    setScanProgress('Scanning directory...');

    try {
      console.log('Scanning directory:', directoryPath);
      const result = await dbScanDirectory(directoryPath);
      console.log(`Scan complete: ${result.indexed} indexed, ${result.errors} errors`);

      // Generate thumbnails after scanning
      setScanning(false);
      setGeneratingThumbs(true);
      setThumbProgress({ current: 0, total: result.indexed, message: 'Starting...' });
      setScanProgress(`Generating thumbnails for ${result.indexed} assets...`);

      console.log('Generating thumbnails...');
      const thumbResult = await dbGenerateThumbnails();
      console.log(`Thumbnails: ${thumbResult.generated} generated, ${thumbResult.skipped} skipped`);
      setThumbProgress(null);

      setScanProgress('Loading assets...');

      // Notify parent to reload assets
      await props.onAssetsUpdated();

      // Get current folder info
      const { dbGetCurrentFolder } = await import('../lib/database');
      const currentFolderId = await dbGetCurrentFolder();
      const folder = currentFolderId ? await dbGetFolder(currentFolderId) : null;

      setScanProgress('');

      // Show helpful message based on what was found
      let message = `Scan complete!\n\n`;
      if (result.indexed > 0) {
        message += `📥 ${result.indexed} new assets indexed\n`;
      } else {
        message += `✓ No new assets found (folder already scanned)\n`;
      }
      message += `🖼️ ${thumbResult.generated} thumbnails generated, ${thumbResult.skipped} skipped\n`;
      if (folder) {
        message += `📂 Folder: ${folder.name}\n`;
        message += `📊 Total assets in folder: ${folder.asset_count}`;
      }

      alert(message);
    } catch (error) {
      console.error('Scan failed:', error);
      alert(`Scan failed: ${error}`);
      setScanProgress('');
    } finally {
      setScanning(false);
      setGeneratingThumbs(false);
    }
  };

  return (
    <div class="project-browser">
      {/* Progress Modal - shown during scanning/thumbnail generation */}
      <Modal show={scanning() || generatingThumbs()} closeOnOverlayClick={false}>
        <div style="text-align: center;">
          {!thumbProgress() && (
            <div style="margin-bottom: 16px; color: #e0e0e0; font-size: 14px;">
              {scanProgress()}
            </div>
          )}

          <Show when={thumbProgress()}>
            <ProgressBar
              current={thumbProgress()!.current}
              total={thumbProgress()!.total}
              message={thumbProgress()!.message}
              showPercentage={true}
            />
          </Show>

          {!thumbProgress() && (
            <div style="margin-top: 12px; font-size: 0.9em; color: #888;">
              This may take a moment...
            </div>
          )}
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

                      {/* Delete button - shown on hover */}
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
              <button class="btn-add" title="Create Tag">+</button>
            </div>
            <div class="tag-list-browser">
              <For each={mockTags}>
                {(tag) => (
                  <div class="tag-item">
                    <div class="tag-color" style={{ 'background-color': tag.color }} />
                    <span class="tag-name">{tag.name}</span>
                    <span class="tag-count">{tag.count}</span>
                  </div>
                )}
              </For>
            </div>
            <div class="placeholder-text">
              (M3 - Tag system pending)
            </div>
          </div>
        )}

        {activeTab() === 'shots' && (
          <div class="shots-panel">
            <div class="section-header">
              <h4>Shots</h4>
              <button class="btn-add" title="Create Shot">+</button>
            </div>
            <div class="shot-list">
              <For each={mockShots}>
                {(shot) => (
                  <div class="shot-item">
                    <div class="shot-header">
                      <span class="shot-name">{shot.name}</span>
                      <span class={`shot-status status-${shot.status}`}>
                        {shot.status}
                      </span>
                    </div>
                    <div class="shot-info">
                      <span class="shot-tasks">{shot.tasks} tasks</span>
                    </div>
                  </div>
                )}
              </For>
            </div>
            <div class="placeholder-text">
              (M3 - Shot system pending)
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
        <button
          class="btn-footer"
          onClick={handleClearDatabase}
          disabled={!props.dbInitialized || scanning()}
          style="margin-top: 4px; background: #6d2a2a;"
          title="Clear all assets from database"
        >
          <span>🗑</span> Clear All
        </button>
      </div>
    </div>
  );
};

export default ProjectBrowser;
