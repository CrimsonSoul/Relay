import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useOperator } from '../../contexts/OperatorContext';
import { Tooltip } from '../Tooltip';
import { OperatorIcon } from './SidebarIcons';

const MENU_GAP = 8;
const MENU_MAX_HEIGHT = 360;
const MENU_WIDTH = 252;
const VIEWPORT_GUTTER = 8;

type MenuPosition = {
  left: number;
  bottom: number;
  maxHeight: number;
};

export function SidebarOperatorSelector() {
  const {
    activeOperators,
    selectedOperator,
    selectOperator,
    pickerOpen,
    setPickerOpen,
    loading,
    error,
  } = useOperator();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [menuPosition, setMenuPosition] = useState<MenuPosition>({
    left: 0,
    bottom: VIEWPORT_GUTTER,
    maxHeight: MENU_MAX_HEIGHT,
  });

  const updateMenuPosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const maximumLeft = Math.max(
      VIEWPORT_GUTTER,
      globalThis.innerWidth - MENU_WIDTH - VIEWPORT_GUTTER,
    );
    const bottom = Math.max(VIEWPORT_GUTTER, globalThis.innerHeight - rect.bottom);
    setMenuPosition({
      left: Math.max(VIEWPORT_GUTTER, Math.min(rect.right + MENU_GAP, maximumLeft)),
      bottom,
      maxHeight: Math.min(
        MENU_MAX_HEIGHT,
        Math.max(0, globalThis.innerHeight - bottom - VIEWPORT_GUTTER),
      ),
    });
  }, []);

  const closeAndRestoreFocus = useCallback(() => {
    setPickerOpen(false);
    triggerRef.current?.focus();
  }, [setPickerOpen]);

  useEffect(() => {
    if (!pickerOpen) return undefined;

    updateMenuPosition();
    globalThis.addEventListener('resize', updateMenuPosition);
    globalThis.addEventListener('scroll', updateMenuPosition, true);
    return () => {
      globalThis.removeEventListener('resize', updateMenuPosition);
      globalThis.removeEventListener('scroll', updateMenuPosition, true);
    };
  }, [pickerOpen, updateMenuPosition]);

  useEffect(() => {
    if (!pickerOpen || activeOperators.length === 0) return;

    const selectedIndex = activeOperators.findIndex(({ id }) => id === selectedOperator?.id);
    const target = itemRefs.current[selectedIndex >= 0 ? selectedIndex : 0];
    target?.focus();
    target?.scrollIntoView?.({ block: 'nearest' });
  }, [activeOperators, pickerOpen, selectedOperator?.id]);

  useEffect(() => {
    if (!pickerOpen) return undefined;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setPickerOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeAndRestoreFocus();
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [closeAndRestoreFocus, pickerOpen, setPickerOpen]);

  let unavailableLabel = 'No active operators';
  if (loading) unavailableLabel = 'Loading operators';
  else if (error) unavailableLabel = 'Operators unavailable';
  let triggerLabel = selectedOperator?.displayName;
  if (!triggerLabel) {
    triggerLabel = activeOperators.length > 0 ? 'Select operator' : unavailableLabel;
  }
  const accessibleLabel = selectedOperator
    ? `Selected operator: ${selectedOperator.displayName}`
    : triggerLabel;
  const triggerDisabled = loading || Boolean(error) || activeOperators.length === 0;

  const handleTriggerClick = () => {
    updateMenuPosition();
    setPickerOpen(!pickerOpen);
  };

  const handleOperatorClick = (id: string) => {
    selectOperator(id);
    closeAndRestoreFocus();
  };

  const focusItem = (index: number) => {
    itemRefs.current[index]?.focus();
  };

  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (activeOperators.length === 0) return;

    const focusedIndex = Math.max(
      0,
      itemRefs.current.findIndex((item) => item === document.activeElement),
    );

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        focusItem((focusedIndex + 1) % activeOperators.length);
        break;
      case 'ArrowUp':
        event.preventDefault();
        focusItem((focusedIndex - 1 + activeOperators.length) % activeOperators.length);
        break;
      case 'Home':
        event.preventDefault();
        focusItem(0);
        break;
      case 'End':
        event.preventDefault();
        focusItem(activeOperators.length - 1);
        break;
      default:
        break;
    }
  };

  return (
    <>
      <Tooltip content={pickerOpen ? null : triggerLabel} position="right">
        <button
          ref={triggerRef}
          type="button"
          className="sidebar-button sidebar-operator-selector"
          aria-label={accessibleLabel}
          aria-haspopup="menu"
          aria-expanded={pickerOpen}
          aria-controls={pickerOpen ? 'sidebar-operator-menu' : undefined}
          disabled={triggerDisabled}
          data-has-selection={Boolean(selectedOperator)}
          data-testid="sidebar-operator-selector"
          onClick={handleTriggerClick}
        >
          <div className="sidebar-button-icon" aria-hidden="true">
            <OperatorIcon />
          </div>
          <span className="sidebar-button-label" title={triggerLabel}>
            {triggerLabel}
          </span>
        </button>
      </Tooltip>

      {pickerOpen &&
        createPortal(
          <div
            ref={menuRef}
            id="sidebar-operator-menu"
            className="sidebar-operator-menu"
            role="menu"
            aria-label="Select operator"
            tabIndex={-1}
            onKeyDown={handleMenuKeyDown}
            style={{
              left: menuPosition.left,
              bottom: menuPosition.bottom,
              maxHeight: menuPosition.maxHeight,
            }}
          >
            {activeOperators.length > 0 ? (
              activeOperators.map((operator, index) => (
                <button
                  key={operator.id}
                  ref={(node) => {
                    itemRefs.current[index] = node;
                  }}
                  type="button"
                  role="menuitemradio"
                  aria-checked={selectedOperator?.id === operator.id}
                  className="sidebar-operator-menu-item"
                  onClick={() => handleOperatorClick(operator.id)}
                >
                  <span className="sidebar-operator-menu-name">{operator.displayName}</span>
                </button>
              ))
            ) : (
              <div className="sidebar-operator-menu-status" role="status">
                {unavailableLabel}
              </div>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
