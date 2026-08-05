import React from 'react';
import { Modal } from './Modal';

type ShortcutsModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

const isMac = globalThis.window?.api?.platform === 'darwin';
const modKey = isMac ? '⌘' : 'Ctrl';

const shortcuts = [
  {
    category: 'Navigation',
    items: [
      { keys: `${modKey} + 1`, description: 'Go to Compose' },
      { keys: `${modKey} + 2`, description: 'Go to Alerts' },
      { keys: `${modKey} + 3`, description: 'Go to On-Call Board' },
      { keys: `${modKey} + 4`, description: 'Go to Knowledge' },
      { keys: `${modKey} + 5`, description: 'Go to Service Status' },
      { keys: `${modKey} + 6`, description: 'Go to Dynatrace Problems' },
      { keys: `${modKey} + 7`, description: 'Go to Dispatcher Radar' },
    ],
  },
  {
    category: 'Dynatrace Problems',
    items: [
      { keys: 'Alt + ↓', description: 'Next unaddressed problem' },
      { keys: 'Alt + ↑', description: 'Previous unaddressed problem' },
      { keys: 'Alt + N', description: 'Focus selected problem note' },
    ],
  },
  {
    category: 'Actions',
    items: [
      { keys: `${modKey} + K`, description: 'Focus Search' },
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
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Keyboard Shortcuts"
      variant="standard"
      bodyClassName="shortcuts-modal-content"
      footer={
        <span className="shortcuts-modal-hint">
          Press <kbd className="shortcuts-modal-kbd">Esc</kbd> to close
        </span>
      }
    >
      {shortcuts.map((section) => (
        <section key={section.category} className="shortcuts-modal-category">
          <h3 className="shortcuts-modal-category-title">{section.category}</h3>
          <div className="shortcuts-modal-items">
            {section.items.map((item) => (
              <div key={item.keys} className="shortcuts-modal-item">
                <span className="shortcuts-modal-item-desc">{item.description}</span>
                <kbd className="shortcuts-modal-key">{item.keys}</kbd>
              </div>
            ))}
          </div>
        </section>
      ))}
    </Modal>
  );
};
