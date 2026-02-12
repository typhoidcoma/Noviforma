import { Component, Show, For, createSignal, createEffect, on } from 'solid-js';
import {
  dbGetAssetTags, dbGetAllTags, dbAddTagToAsset, dbRemoveTagFromAsset,
  dbGetAssetNote, dbSetAssetNote,
  dbGetAssetRating, dbSetAssetRating,
  dbGetAssetShots, dbAddAssetToShot, dbRemoveAssetFromShot,
  type Asset, type Tag, type Shot,
} from '../lib/database';
import { getAssetUrl } from '../lib/asset-urls';
import './Inspector.css';

interface InspectorProps {
  selectedAssets: Asset[];
  totalAssets: number;
  onTagsChanged: () => void;
  onShotAssigned: () => void;
  allShots: Shot[];
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

const Inspector: Component<InspectorProps> = (props) => {
  // Preview zoom/pan
  const [zoom, setZoom] = createSignal(1);
  const [panX, setPanX] = createSignal(0);
  const [panY, setPanY] = createSignal(0);
  let isPanning = false;
  let lastMouseX = 0;
  let lastMouseY = 0;

  // Single-select data
  const [assetTags, setAssetTags] = createSignal<Tag[]>([]);
  const [allTags, setAllTags] = createSignal<Tag[]>([]);
  const [noteContent, setNoteContent] = createSignal('');
  const [rating, setRating] = createSignal(0);
  const [assetShots, setAssetShots] = createSignal<Shot[]>([]);

  // UI toggles
  const [showTagPicker, setShowTagPicker] = createSignal(false);
  const [showShotPicker, setShowShotPicker] = createSignal(false);
  const [showBatchTagPicker, setShowBatchTagPicker] = createSignal(false);
  const [showBatchShotPicker, setShowBatchShotPicker] = createSignal(false);

  // Track which asset the note belongs to (prevent stale saves)
  let noteAssetId: number | null = null;

  // Reset zoom/pan when selection changes
  createEffect(() => {
    const _assets = props.selectedAssets;
    setZoom(1);
    setPanX(0);
    setPanY(0);
    setShowTagPicker(false);
    setShowShotPicker(false);
    setShowBatchTagPicker(false);
    setShowBatchShotPicker(false);
  });

  // Load data when single asset is selected
  createEffect(on(
    () => props.selectedAssets.length === 1 ? props.selectedAssets[0].id : null,
    async (assetId) => {
      if (assetId === null) {
        setAssetTags([]);
        setNoteContent('');
        setRating(0);
        setAssetShots([]);
        noteAssetId = null;
        return;
      }
      noteAssetId = assetId;
      try {
        const [tags, allTagsList, note, ratingData, shots] = await Promise.all([
          dbGetAssetTags(assetId),
          dbGetAllTags(),
          dbGetAssetNote(assetId),
          dbGetAssetRating(assetId),
          dbGetAssetShots(assetId),
        ]);
        setAssetTags(tags);
        setAllTags(allTagsList);
        setNoteContent(note?.content ?? '');
        setRating(ratingData?.rating ?? 0);
        setAssetShots(shots);
      } catch (error) {
        console.error('Failed to load asset data:', error);
      }
    },
    { defer: true }
  ));

  // Load all tags when batch mode activates
  createEffect(on(
    () => props.selectedAssets.length > 1,
    async (isMulti) => {
      if (isMulti) {
        try {
          const tags = await dbGetAllTags();
          setAllTags(tags);
        } catch (error) {
          console.error('Failed to load tags for batch:', error);
        }
      }
    },
    { defer: true }
  ));

  // Unassigned tags for picker
  const unassignedTags = () => {
    const assigned = new Set(assetTags().map(t => t.id));
    return allTags().filter(t => !assigned.has(t.id));
  };

  // Unassigned shots for picker
  const unassignedShots = () => {
    const assigned = new Set(assetShots().map(s => s.id));
    return props.allShots.filter(s => !assigned.has(s.id));
  };

  // --- Tag handlers ---
  const handleAddTag = async (tagId: number) => {
    const asset = props.selectedAssets[0];
    if (!asset) return;
    try {
      await dbAddTagToAsset(asset.id, tagId);
      const [tags, allTagsList] = await Promise.all([
        dbGetAssetTags(asset.id),
        dbGetAllTags(),
      ]);
      setAssetTags(tags);
      setAllTags(allTagsList);
      props.onTagsChanged();
    } catch (error) {
      console.error('Failed to add tag:', error);
    }
  };

  const handleRemoveTag = async (tagId: number) => {
    const asset = props.selectedAssets[0];
    if (!asset) return;
    try {
      await dbRemoveTagFromAsset(asset.id, tagId);
      const tags = await dbGetAssetTags(asset.id);
      setAssetTags(tags);
      props.onTagsChanged();
    } catch (error) {
      console.error('Failed to remove tag:', error);
    }
  };

  // --- Note handler ---
  const handleNoteSave = async () => {
    if (noteAssetId === null) return;
    const assetId = noteAssetId;
    try {
      await dbSetAssetNote(assetId, noteContent());
    } catch (error) {
      console.error('Failed to save note:', error);
    }
  };

  // --- Rating handler ---
  const handleRating = async (star: number) => {
    const asset = props.selectedAssets[0];
    if (!asset) return;
    const newRating = star === rating() ? 0 : star;
    try {
      await dbSetAssetRating(asset.id, newRating);
      setRating(newRating);
      props.onTagsChanged(); // triggers re-filter in case rating filter is active
    } catch (error) {
      console.error('Failed to set rating:', error);
    }
  };

  // --- Shot handlers ---
  const handleAssignShot = async (shotId: number) => {
    const asset = props.selectedAssets[0];
    if (!asset) return;
    try {
      await dbAddAssetToShot(shotId, asset.id);
      const shots = await dbGetAssetShots(asset.id);
      setAssetShots(shots);
      props.onShotAssigned();
    } catch (error) {
      console.error('Failed to assign shot:', error);
    }
  };

  const handleRemoveShot = async (shotId: number) => {
    const asset = props.selectedAssets[0];
    if (!asset) return;
    try {
      await dbRemoveAssetFromShot(shotId, asset.id);
      const shots = await dbGetAssetShots(asset.id);
      setAssetShots(shots);
      props.onShotAssigned();
    } catch (error) {
      console.error('Failed to remove shot:', error);
    }
  };

  // --- Batch handlers ---
  const handleBatchAddTag = async (tagId: number) => {
    try {
      await Promise.all(
        props.selectedAssets.map(a => dbAddTagToAsset(a.id, tagId))
      );
      setShowBatchTagPicker(false);
      props.onTagsChanged();
    } catch (error) {
      console.error('Failed to batch add tag:', error);
    }
  };

  const handleBatchAssignShot = async (shotId: number) => {
    try {
      await Promise.all(
        props.selectedAssets.map(a => dbAddAssetToShot(shotId, a.id))
      );
      setShowBatchShotPicker(false);
      props.onShotAssigned();
    } catch (error) {
      console.error('Failed to batch assign shot:', error);
    }
  };

  // --- Zoom/pan handlers ---
  const handleWheel = (e: WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    const newZoom = Math.min(Math.max(zoom() * factor, 1), 20);
    if (newZoom === 1) {
      setPanX(0);
      setPanY(0);
    }
    setZoom(newZoom);
  };

  const handleMouseDown = (e: MouseEvent) => {
    if (zoom() <= 1) return;
    isPanning = true;
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
    (e.currentTarget as HTMLElement).style.cursor = 'grabbing';
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isPanning) return;
    const dx = e.clientX - lastMouseX;
    const dy = e.clientY - lastMouseY;
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
    setPanX(panX() + dx);
    setPanY(panY() + dy);
  };

