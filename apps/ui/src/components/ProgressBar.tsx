import { Component, Show, createSignal, createEffect } from 'solid-js';
import './ProgressBar.css';

export interface ProgressBarProps {
  current: number;
  total: number;
  message: string;
  onCancel?: () => void;
  showPercentage?: boolean;
}

/**
 * Enhanced progress bar component for thumbnail generation and other long-running operations
 */
export const ProgressBar: Component<ProgressBarProps> = (props) => {
  const percentage = () => {
    if (props.total === 0) return 0;
    return Math.round((props.current / props.total) * 100);
  };

  const isComplete = () => props.current >= props.total;

  return (
    <div class="progress-bar-container">
      {/* Header with message and optional cancel button */}
      <div class="progress-header">
        <span class="progress-message">{props.message}</span>
        <Show when={props.onCancel && !isComplete()}>
          <button
            class="progress-cancel-btn"
            onClick={props.onCancel}
            title="Cancel operation"
          >
            Cancel
          </button>
        </Show>
      </div>

      {/* Progress bar */}
      <div class="progress-track">
        <div
          class="progress-fill"
          classList={{ 'progress-complete': isComplete() }}
          style={{ width: `${percentage()}%` }}
        />
      </div>

      {/* Counter and percentage */}
      <div class="progress-footer">
        <span class="progress-counter">
          {props.current.toLocaleString()} / {props.total.toLocaleString()} assets
        </span>
        <Show when={props.showPercentage !== false}>
          <span class="progress-percentage">{percentage()}%</span>
        </Show>
      </div>
    </div>
  );
};
