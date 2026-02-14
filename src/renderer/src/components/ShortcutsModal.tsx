import React from 'react';
import { createPortal } from 'react-dom';

type ShortcutsModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

const isMac = typeof window !== 'undefined' && window.api?.platform === 'darwin';
const modKey = isMac ? '⌘' : 'Ctrl';

const shortcuts = [
  {
    category: 'Navigation',
    items: [
      { keys: `${modKey} + 1`, description: 'Go to Compose' },
      { keys: `${modKey} + 2`, description: 'Go to On-Call Board' },
      { keys: `${modKey} + 3`, description: 'Go to People' },
      { keys: `${modKey} + 4`, description: 'Go to Weather' },
      { keys: `${modKey} + 5`, description: 'Go to Servers' },
      { keys: `${modKey} + 6`, description: 'Go to Radar' },
      { keys: `${modKey} + 7`, description: 'Go to AI Chat' },
    ],
  },
  {
    category: 'Actions',
    items: [
      { keys: `${modKey} + K`, description: 'Open Command Palette' },
      { keys: `${modKey} + Shift + C`, description: 'Copy Bridge (in Compose)' },
      { keys: `${modKey} + ,`, description: 'Open Settings' },
      { keys: `${modKey} + ?`, description: 'Show Shortcuts' },
    ],
  },
  {
    category: 'General',
    items: [
      { keys: 'Escape', description: 'Close modal / dialog' },
      { keys: '↑ ↓', description: 'Navigate lists' },
      { keys: 'Enter', description: 'Select / confirm' },
    ],
  },
];

export const ShortcutsModal: React.FC<ShortcutsModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return createPortal(
    <div className="shortcuts-modal-overlay animate-fade-in" role="presentation" onClick={onClose}>
      <div
        className="shortcuts-modal animate-scale-in"
        role="presentation"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shortcuts-modal-header">
          <div className="shortcuts-modal-header-left">
            <div className="shortcuts-modal-icon-box">
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="2" y="4" width="20" height="16" rx="2" ry="2" />
                <path d="M6 8h.001" />
                <path d="M10 8h.001" />
                <path d="M14 8h.001" />
                <path d="M18 8h.001" />
                <path d="M8 12h.001" />
                <path d="M12 12h.001" />
                <path d="M16 12h.001" />
                <path d="M7 16h10" />
              </svg>
            </div>
            <div className="shortcuts-modal-title">Keyboard Shortcuts</div>
          </div>
          <button onClick={onClose} aria-label="Close" className="shortcuts-modal-close-btn">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="shortcuts-modal-content">
          {shortcuts.map((section) => (
            <div key={section.category} className="shortcuts-modal-category">
              <div className="shortcuts-modal-category-title">{section.category}</div>
              <div className="shortcuts-modal-items">
                {section.items.map((item) => (
                  <div key={item.keys} className="shortcuts-modal-item">
                    <span className="shortcuts-modal-item-desc">{item.description}</span>
                    <span className="shortcuts-modal-key">{item.keys}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="shortcuts-modal-footer">
          Press <kbd className="shortcuts-modal-kbd">Esc</kbd> to close
        </div>
      </div>
    </div>,
    document.body,
  );
};
