import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

export type ContextMenuItem = {
  label: string;
  onClick: () => void;
  danger?: boolean;
  icon?: React.ReactNode;
  disabled?: boolean;
};

type ContextMenuProps = {
  x: number;
  y: number;
  onClose: () => void;
  items: ContextMenuItem[];
};

export const ContextMenu: React.FC<ContextMenuProps> = ({ x, y, onClose, items }) => {
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on scroll/resize
  useEffect(() => {
    const handler = () => onClose();
    globalThis.addEventListener('resize', handler);
    globalThis.addEventListener('scroll', handler, true);
    return () => {
      globalThis.removeEventListener('resize', handler);
      globalThis.removeEventListener('scroll', handler, true);
    };
  }, [onClose]);

  return createPortal(
    <>
      <button
        type="button"
        className="context-menu-backdrop"
        aria-label="Close context menu"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div
        ref={menuRef}
        className="context-menu animate-scale-in"
        role="menu"
        tabIndex={-1}
        style={{ top: y, left: x }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
          }
        }}
      >
        <div className="context-menu-accent" />

        {items.map((item) => (
          <button
            type="button"
            key={item.label}
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              if (!item.disabled) {
                item.onClick();
                onClose();
              }
            }}
            className={`context-menu-item${item.disabled ? ' context-menu-item--disabled' : ''}${item.danger ? ' context-menu-item--danger' : ''}`}
          >
            {item.icon && <span className="context-menu-item-icon">{item.icon}</span>}
            <span className="text-truncate context-menu-item-label">{item.label}</span>
          </button>
        ))}
      </div>
    </>,
    document.body,
  );
};
