import React, { useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { Tooltip } from './Tooltip';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  title?: string;
  width?: string;
  /** When true, renders only the portal/overlay/dialog shell with no header, accent line, or body wrapper. Children control all interior content. */
  bare?: boolean;
  /** Override the overlay CSS class (default: 'modal-overlay-generic') */
  overlayClassName?: string;
  /** Override the dialog CSS class (default: 'modal-dialog-generic') */
  dialogClassName?: string;
  /** Extra props spread onto the <dialog> element (e.g. data-entity-id) */
  dialogProps?: React.HTMLAttributes<HTMLDialogElement>;
};

export const Modal: React.FC<Props> = ({
  isOpen,
  onClose,
  children,
  title,
  width = '560px',
  bare = false,
  overlayClassName = 'modal-overlay-generic',
  dialogClassName = 'modal-dialog-generic',
  dialogProps,
}) => {
  // Focus trap to prevent focus from leaving modal
  const focusTrapRef = useFocusTrap<HTMLDialogElement>(isOpen);

  // Handle Escape key to close modal
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    },
    [onClose],
  );

  useEffect(() => {
    if (!isOpen) return;
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleKeyDown]);

  // Prevent body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.classList.add('modal-open');
      return () => {
        document.body.classList.remove('modal-open');
      };
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return createPortal(
    <div className={`${overlayClassName} animate-fade-in`}>
      <button
        type="button"
        className="overlay-hitbox"
        aria-label="Close modal backdrop"
        onClick={onClose}
      />
      <dialog
        open
        ref={focusTrapRef}
        className={`${dialogClassName} animate-scale-in`}
        style={{ width }}
        aria-modal="true"
        aria-labelledby={title ? 'generic-modal-title' : undefined}
        {...dialogProps}
      >
        {bare ? (
          children
        ) : (
          <>
            <div className="modal-accent-line" />

            <div className="modal-header-generic">
              <h2 id="generic-modal-title" className="modal-title-generic">
                {title}
              </h2>
              <Tooltip content="Close" position="left">
                <button
                  type="button"
                  onClick={onClose}
                  className="modal-close-generic hover-bg"
                  aria-label="Close"
                >
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </Tooltip>
            </div>

            <div className="modal-body-generic">{children}</div>
          </>
        )}
      </dialog>
    </div>,
    document.body,
  );
};
