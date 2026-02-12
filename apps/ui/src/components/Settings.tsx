import { Component, createSignal, createEffect } from 'solid-js';
import { Modal } from './Modal';
import './Settings.css';

interface SettingsProps {
  show: boolean;
  onClose: () => void;
  columns: number;
  gutter: number;
  dbPath: string;
  onApply: (columns: number, gutter: number) => void;
}

const Settings: Component<SettingsProps> = (props) => {
  // Local draft state — reset from props each time modal opens
  const [draftColumns, setDraftColumns] = createSignal(props.columns);
  const [draftGutter, setDraftGutter] = createSignal(props.gutter);

  createEffect(() => {
    if (props.show) {
      setDraftColumns(props.columns);
      setDraftGutter(props.gutter);
    }
  });

  const handleApply = () => {
    props.onApply(draftColumns(), draftGutter());
    props.onClose();
  };

  const handleCancel = () => {
    props.onClose();
  };

  return (
    <Modal show={props.show} onClose={handleCancel} closeOnOverlayClick={true}>
      <div class="settings-panel">
        <div class="settings-header">
          <h3>Settings</h3>
          <button class="settings-close" onClick={handleCancel}>&times;</button>
        </div>

        <div class="settings-section">
          <h4>Grid</h4>

          <div class="settings-row">
            <label>Columns</label>
            <div class="settings-control">
              <input
                type="number"
                class="settings-number"
                min={0}
                max={20}
                value={draftColumns()}
                onInput={(e) => {
                  const v = parseInt(e.currentTarget.value);
                  if (!isNaN(v) && v >= 0 && v <= 20) {
                    setDraftColumns(v);
                  }
                }}
              />
              <span class="settings-hint">
                {draftColumns() === 0 ? 'Auto' : `${draftColumns()} columns`}
              </span>
            </div>
          </div>

          <div class="settings-row">
            <label>Gutter</label>
            <div class="settings-control">
              <input
                type="range"
                class="settings-range"
                min={0}
                max={64}
                value={draftGutter()}
                onInput={(e) => setDraftGutter(parseInt(e.currentTarget.value))}
              />
              <span class="settings-value">{draftGutter()}px</span>
            </div>
          </div>
        </div>

        <div class="settings-section">
          <h4>Database</h4>

          <div class="settings-row">
            <label>Path</label>
            <div class="settings-control">
              <span class="settings-path">{props.dbPath}</span>
            </div>
          </div>
        </div>

        <div class="settings-footer">
          <button class="settings-btn settings-btn-cancel" onClick={handleCancel}>Cancel</button>
          <button class="settings-btn settings-btn-apply" onClick={handleApply}>Apply</button>
        </div>
      </div>
    </Modal>
  );
};

export default Settings;
