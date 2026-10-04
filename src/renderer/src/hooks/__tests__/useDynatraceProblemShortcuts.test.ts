import { fireEvent, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useModalStack } from '../../components/modalStack';
import {
  useDynatraceProblemShortcuts,
  type UseDynatraceProblemShortcutsParams,
} from '../useDynatraceProblemShortcuts';

const defaultShortcutProps: UseDynatraceProblemShortcutsParams = {
  active: true,
  visibleProblemIds: ['P-1', 'P-2', 'P-3'],
  selectedProblemId: 'P-2',
  filterCount: 3,
  onSelectProblem: vi.fn(),
  onFocusNote: vi.fn(),
  onFocusSearch: vi.fn(),
  onSelectFilter: vi.fn(),
  onSubmitResponse: vi.fn(),
  onEmptyView: vi.fn(),
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

  it('reports an empty view without changing selection', () => {
    const onSelectProblem = vi.fn();
    const onEmptyView = vi.fn();
    renderShortcuts({
      visibleProblemIds: [],
      onSelectProblem,
      onEmptyView,
    });

    fireEvent.keyDown(window, { key: 'ArrowDown', altKey: true });

    expect(onEmptyView).toHaveBeenCalledOnce();
    expect(onSelectProblem).not.toHaveBeenCalled();
  });

  it('accepts the physical key when macOS Option composes a different character', () => {
    const onFocusNote = vi.fn();
    const onSelectFilter = vi.fn();
    renderShortcuts({ onFocusNote, onSelectFilter });

    fireEvent.keyDown(window, { key: '˜', code: 'KeyN', altKey: true });
    fireEvent.keyDown(window, { key: '™', code: 'Digit2', altKey: true });

    expect(onFocusNote).toHaveBeenCalledOnce();
    expect(onSelectFilter).toHaveBeenCalledWith(1);
  });

  it('ignores Alt+digits beyond the available filters', () => {
    const onSelectFilter = vi.fn();
    renderShortcuts({ onSelectFilter });

    fireEvent.keyDown(window, { key: '4', code: 'Digit4', altKey: true });

    expect(onSelectFilter).not.toHaveBeenCalled();
  });

  it('focuses search with / outside editable fields only', () => {
    const onFocusSearch = vi.fn();
    renderShortcuts({ onFocusSearch });
    const input = document.createElement('input');
    input.dataset.triageShortcutTest = '';
    document.body.append(input);

    fireEvent.keyDown(input, { key: '/' });
    expect(onFocusSearch).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: '/' });
    expect(onFocusSearch).toHaveBeenCalledOnce();
  });

  it.each([{ metaKey: true }, { ctrlKey: true }])(
    'submits the response with %o+Enter even from the note field',
    (modifier) => {
      const onSubmitResponse = vi.fn();
      renderShortcuts({ onSubmitResponse });
      const actionbar = document.createElement('section');
      actionbar.className = 'dt-problem-detail__actionbar';
      actionbar.dataset.triageShortcutTest = '';
      const note = document.createElement('textarea');
      actionbar.append(note);
      document.body.append(actionbar);

      fireEvent.keyDown(note, { key: 'Enter', ...modifier });

      expect(onSubmitResponse).toHaveBeenCalledOnce();
    },
  );

  it.each(['textarea', 'select'] as const)(
    'keeps queue navigation available from the response %s',
    (tagName) => {
      const onSelectProblem = vi.fn();
      renderShortcuts({ onSelectProblem });
      const actionbar = document.createElement('section');
      actionbar.className = 'dt-problem-detail__actionbar';
      actionbar.dataset.triageShortcutTest = '';
      const field = document.createElement(tagName);
      actionbar.append(field);
      document.body.append(actionbar);

      fireEvent.keyDown(field, { key: 'ArrowDown', altKey: true });

      expect(onSelectProblem).toHaveBeenCalledWith('P-3');
    },
  );

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
        ...defaultShortcutProps,
        visibleProblemIds: ['P-1'],
        selectedProblemId: 'P-1',
        onSelectProblem,
      });
    });

    fireEvent.keyDown(window, { key: 'ArrowDown', altKey: true });

    expect(onSelectProblem).not.toHaveBeenCalled();
  });

  it.each(['input', 'textarea', 'select'] as const)(
    'does nothing from an editable %s target outside the response composer',
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
