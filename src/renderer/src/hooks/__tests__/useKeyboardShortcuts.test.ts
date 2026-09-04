import React from 'react';
import { fireEvent, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ELECTRON_RUNTIME, WEB_RUNTIME } from '@shared/runtime';
import { useKeyboardShortcuts } from '../useKeyboardShortcuts';
import { useModalStack } from '../../components/modalStack';

describe('useKeyboardShortcuts', () => {
  beforeEach(() => {
    globalThis.api = { runtime: ELECTRON_RUNTIME } as never;
  });

  afterEach(() => {
    globalThis.api = undefined;
    vi.restoreAllMocks();
  });

  it.each([
    ['1', 'Compose'],
    ['2', 'Alerts'],
    ['3', 'Personnel'],
    ['4', 'Knowledge'],
    ['5', 'Status'],
    ['6', 'Problems'],
    ['7', 'Radar'],
  ] as const)('maps Cmd+%s to %s', (key, tab) => {
    const setActiveTab = vi.fn();
    renderHook(() =>
      useKeyboardShortcuts({
        setActiveTab,
        openSettings: vi.fn(),
        setIsShortcutsOpen: vi.fn(),
        searchInputRef: React.createRef<HTMLInputElement>(),
      }),
    );

    fireEvent.keyDown(window, { key, metaKey: true });

    expect(setActiveTab).toHaveBeenCalledWith(tab);
  });

  it('ignores tab navigation while a modal is open, and resumes once it closes', () => {
    const setActiveTab = vi.fn();
    const { rerender } = renderHook(
      ({ modalOpen }: { modalOpen: boolean }) => {
        useModalStack('shortcut-test-modal', modalOpen);
        useKeyboardShortcuts({
          setActiveTab,
          openSettings: vi.fn(),
          setIsShortcutsOpen: vi.fn(),
          searchInputRef: React.createRef<HTMLInputElement>(),
        });
      },
      { initialProps: { modalOpen: true } },
    );

    fireEvent.keyDown(window, { key: '1', metaKey: true });

    expect(setActiveTab).not.toHaveBeenCalled();

    rerender({ modalOpen: false });
    fireEvent.keyDown(window, { key: '1', metaKey: true });

    expect(setActiveTab).toHaveBeenCalledWith('Compose');
  });

  it('does not move focus or open settings behind an active modal', () => {
    const openSettings = vi.fn();
    const searchInputRef = React.createRef<HTMLInputElement>();
    searchInputRef.current = document.createElement('input');
    const focus = vi.spyOn(searchInputRef.current, 'focus');
    renderHook(() => {
      useModalStack('shortcut-test-modal', true);
      useKeyboardShortcuts({
        setActiveTab: vi.fn(),
        openSettings,
        setIsShortcutsOpen: vi.fn(),
        searchInputRef,
      });
    });

    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    fireEvent.keyDown(window, { key: ',', metaKey: true });

    expect(focus).not.toHaveBeenCalled();
    expect(openSettings).not.toHaveBeenCalled();
  });

  it('respects shortcuts already handled by a closer interaction', () => {
    const setActiveTab = vi.fn();
    renderHook(() =>
      useKeyboardShortcuts({
        setActiveTab,
        openSettings: vi.fn(),
        setIsShortcutsOpen: vi.fn(),
        searchInputRef: React.createRef<HTMLInputElement>(),
      }),
    );
    const event = new KeyboardEvent('keydown', {
      key: '1',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    event.preventDefault();

    globalThis.dispatchEvent(event);

    expect(setActiveTab).not.toHaveBeenCalled();
  });

  it.each(['8', '9'])('leaves Cmd+%s unassigned', (key) => {
    const setActiveTab = vi.fn();
    renderHook(() =>
      useKeyboardShortcuts({
        setActiveTab,
        openSettings: vi.fn(),
        setIsShortcutsOpen: vi.fn(),
        searchInputRef: React.createRef<HTMLInputElement>(),
      }),
    );

    fireEvent.keyDown(window, { key, metaKey: true });

    expect(setActiveTab).not.toHaveBeenCalled();
  });

  it.each(['input', 'textarea', 'select', 'contenteditable'] as const)(
    'does not run global shortcuts from an editable %s target',
    (kind) => {
      globalThis.api = { runtime: ELECTRON_RUNTIME } as never;
      const setActiveTab = vi.fn();
      const openSettings = vi.fn();
      const setIsShortcutsOpen = vi.fn();
      renderHook(() =>
        useKeyboardShortcuts({
          setActiveTab,
          openSettings,
          setIsShortcutsOpen,
          searchInputRef: React.createRef<HTMLInputElement>(),
        }),
      );
      const editable =
        kind === 'contenteditable'
          ? Object.assign(document.createElement('div'), {
              contentEditable: 'true',
              innerHTML: '<span>Editable text</span>',
            })
          : document.createElement(kind);
      if (kind === 'contenteditable') editable.setAttribute('contenteditable', 'true');
      document.body.append(editable);

      fireEvent.keyDown(editable, { key: '1', code: 'Digit1', metaKey: true });
      fireEvent.keyDown(editable, { key: ',', code: 'Comma', metaKey: true });
      fireEvent.keyDown(editable, { key: '?', code: 'Slash', metaKey: true, shiftKey: true });

      expect(setActiveTab).not.toHaveBeenCalled();
      expect(openSettings).not.toHaveBeenCalled();
      expect(setIsShortcutsOpen).not.toHaveBeenCalled();
      editable.remove();
    },
  );

  it('uses browser-safe Alt+Shift shortcuts in Relay Web', () => {
    globalThis.api = { runtime: WEB_RUNTIME } as never;
    const setActiveTab = vi.fn();
    const openSettings = vi.fn();
    const setIsShortcutsOpen = vi.fn();
    const searchInputRef = React.createRef<HTMLInputElement>();
    searchInputRef.current = document.createElement('input');
    const focus = vi.spyOn(searchInputRef.current, 'focus');
    renderHook(() =>
      useKeyboardShortcuts({ setActiveTab, openSettings, setIsShortcutsOpen, searchInputRef }),
    );

    fireEvent.keyDown(window, { key: '1', code: 'Digit1', metaKey: true });
    fireEvent.keyDown(window, { key: 'k', code: 'KeyK', ctrlKey: true });
    expect(setActiveTab).not.toHaveBeenCalled();
    expect(focus).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: '!', code: 'Digit1', altKey: true, shiftKey: true });
    fireEvent.keyDown(window, { key: 'K', code: 'KeyK', altKey: true, shiftKey: true });
    fireEvent.keyDown(window, { key: '<', code: 'Comma', altKey: true, shiftKey: true });
    fireEvent.keyDown(window, { key: '?', code: 'Slash', altKey: true, shiftKey: true });

    expect(setActiveTab).toHaveBeenCalledWith('Compose');
    expect(focus).toHaveBeenCalledOnce();
    expect(openSettings).toHaveBeenCalledOnce();
    expect(setIsShortcutsOpen).toHaveBeenCalledWith(true);
  });
});
