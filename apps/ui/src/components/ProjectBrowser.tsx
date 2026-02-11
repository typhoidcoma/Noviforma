import { Component, createSignal, For, onCleanup } from 'solid-js';
import { dbScanDirectory, dbGenerateThumbnails, dbClearAllAssets } from '../lib/database';
import { listen } from '@tauri-apps/api/event';
import './ProjectBrowser.css';

interface ProjectBrowserProps {
  dbInitialized: boolean;
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

      setScanProgress('');
      alert(`Scan complete!\n${result.indexed} assets indexed\n${thumbResult.generated} thumbnails generated`);
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
              <h4>Root Paths</h4>
              <button
                class="btn-add"
                title="Add Root"
                onClick={handleScanDirectory}
                disabled={!props.dbInitialized || scanning()}
              >
                +
              </button>
            </div>
            <div class="root-list">
              {scanning() || generatingThumbs() ? (
                <div class="placeholder-text">
                  <div>{scanProgress()}</div>
                  {thumbProgress() && (
                    <div style="margin-top: 8px;">
                      <div style="width: 100%; height: 4px; background: #333; border-radius: 2px; overflow: hidden;">
                        <div
                          style={{
                            width: `${(thumbProgress()!.current / thumbProgress()!.total) * 100}%`,
                            height: '100%',
                            background: '#4a90e2',
                            transition: 'width 0.2s ease',
                          }}
                        />
                      </div>
                      <div style="margin-top: 4px; font-size: 0.85em; color: #888;">
                        {thumbProgress()!.current} / {thumbProgress()!.total}
                      </div>
                    </div>
                  )}
                  <div style="margin-top: 8px; font-size: 0.9em; color: #666;">
                    This may take a moment...
                  </div>
                </div>
              ) : (
                <div class="placeholder-text">
                  Click + to scan a directory for images
                </div>
              )}
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
