import { fireEvent, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useModalStack } from '../../components/modalStack';
import {
  useDynatraceProblemShortcuts,
  type UseDynatraceProblemShortcutsParams,
} from '../useDynatraceProblemShortcuts';

const defaultShortcutProps: UseDynatraceProblemShortcutsParams = {
  active: true,
  unaddressedProblemIds: ['P-1', 'P-2', 'P-3'],
  selectedProblemId: 'P-2',
  onSelectProblem: vi.fn(),
  onFocusNote: vi.fn(),
  onNoUnaddressedProblems: vi.fn(),
};

const renderShortcuts = (overrides: Partial<UseDynatraceProblemShortcutsParams> = {}) =>
  renderHook(() =>
    useDynatraceProblemShortcuts({
      ...defaultShortcutProps,
      ...overrides,
    }),
  );

describe('useDynatraceProblemShortcuts', () => {
  afterEach(() => {
    vi.clearAllMocks();
    document.querySelectorAll('[data-triage-shortcut-test]').forEach((element) => element.remove());
  });

  it.each([
    ['ArrowDown', 'P-3'],
    ['ArrowUp', 'P-1'],
  ] as const)('moves with Alt+%s', (key, expected) => {
    const onSelectProblem = vi.fn();
    renderShortcuts({ onSelectProblem });

    fireEvent.keyDown(window, { key, altKey: true });

    expect(onSelectProblem).toHaveBeenCalledWith(expected);
  });

  it.each([
    ['ArrowDown', 'P-3', 'P-1'],
    ['ArrowUp', 'P-1', 'P-3'],
  ] as const)('wraps Alt+%s at the queue boundary', (key, selectedProblemId, expected) => {
    const onSelectProblem = vi.fn();
    renderShortcuts({ selectedProblemId, onSelectProblem });

    fireEvent.keyDown(window, { key, altKey: true });

    expect(onSelectProblem).toHaveBeenCalledWith(expected);
  });

  it('focuses the selected note editor with Alt+N', () => {
    const onFocusNote = vi.fn();
    renderShortcuts({ onFocusNote });

    fireEvent.keyDown(window, { key: 'n', altKey: true });

    expect(onFocusNote).toHaveBeenCalledOnce();
  });

  it('reports an empty unaddressed queue without changing selection', () => {
    const onSelectProblem = vi.fn();
    const onNoUnaddressedProblems = vi.fn();
    renderShortcuts({
      unaddressedProblemIds: [],
      onSelectProblem,
      onNoUnaddressedProblems,
    });

    fireEvent.keyDown(window, { key: 'ArrowDown', altKey: true });

    expect(onNoUnaddressedProblems).toHaveBeenCalledOnce();
    expect(onSelectProblem).not.toHaveBeenCalled();
  });

  it('does nothing while the Problems tab is inactive', () => {
    const onSelectProblem = vi.fn();
    renderShortcuts({ active: false, onSelectProblem });

    fireEvent.keyDown(window, { key: 'ArrowDown', altKey: true });

    expect(onSelectProblem).not.toHaveBeenCalled();
  });

  it('does nothing while a modal is open', () => {
    const onSelectProblem = vi.fn();
    renderHook(() => {
      useModalStack('triage-shortcut-modal', true);
      useDynatraceProblemShortcuts({
        active: true,
        unaddressedProblemIds: ['P-1'],
        selectedProblemId: 'P-1',
        onSelectProblem,
        onFocusNote: vi.fn(),
        onNoUnaddressedProblems: vi.fn(),
      });
    });

    fireEvent.keyDown(window, { key: 'ArrowDown', altKey: true });

    expect(onSelectProblem).not.toHaveBeenCalled();
  });

  it.each(['input', 'textarea', 'select'] as const)(
    'does nothing from an editable %s target',
    (tagName) => {
      const onSelectProblem = vi.fn();
      renderShortcuts({ onSelectProblem });
      const target = document.createElement(tagName);
      target.dataset.triageShortcutTest = '';
      document.body.append(target);

      fireEvent.keyDown(target, { key: 'ArrowDown', altKey: true });

      expect(onSelectProblem).not.toHaveBeenCalled();
    },
  );

  it('does nothing from a content-editable target', () => {
    const onFocusNote = vi.fn();
    renderShortcuts({ onFocusNote });
    const target = document.createElement('div');
    target.dataset.triageShortcutTest = '';
    target.contentEditable = 'true';
    document.body.append(target);

    fireEvent.keyDown(target, { key: 'n', altKey: true });

    expect(onFocusNote).not.toHaveBeenCalled();
  });

  it('ignores modified or unrelated shortcuts', () => {
    const onSelectProblem = vi.fn();
    const onFocusNote = vi.fn();
    renderShortcuts({ onSelectProblem, onFocusNote });

    fireEvent.keyDown(window, { key: 'ArrowDown', altKey: true, shiftKey: true });
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    fireEvent.keyDown(window, { key: 'x', altKey: true });

    expect(onSelectProblem).not.toHaveBeenCalled();
    expect(onFocusNote).not.toHaveBeenCalled();
  });
});
