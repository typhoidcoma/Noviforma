import { Component, JSX, Show } from 'solid-js';
import './Modal.css';

interface ModalProps {
  show: boolean;
  children: JSX.Element;
  onClose?: () => void;
  closeOnOverlayClick?: boolean;
}

/**
 * Reusable modal overlay component
 * Displays content in a centered overlay with backdrop blur
 */
export const Modal: Component<ModalProps> = (props) => {
  const handleOverlayClick = (e: MouseEvent) => {
    if (props.closeOnOverlayClick !== false && props.onClose) {
      props.onClose();
    }
  };

  return (
    <Show when={props.show}>
      <div class="modal-overlay" onClick={handleOverlayClick}>
        <div class="modal-content" onClick={(e) => e.stopPropagation()}>
          {props.children}
        </div>
      </div>
    </Show>
  );
};
