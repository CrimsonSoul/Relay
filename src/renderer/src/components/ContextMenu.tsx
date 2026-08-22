import React, { useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

const VIEWPORT_MARGIN = 8;

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

function menuItemsOf(menu: HTMLDivElement | null): HTMLButtonElement[] {
  return [
    ...(menu?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])') ?? []),
  ];
}

export const ContextMenu: React.FC<ContextMenuProps> = ({ x, y, onClose, items }) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;

    const { width, height } = menu.getBoundingClientRect();
    const maxLeft = Math.max(VIEWPORT_MARGIN, globalThis.innerWidth - width - VIEWPORT_MARGIN);
    const maxTop = Math.max(VIEWPORT_MARGIN, globalThis.innerHeight - height - VIEWPORT_MARGIN);
    menu.style.left = `${Math.min(Math.max(x, VIEWPORT_MARGIN), maxLeft)}px`;
    menu.style.top = `${Math.min(Math.max(y, VIEWPORT_MARGIN), maxTop)}px`;
  }, [items, x, y]);

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

  // The menu is portaled to the end of <body>, so nothing hands it focus and a
  // keyboard user can never reach the items. Claim focus on mount and hand it
  // back to whatever opened the menu on the way out.
  useEffect(() => {
    const menu = menuRef.current;
    triggerRef.current = document.activeElement as HTMLElement | null;
    (menuItemsOf(menu)[0] ?? menu)?.focus();

    return () => {
      // Only reclaim focus if it is still parked in (or was orphaned by) the
      // menu — an item that opened a dialog has already moved it somewhere
      // better, and stealing it back would fight that dialog's focus trap.
      const active = document.activeElement;
      if (!active || active === document.body || menu?.contains(active)) {
        triggerRef.current?.focus?.();
      }
    };
  }, []);

  // Escape and arrow keys are handled at the document in the capture phase: the
  // menu is the topmost transient layer, so it must answer before an underlying
  // Modal's own document-level Escape listener closes the dialog behind it.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;

      const focusable = menuItemsOf(menuRef.current);
      if (focusable.length === 0) return;
      event.preventDefault();
      event.stopPropagation();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      const current = focusable.indexOf(document.activeElement as HTMLButtonElement);
      let next: number;
      if (current < 0) next = step === 1 ? 0 : focusable.length - 1;
      else next = (current + step + focusable.length) % focusable.length;
      focusable[next]?.focus();
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
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
        className="context-menu"
        data-motion="popover"
        role="menu"
        tabIndex={-1}
        style={{ top: y, left: x }}
        // The portal still propagates through the React tree, so both handlers
        // keep menu interaction from reaching whatever rendered the trigger.
        // Escape and the arrow keys are answered by the document listener above.
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
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