  const handleMouseUp = (e: MouseEvent) => {
    isPanning = false;
    (e.currentTarget as HTMLElement).style.cursor = zoom() > 1 ? 'grab' : '';
  };

  return (
    <div class="inspector">
      <div class="inspector-header">
        <h3>Inspector</h3>
      </div>

      <Show when={props.selectedAssets.length === 0}>
        <div class="inspector-empty">
          <p>No assets selected</p>
          <p class="inspector-hint">
            Click tiles to select assets
          </p>
        </div>
      </Show>

      <Show when={props.selectedAssets.length === 1}>
        {(() => {
          const asset = props.selectedAssets[0];
          return (
            <div class="inspector-single">
              <div
                class="inspector-preview"
                onWheel={handleWheel}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                style={{ cursor: zoom() > 1 ? 'grab' : 'default' }}
              >
                <Show when={asset.path} fallback={
                  <div class="inspector-preview-empty">No preview</div>
                }>
                  <img
                    src={getAssetUrl(asset.path)}
                    alt={asset.filename}
                    class="inspector-preview-img"
                    style={{
                      transform: `scale(${zoom()}) translate(${panX() / zoom()}px, ${panY() / zoom()}px)`,
                    }}
                    draggable={false}
                  />
                </Show>
              </div>

              {/* Star Rating */}
              <div class="inspector-rating">
                <For each={[1, 2, 3, 4, 5]}>
                  {(star) => (
                    <button
                      class={`star ${star <= rating() ? 'filled' : ''}`}
                      onClick={() => handleRating(star)}
                      title={`${star} star${star > 1 ? 's' : ''}`}
                    >
                      {star <= rating() ? '\u2605' : '\u2606'}
                    </button>
                  )}
                </For>
              </div>

              <div class="inspector-section">
                <h4>Asset Details</h4>
                <div class="inspector-field">
                  <label>Filename:</label>
                  <span title={asset.filename}>{asset.filename}</span>
                </div>
                <div class="inspector-field">
                  <label>Path:</label>
                  <span title={asset.path} style="font-size: 10px; word-break: break-all;">
                    {asset.path}
                  </span>
                </div>
                <div class="inspector-field">
                  <label>ID:</label>
                  <span>{asset.id}</span>
                </div>
              </div>

              <div class="inspector-section">
                <h4>Metadata</h4>
                <div class="inspector-field">
                  <label>Resolution:</label>
                  <span>{asset.width && asset.height ? `${asset.width} \u00d7 ${asset.height} px` : '--'}</span>
                </div>
                <div class="inspector-field">
                  <label>Format:</label>
                  <span>{asset.path?.split('.').pop()?.toUpperCase() || 'Unknown'}</span>
                </div>
                <div class="inspector-field">
                  <label>Size:</label>
                  <span>{asset.file_size ? formatBytes(asset.file_size) : '--'}</span>
                </div>
              </div>

              {/* Tags */}
              <div class="inspector-section">
                <h4>Tags</h4>
                <div class="tag-list">
                  <Show when={assetTags().length > 0} fallback={
                    <span class="tag-empty">No tags</span>
                  }>
                    <For each={assetTags()}>
                      {(tag) => (
                        <span
                          class="tag"
                          style={{ 'border-left': `3px solid ${tag.color || '#8a8e7a'}` }}
                        >
                          {tag.name}
                          <button
                            class="tag-remove"
                            onClick={() => handleRemoveTag(tag.id)}
                            title="Remove tag"
                          >
                            \u00d7
                          </button>
                        </span>
                      )}
                    </For>
                  </Show>
                </div>

                <button
                  class="btn-add-tag"
                  onClick={() => setShowTagPicker(!showTagPicker())}
                >
                  {showTagPicker() ? 'Cancel' : '+ Add Tag'}
                </button>

                <Show when={showTagPicker()}>
                  <div class="tag-picker-dropdown">
                    <Show when={unassignedTags().length > 0} fallback={
                      <div class="picker-empty">No more tags available</div>
                    }>
                      <For each={unassignedTags()}>
                        {(tag) => (
                          <div
                            class="tag-picker-item"
                            onClick={() => handleAddTag(tag.id)}
                          >
                            <div class="tag-color" style={{ 'background-color': tag.color || '#8a8e7a' }} />
                            <span>{tag.name}</span>
                          </div>
                        )}
                      </For>
                    </Show>
                  </div>
                </Show>
              </div>

              {/* Notes */}
              <div class="inspector-section">
                <h4>Notes</h4>
                <textarea
                  class="notes-input"
                  placeholder="Add notes about this asset..."
                  rows="4"
                  value={noteContent()}
                  onInput={(e) => setNoteContent(e.currentTarget.value)}
                  onBlur={handleNoteSave}
                />
              </div>

              {/* Shot Assignments */}
              <div class="inspector-section">
                <h4>Shots</h4>
                <Show when={assetShots().length > 0}>
                  <div class="shot-assignment-list">
                    <For each={assetShots()}>
                      {(shot) => (
                        <div class="shot-assignment-item">
                          <span class="shot-assignment-name">
                            {shot.sequence ? `${shot.sequence} / ` : ''}{shot.name}
                          </span>
                          <button
                            class="tag-remove"
                            onClick={() => handleRemoveShot(shot.id)}
                            title="Remove from shot"
                          >
                            \u00d7
                          </button>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>

                <button
                  class="btn-add-tag"
                  onClick={() => setShowShotPicker(!showShotPicker())}
                >
                  {showShotPicker() ? 'Cancel' : 'Assign to Shot'}
                </button>

                <Show when={showShotPicker()}>
                  <div class="tag-picker-dropdown">
                    <Show when={unassignedShots().length > 0} fallback={
                      <div class="picker-empty">No more shots available</div>
                    }>
                      <For each={unassignedShots()}>
                        {(shot) => (
                          <div
                            class="tag-picker-item"
                            onClick={() => handleAssignShot(shot.id)}
                          >
                            <span>{shot.sequence ? `${shot.sequence} / ` : ''}{shot.name}</span>
                          </div>
                        )}
                      </For>
                    </Show>
                  </div>
                </Show>
              </div>
            </div>
          );
        })()}
      </Show>

      <Show when={props.selectedAssets.length > 1}>
        <div class="inspector-multi">
          <div class="inspector-section">
            <h4>Selection</h4>
            <div class="inspector-field">
              <label>Count:</label>
              <span>{props.selectedAssets.length} assets</span>
            </div>
          </div>

          <div class="inspector-section">
            <h4>Batch Actions</h4>
            <div class="batch-actions">
              <button
                class="btn-secondary"
                onClick={() => { setShowBatchTagPicker(!showBatchTagPicker()); setShowBatchShotPicker(false); }}
              >
                {showBatchTagPicker() ? 'Cancel' : 'Add Tags'}
              </button>

              <Show when={showBatchTagPicker()}>
                <div class="tag-picker-dropdown">
                  <Show when={allTags().length > 0} fallback={
                    <div class="picker-empty">No tags available</div>
                  }>
                    <For each={allTags()}>
                      {(tag) => (
                        <div
                          class="tag-picker-item"
                          onClick={() => handleBatchAddTag(tag.id)}
                        >
                          <div class="tag-color" style={{ 'background-color': tag.color || '#8a8e7a' }} />
                          <span>{tag.name}</span>
                        </div>
                      )}
                    </For>
                  </Show>
                </div>
              </Show>

              <button
                class="btn-secondary"
                onClick={() => { setShowBatchShotPicker(!showBatchShotPicker()); setShowBatchTagPicker(false); }}
              >
                {showBatchShotPicker() ? 'Cancel' : 'Assign to Shot'}
              </button>

              <Show when={showBatchShotPicker()}>
                <div class="tag-picker-dropdown">
                  <Show when={props.allShots.length > 0} fallback={
                    <div class="picker-empty">No shots available</div>
                  }>
                    <For each={props.allShots}>
                      {(shot) => (
                        <div
                          class="tag-picker-item"
                          onClick={() => handleBatchAssignShot(shot.id)}
                        >
                          <span>{shot.sequence ? `${shot.sequence} / ` : ''}{shot.name}</span>
                        </div>
                      )}
                    </For>
                  </Show>
                </div>
              </Show>
            </div>
          </div>

          <div class="inspector-section">
            <h4>Selected Assets</h4>
            <div class="selected-list">
              <For each={props.selectedAssets.slice(0, 10)}>
                {(asset) => (
                  <div class="selected-item">
                    <span class="selected-id" title={asset.filename}>
                      {asset.filename}
                    </span>
                  </div>
                )}
              </For>
              <Show when={props.selectedAssets.length > 10}>
                <div class="selected-more">
                  +{props.selectedAssets.length - 10} more...
                </div>
              </Show>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
};

export default Inspector;
