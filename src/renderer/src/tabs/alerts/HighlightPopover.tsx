import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Tooltip } from '../../components/Tooltip';
import { HIGHLIGHTS, type HighlightType } from './highlightColors';
import { toolbarActivationProps } from './toolbarActivation';
import { getEditorShortcutLabel } from './editorShortcut';

interface HighlightPopoverProps {
  onApply: (type: HighlightType) => void;
  onClear: () => void;
}

export const HighlightPopover: React.FC<HighlightPopoverProps> = ({ onApply, onClear }) => {
  const [isOpen, setIsOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen]);

  const handleApply = useCallback(
    (type: HighlightType) => {
      onApply(type);
      setIsOpen(false);
    },
    [onApply],
  );

  const handleClear = useCallback(() => {
    onClear();
    setIsOpen(false);
  }, [onClear]);

  return (
    <div className="alerts-hl-popover-wrapper" ref={popoverRef}>
      <Tooltip
        content={`Highlight Text: Deadline, Warning, Success, Number, Service (${getEditorShortcutLabel('1')}\u2013${getEditorShortcutLabel('5')})`}
      >
        <button
          type="button"
          className={`alerts-fmt-btn alerts-hl-trigger${isOpen ? ' open' : ''}`}
          aria-label="Highlight Text"
          aria-haspopup="menu"
          aria-expanded={isOpen}
          {...toolbarActivationProps(() => setIsOpen((v) => !v))}
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4z" />
          </svg>
          <span className="alerts-hl-label" aria-hidden="true">
            Highlight
          </span>
          <svg
            className="alerts-hl-arrow"
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
      </Tooltip>

      {isOpen && (
        <div
          className="alerts-hl-popover"
          role="menu"
          tabIndex={-1}
          aria-label="Highlight options"
          data-motion="popover"
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return;
            // Closing unmounts the focused item; hand focus back to the trigger, not <body>.
            event.preventDefault();
            setIsOpen(false);
            popoverRef.current?.querySelector<HTMLButtonElement>('.alerts-hl-trigger')?.focus();
          }}
        >
          {HIGHLIGHTS.map((h) => (
            <button
              key={h.type}
              type="button"
              className="alerts-hl-popover-row"
              role="menuitem"
              aria-label={`${h.label} highlight`}
              aria-keyshortcuts={`Meta+${h.shortcutKey} Control+${h.shortcutKey}`}
              {...toolbarActivationProps(() => handleApply(h.type))}
            >
              <span
                className="alerts-hl-popover-swatch"
                style={{ background: h.bg }}
                aria-hidden="true"
              />
              <span className="alerts-hl-popover-label">{h.label}</span>
              <span className="alerts-hl-popover-key" aria-hidden="true">
                {getEditorShortcutLabel(h.shortcutKey)}
              </span>
            </button>
          ))}
          <div className="alerts-hl-popover-divider" />
          <button
            type="button"
            className="alerts-hl-popover-row"
            role="menuitem"
            aria-label="Remove highlight"
            aria-keyshortcuts="Meta+0 Control+0"
            {...toolbarActivationProps(handleClear)}
          >
            <span
              className="alerts-hl-popover-swatch alerts-hl-popover-clear-swatch"
              aria-hidden="true"
            >
              ✕
            </span>
            <span className="alerts-hl-popover-label">Remove</span>
            <span className="alerts-hl-popover-key" aria-hidden="true">
              {getEditorShortcutLabel('0')}
            </span>
          </button>
        </div>
      )}
    </div>
  );
};
