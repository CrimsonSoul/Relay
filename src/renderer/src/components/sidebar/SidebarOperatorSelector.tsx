import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { RelayOperatorRecord } from '@shared/operators';
import { useOperator } from '../../contexts/OperatorContext';
import { Tooltip } from '../Tooltip';
import { OperatorIcon } from './SidebarIcons';

const MENU_GAP = 8;
const MENU_MAX_HEIGHT = 360;
const MENU_WIDTH = 252;
const VIEWPORT_GUTTER = 8;
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const NO_OPERATORS: RelayOperatorRecord[] = [];

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

  let unavailableLabel = 'No active operators';
  if (loading) unavailableLabel = 'Loading operators';
  else if (error) unavailableLabel = 'Operators unavailable';
  const operatorsAvailable = !loading && !error && activeOperators.length > 0;
  const menuOperators = operatorsAvailable ? activeOperators : NO_OPERATORS;
  let triggerLabel = selectedOperator?.displayName;
  if (!operatorsAvailable) triggerLabel = unavailableLabel;
  else if (!triggerLabel) triggerLabel = 'Select operator';
  const accessibleLabel =
    operatorsAvailable && selectedOperator
      ? `Selected operator: ${selectedOperator.displayName}`
      : triggerLabel;

  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const pickerWasOpenRef = useRef(false);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [focusedIndex, setFocusedIndex] = useState(0);
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
    const focusTarget = operatorsAvailable ? triggerRef.current : previousFocusRef.current;
    focusTarget?.focus();
  }, [operatorsAvailable, setPickerOpen]);

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
    if (pickerOpen && !pickerWasOpenRef.current) {
      const activeElement = document.activeElement;
      previousFocusRef.current = activeElement instanceof HTMLElement ? activeElement : null;
    }
    pickerWasOpenRef.current = pickerOpen;
  }, [pickerOpen]);

  useEffect(() => {
    if (!pickerOpen) return;
    if (menuOperators.length === 0) {
      setFocusedIndex(0);
      statusRef.current?.focus();
      return;
    }

    const selectedIndex = menuOperators.findIndex(({ id }) => id === selectedOperator?.id);
    const nextFocusedIndex = selectedIndex >= 0 ? selectedIndex : 0;
    const target = itemRefs.current[nextFocusedIndex];
    setFocusedIndex(nextFocusedIndex);
    target?.focus();
    target?.scrollIntoView?.({ block: 'nearest' });
  }, [menuOperators, pickerOpen, selectedOperator?.id]);

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

  const triggerDisabled = !operatorsAvailable;

  const handleTriggerClick = () => {
    updateMenuPosition();
    setPickerOpen(!pickerOpen);
  };

  const handleOperatorClick = (id: string) => {
    selectOperator(id);
    closeAndRestoreFocus();
  };

  const focusItem = (index: number) => {
    setFocusedIndex(index);
    itemRefs.current[index]?.focus();
  };

  const focusAdjacentTo = (anchor: HTMLElement | null, backwards: boolean) => {
    const focusableElements = Array.from(
      document.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
    ).filter((element) => !menuRef.current?.contains(element));
    const anchorIndex = anchor ? focusableElements.indexOf(anchor) : -1;
    setPickerOpen(false);
    if (anchorIndex < 0) return;
    focusableElements[anchorIndex + (backwards ? -1 : 1)]?.focus();
  };

  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Tab') {
      event.preventDefault();
      const focusAnchor = operatorsAvailable ? triggerRef.current : previousFocusRef.current;
      focusAdjacentTo(focusAnchor, event.shiftKey);
      return;
    }

    if (menuOperators.length === 0) return;

    const focusedIndex = Math.max(
      0,
      itemRefs.current.findIndex((item) => item === document.activeElement),
    );

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        focusItem((focusedIndex + 1) % menuOperators.length);
        break;
      case 'ArrowUp':
        event.preventDefault();
        focusItem((focusedIndex - 1 + menuOperators.length) % menuOperators.length);
        break;
      case 'Home':
        event.preventDefault();
        focusItem(0);
        break;
      case 'End':
        event.preventDefault();
        focusItem(menuOperators.length - 1);
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
          data-availability={operatorsAvailable ? 'available' : 'unavailable'}
          data-has-selection={Boolean(selectedOperator)}
          data-testid="sidebar-operator-selector"
          onClick={handleTriggerClick}
        >
          <div className="sidebar-button-icon" aria-hidden="true">
            <OperatorIcon />
          </div>
          <span
            className="sidebar-button-label sidebar-operator-selector-label"
            title={triggerLabel}
          >
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
            aria-busy={loading}
            tabIndex={-1}
            onKeyDown={handleMenuKeyDown}
            style={{
              left: menuPosition.left,
              bottom: menuPosition.bottom,
              maxHeight: menuPosition.maxHeight,
            }}
          >
            {menuOperators.length > 0 ? (
              menuOperators.map((operator, index) => (
                <button
                  key={operator.id}
                  ref={(node) => {
                    itemRefs.current[index] = node;
                  }}
                  type="button"
                  role="menuitemradio"
                  aria-checked={selectedOperator?.id === operator.id}
                  tabIndex={focusedIndex === index ? 0 : -1}
                  className="sidebar-operator-menu-item"
                  onFocus={() => setFocusedIndex(index)}
                  onClick={() => handleOperatorClick(operator.id)}
                >
                  <span className="sidebar-operator-menu-name">{operator.displayName}</span>
                </button>
              ))
            ) : (
              <div
                ref={statusRef}
                className="sidebar-operator-menu-status"
                role="menuitem"
                aria-disabled="true"
                tabIndex={0}
              >
                <span role="status" aria-live="polite">
                  {unavailableLabel}
                </span>
              </div>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
