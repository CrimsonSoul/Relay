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
};

export const Modal: React.FC<Props> = ({ isOpen, onClose, children, title, width = '560px' }) => {
  // Focus trap to prevent focus from leaving modal
  const focusTrapRef = useFocusTrap<HTMLDivElement>(isOpen);

  // Handle Escape key to close modal
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return;
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleKeyDown]);

  // Prevent body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = originalOverflow;
      };
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return createPortal(
    <div
      className="modal-overlay-generic animate-fade-in"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={focusTrapRef}
        className="modal-dialog-generic animate-scale-in"
        style={{ width }}
        onClick={e => e.stopPropagation()}
        onPointerDown={e => e.stopPropagation()}
        onMouseDown={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? 'generic-modal-title' : undefined}
      >
        {/* Subtle gradient accent at top */}
        <div className="modal-accent-line" />

        {/* Header */}
        <div className="modal-header-generic">
          <h2 id="generic-modal-title" className="modal-title-generic">
            {title}
          </h2>
          <Tooltip content="Close" position="left">
            <button
              onClick={onClose}
              className="modal-close-generic hover-bg"
              aria-label="Close"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </Tooltip>
        </div>

        {/* Content */}
        <div className="modal-body-generic">
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
};
