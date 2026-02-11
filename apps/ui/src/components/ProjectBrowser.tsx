import { Component, createSignal, createEffect, For, onCleanup, Show } from 'solid-js';
import { dbScanDirectory, dbGenerateThumbnails, dbDeleteFolder, dbGetThumbnailProgress, type Folder } from '../lib/database';
import { Modal } from './Modal';
import './ProjectBrowser.css';

interface ProjectBrowserProps {
  dbInitialized: boolean;
  folders: Folder[];
  currentFolderId: number | null;
  onFolderSelect: (folderId: number) => void;
  onAssetsUpdated: () => void;
}

const ProjectBrowser: Component<ProjectBrowserProps> = (props) => {
  const [activeTab, setActiveTab] = createSignal<'files' | 'tags' | 'shots'>('files');
  const [scanning, setScanning] = createSignal(false);
  const [generatingThumbs, setGeneratingThumbs] = createSignal(false);
  const [progressCurrent, setProgressCurrent] = createSignal(0);
  const [progressTotal, setProgressTotal] = createSignal(0);
  const [scanComplete, setScanComplete] = createSignal<string | null>(null);
  const [statusText, setStatusText] = createSignal('');

  let pollInterval: number | null = null;

  // Start polling progress from backend
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

  // Auto-dismiss modal when scan completes
  createEffect(() => {
    const complete = scanComplete();
    if (complete) {
      setTimeout(() => {
        setGeneratingThumbs(false);
        setScanComplete(null);
      }, 2000);
    }
  });

  // Compute percentage
  const percentage = () => {
    const total = progressTotal();
    if (total === 0) return 0;
    return Math.round((progressCurrent() / total) * 100);
  };

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

      // Switch to thumbnail generation phase
      setScanning(false);
      setGeneratingThumbs(true);
      setStatusText('Generating thumbnails...');

      // Start polling backend for real progress
      startPolling();

      console.log('Generating thumbnails...');
      const thumbResult = await dbGenerateThumbnails();
      console.log(`Thumbnails: ${thumbResult.generated} generated, ${thumbResult.skipped} skipped`);

      stopPolling();

      // Final poll to get accurate numbers
      const finalProgress = await dbGetThumbnailProgress();
      setProgressCurrent(finalProgress.current);
      setProgressTotal(finalProgress.total);

      // Notify parent to reload assets
      await props.onAssetsUpdated();

      // Show completion
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
            <div style="color: #ccc; font-size: 13px;">
              {scanComplete()}
            </div>
          </Show>

          <Show when={!scanComplete()}>
            <Show when={scanning()}>
              <div style="color: #e0e0e0; font-size: 14px; margin-bottom: 12px;">
                {statusText()}
              </div>
              <div style="font-size: 0.9em; color: #888;">
                This may take a moment...
              </div>
            </Show>

            <Show when={generatingThumbs()}>
              <div style="color: #e0e0e0; font-size: 14px; margin-bottom: 16px;">
                Generating thumbnails...
              </div>
              <div style="font-size: 36px; font-weight: bold; color: #4a90e2; margin-bottom: 8px;">
                {percentage()}%
              </div>
              <div style="font-size: 13px; color: #888;">
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
      </div>
    </div>
  );
};

export default ProjectBrowser;
