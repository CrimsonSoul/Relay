import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getTabCommandShortcut,
  requestTabCommand,
  useTabCommandRequests,
  useTabCommandShortcuts,
} from '../useTabCommandShortcuts';

function Harness({ onCopy }: Readonly<{ onCopy: () => void }>) {
  useTabCommandShortcuts({ C: onCopy, B: null });
  return <input aria-label="field" />;
}

const press = (target: Element | Window, init: KeyboardEventInit) =>
  fireEvent.keyDown(target, { key: 'C', code: 'KeyC', shiftKey: true, ...init });

describe('useTabCommandShortcuts', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('labels and runs Mod+Shift+letter on desktop, but not while typing', () => {
    vi.stubGlobal('api', { platform: 'darwin' });
    expect(getTabCommandShortcut('C')).toEqual({
      label: '⌘⇧C',
      aria: 'Meta+Shift+C Control+Shift+C',
    });
    const onCopy = vi.fn();
    const { getByLabelText } = render(<Harness onCopy={onCopy} />);

    press(globalThis.window, { metaKey: true });
    expect(onCopy).toHaveBeenCalledTimes(1);
    press(getByLabelText('field'), { metaKey: true });
    expect(onCopy).toHaveBeenCalledTimes(1);
    press(globalThis.window, { metaKey: true, altKey: true });
    expect(onCopy).toHaveBeenCalledTimes(1);
  });

  it('uses Alt+Shift in Relay Web so browser Mod+Shift bindings stay available', () => {
    expect(getTabCommandShortcut('B')).toEqual({ label: 'Alt⇧B', aria: 'Alt+Shift+B' });
    const onCopy = vi.fn();
    render(<Harness onCopy={onCopy} />);

    press(globalThis.window, { metaKey: true });
    expect(onCopy).not.toHaveBeenCalled();
    press(globalThis.window, { altKey: true, key: 'Ç' });
    expect(onCopy).toHaveBeenCalledTimes(1);
  });
});

function RequestHarness({ onClear }: Readonly<{ onClear: (() => void) | null }>) {
  useTabCommandRequests({ 'clear-bridge': onClear });
  return null;
}

describe('useTabCommandRequests', () => {
  afterEach(() => vi.useRealTimers());

  it('runs a request on the mounted owning tab and ignores other commands', () => {
    const onClear = vi.fn();
    render(<RequestHarness onClear={onClear} />);

    act(() => requestTabCommand('reset-alert'));
    expect(onClear).not.toHaveBeenCalled();
    act(() => requestTabCommand('clear-bridge'));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('waits for the owning tab to mount, then runs the request once', () => {
    const onClear = vi.fn();
    requestTabCommand('clear-bridge');
    const { unmount } = render(<RequestHarness onClear={onClear} />);
    expect(onClear).toHaveBeenCalledTimes(1);
    unmount();
    render(<RequestHarness onClear={onClear} />);
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('consumes a disabled command and drops stale requests', () => {
    vi.useFakeTimers();
    const onClear = vi.fn();
    requestTabCommand('clear-bridge');
    render(<RequestHarness onClear={null} />).unmount();
    const disabledConsumed = render(<RequestHarness onClear={onClear} />);
    expect(onClear).not.toHaveBeenCalled();
    disabledConsumed.unmount();

    requestTabCommand('clear-bridge');
    vi.advanceTimersByTime(6_000);
    render(<RequestHarness onClear={onClear} />);
    expect(onClear).not.toHaveBeenCalled();
  });
});
