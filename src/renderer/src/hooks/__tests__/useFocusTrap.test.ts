import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useFocusTrap } from '../useFocusTrap';

describe('useFocusTrap', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('traps Tab key within container', () => {
    const container = document.createElement('div');
    const btn1 = document.createElement('button');
    btn1.textContent = 'First';
    const btn2 = document.createElement('button');
    btn2.textContent = 'Last';
    container.appendChild(btn1);
    container.appendChild(btn2);
    document.body.appendChild(container);

    const { result } = renderHook(() => useFocusTrap(true));

    // Manually set the ref to our container (since it can't mount naturally in this test)
    Object.defineProperty(result.current, 'current', {
      value: container,
      writable: true,
    });

    // Focus the last button
    btn2.focus();
    expect(document.activeElement).toBe(btn2);

    // Simulate Tab on last element — should prevent default and focus first
    const tabEvent = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true });
    Object.defineProperty(tabEvent, 'shiftKey', { value: false });
    const preventSpy = vi.spyOn(tabEvent, 'preventDefault');

    document.dispatchEvent(tabEvent);

    expect(preventSpy).toHaveBeenCalled();
  });

  it('does not trap when inactive', () => {
    const container = document.createElement('div');
    const btn1 = document.createElement('button');
    container.appendChild(btn1);
    document.body.appendChild(container);

    renderHook(() => useFocusTrap(false));

    const tabEvent = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true });
    const preventSpy = vi.spyOn(tabEvent, 'preventDefault');

    document.dispatchEvent(tabEvent);

    expect(preventSpy).not.toHaveBeenCalled();
  });

  it('ignores non-Tab keys', () => {
    const container = document.createElement('div');
    const btn1 = document.createElement('button');
    container.appendChild(btn1);
    document.body.appendChild(container);

    const { result } = renderHook(() => useFocusTrap(true));
    Object.defineProperty(result.current, 'current', {
      value: container,
      writable: true,
    });

    const enterEvent = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
    const preventSpy = vi.spyOn(enterEvent, 'preventDefault');

    document.dispatchEvent(enterEvent);

    expect(preventSpy).not.toHaveBeenCalled();
  });

  it('wraps Shift+Tab from first element to last', () => {
    const container = document.createElement('div');
    const btn1 = document.createElement('button');
    btn1.textContent = 'First';
    const btn2 = document.createElement('button');
    btn2.textContent = 'Last';
    container.appendChild(btn1);
    container.appendChild(btn2);
    document.body.appendChild(container);

    const { result } = renderHook(() => useFocusTrap(true));
    Object.defineProperty(result.current, 'current', {
      value: container,
      writable: true,
    });

    // Focus the first button
    btn1.focus();
    expect(document.activeElement).toBe(btn1);

    // Simulate Shift+Tab on first element
    const shiftTabEvent = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
    });
    const preventSpy = vi.spyOn(shiftTabEvent, 'preventDefault');

    document.dispatchEvent(shiftTabEvent);

    expect(preventSpy).toHaveBeenCalled();
    expect(document.activeElement).toBe(btn2);
  });

  it('Tab on last element wraps to first and actually moves focus', () => {
    const container = document.createElement('div');
    const btn1 = document.createElement('button');
    btn1.textContent = 'First';
    const btn2 = document.createElement('button');
    btn2.textContent = 'Last';
    container.appendChild(btn1);
    container.appendChild(btn2);
    document.body.appendChild(container);

    const { result } = renderHook(() => useFocusTrap(true));
    Object.defineProperty(result.current, 'current', {
      value: container,
      writable: true,
    });

    btn2.focus();
    expect(document.activeElement).toBe(btn2);

    const tabEvent = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true });
    Object.defineProperty(tabEvent, 'shiftKey', { value: false });

    document.dispatchEvent(tabEvent);

    expect(document.activeElement).toBe(btn1);
  });

  it('restores focus to previously focused element on unmount', () => {
    const externalBtn = document.createElement('button');
    externalBtn.textContent = 'External';
    document.body.appendChild(externalBtn);
    externalBtn.focus();
    expect(document.activeElement).toBe(externalBtn);

    const { unmount } = renderHook(() => useFocusTrap(true));

    unmount();

    expect(document.activeElement).toBe(externalBtn);
  });

  it('restores focus when trap deactivates without unmount', () => {
    const externalBtn = document.createElement('button');
    externalBtn.textContent = 'Trigger';
    document.body.appendChild(externalBtn);
    externalBtn.focus();
    expect(document.activeElement).toBe(externalBtn);

    const { result, rerender } = renderHook(({ active }) => useFocusTrap(active), {
      initialProps: { active: true },
    });

    const container = document.createElement('div');
    const insideBtn = document.createElement('button');
    insideBtn.textContent = 'Inside';
    container.appendChild(insideBtn);
    document.body.appendChild(container);
    Object.defineProperty(result.current, 'current', {
      value: container,
      writable: true,
    });

    insideBtn.focus();
    expect(document.activeElement).toBe(insideBtn);

    rerender({ active: false });
    expect(document.activeElement).toBe(externalBtn);
  });

  it('brings focus back when focus escapes the container', () => {
    const container = document.createElement('div');
    const btn1 = document.createElement('button');
    btn1.textContent = 'Inside';
    container.appendChild(btn1);
    document.body.appendChild(container);

    const outsideBtn = document.createElement('button');
    outsideBtn.textContent = 'Outside';
    document.body.appendChild(outsideBtn);

    const { result } = renderHook(() => useFocusTrap(true));
    Object.defineProperty(result.current, 'current', {
      value: container,
      writable: true,
    });

    // Focus goes outside the container
    outsideBtn.focus();
    expect(document.activeElement).toBe(outsideBtn);

    // Tab event while outside container should bring focus back
    const tabEvent = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true });
    Object.defineProperty(tabEvent, 'shiftKey', { value: false });
    const preventSpy = vi.spyOn(tabEvent, 'preventDefault');

    document.dispatchEvent(tabEvent);

    expect(preventSpy).toHaveBeenCalled();
    expect(document.activeElement).toBe(btn1);
  });
});
