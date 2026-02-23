import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useRef } from 'react';
import { useOnClickOutside } from '../useOnClickOutside';

// Helper: create a container in the DOM and return cleanup function
function createElements() {
  const container = document.createElement('div');
  const outside = document.createElement('button');
  document.body.appendChild(container);
  document.body.appendChild(outside);
  const cleanup = () => {
    document.body.removeChild(container);
    document.body.removeChild(outside);
  };
  return { container, outside, cleanup };
}

describe('useOnClickOutside', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls handler when mousedown fires outside the ref element', () => {
    const handler = vi.fn();
    const { container, outside, cleanup } = createElements();

    const { result } = renderHook(() => {
      const ref = useRef<HTMLDivElement>(null);
      useOnClickOutside(ref, handler);
      return ref;
    });

    // Set ref.current after effect registration; listener reads it at event time
    (result.current as { current: HTMLDivElement }).current = container;

    act(() => {
      outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });

    expect(handler).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it('does NOT call handler when mousedown fires inside the ref element', () => {
    const handler = vi.fn();
    const container = document.createElement('div');
    const inner = document.createElement('button');
    container.appendChild(inner);
    document.body.appendChild(container);

    const { result } = renderHook(() => {
      const ref = useRef<HTMLDivElement>(null);
      useOnClickOutside(ref, handler);
      return ref;
    });

    (result.current as { current: HTMLDivElement }).current = container;

    act(() => {
      // Dispatch from inner (child of container) — container.contains(inner) = true → no call
      inner.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });

    expect(handler).not.toHaveBeenCalled();
    document.body.removeChild(container);
  });

  it('calls handler when touchstart fires outside', () => {
    const handler = vi.fn();
    const { container, outside, cleanup } = createElements();

    const { result } = renderHook(() => {
      const ref = useRef<HTMLDivElement>(null);
      useOnClickOutside(ref, handler);
      return ref;
    });

    (result.current as { current: HTMLDivElement }).current = container;

    act(() => {
      outside.dispatchEvent(new TouchEvent('touchstart', { bubbles: true }));
    });

    expect(handler).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it('does not call handler when ref.current is null', () => {
    const handler = vi.fn();

    renderHook(() => {
      const ref = useRef<HTMLDivElement>(null);
      useOnClickOutside(ref, handler);
    });

    act(() => {
      document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });

    // ref.current is null → `!el` is true → early return, no handler called
    expect(handler).not.toHaveBeenCalled();
  });

  it('removes event listeners on unmount', () => {
    const handler = vi.fn();
    const removeEventListener = vi.spyOn(document, 'removeEventListener');

    const { unmount } = renderHook(() => {
      const ref = useRef<HTMLDivElement>(null);
      useOnClickOutside(ref, handler);
    });

    unmount();

    expect(removeEventListener).toHaveBeenCalledWith('mousedown', expect.any(Function));
    expect(removeEventListener).toHaveBeenCalledWith('touchstart', expect.any(Function));
    removeEventListener.mockRestore();
  });

  it('uses latest handler reference without re-subscribing', () => {
    const firstHandler = vi.fn();
    const secondHandler = vi.fn();
    const { container, outside, cleanup } = createElements();

    const { result, rerender } = renderHook(
      ({ handler }: { handler: (e: MouseEvent | TouchEvent) => void }) => {
        const ref = useRef<HTMLDivElement>(null);
        useOnClickOutside(ref, handler);
        return ref;
      },
      { initialProps: { handler: firstHandler } },
    );

    (result.current as { current: HTMLDivElement }).current = container;

    // Re-render with new handler
    rerender({ handler: secondHandler });

    act(() => {
      outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });

    // Only secondHandler should be called (via handlerRef)
    expect(secondHandler).toHaveBeenCalledTimes(1);
    expect(firstHandler).not.toHaveBeenCalled();
    cleanup();
  });
});
