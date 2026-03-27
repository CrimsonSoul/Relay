import React, { useState, useRef, useEffect, useCallback } from 'react';
import { HIGHLIGHTS, type HighlightType } from './highlightColors';

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
      <button
        type="button"
        className={`alerts-fmt-btn alerts-hl-trigger${isOpen ? ' open' : ''}`}
        title="Highlight text"
        onMouseDown={(e) => {
          e.preventDefault();
          setIsOpen((v) => !v);
        }}
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
        >
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4z" />
        </svg>
        <span className="alerts-hl-dots">
          {HIGHLIGHTS.map((h) => (
            <span key={h.type} className="alerts-hl-dot" style={{ background: h.bg }} />
          ))}
        </span>
        <span className="alerts-hl-arrow">{isOpen ? '\u25B4' : '\u25BE'}</span>
      </button>

      {isOpen && (
        <div className="alerts-hl-popover">
          {HIGHLIGHTS.map((h) => (
            <button
              key={h.type}
              type="button"
              className="alerts-hl-popover-row"
              onMouseDown={(e) => {
                e.preventDefault();
                handleApply(h.type);
              }}
            >
              <span className="alerts-hl-popover-swatch" style={{ background: h.bg }} />
              <span className="alerts-hl-popover-label">{h.label}</span>
              <span className="alerts-hl-popover-key">
                {'\u2318'}
                {h.shortcutKey}
              </span>
            </button>
          ))}
          <div className="alerts-hl-popover-divider" />
          <button
            type="button"
            className="alerts-hl-popover-row"
            onMouseDown={(e) => {
              e.preventDefault();
              handleClear();
            }}
          >
            <span className="alerts-hl-popover-swatch alerts-hl-popover-clear-swatch">✕</span>
            <span className="alerts-hl-popover-label">Remove</span>
            <span className="alerts-hl-popover-key">{'\u2318'}0</span>
          </button>
        </div>
      )}
    </div>
  );
};
