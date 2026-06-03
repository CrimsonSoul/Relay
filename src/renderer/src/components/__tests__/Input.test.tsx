import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { Input } from '../Input';
import { afterEach, vi } from 'vitest';

describe('Input Component', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test('renders correctly', () => {
    render(<Input placeholder="Test Input" />);
    expect(screen.getByPlaceholderText('Test Input')).toBeInTheDocument();
  });

  test('shows clear button when typed into (uncontrolled)', () => {
    render(<Input placeholder="Uncontrolled" />);
    const input = screen.getByPlaceholderText('Uncontrolled');

    // Initially no clear button
    expect(screen.queryByTestId('input-clear-button')).toBeNull();

    fireEvent.change(input, { target: { value: 'Hello' } });

    // Should now have clear button
    expect(screen.getByTestId('input-clear-button')).toBeInTheDocument();
  });

  test('clears input when button clicked', () => {
    const handleChange = vi.fn();
    render(<Input value="Test" onChange={handleChange} />);

    const clearBtn = screen.getByTestId('input-clear-button');
    expect(clearBtn).toBeInTheDocument();

    // Click the clear button
    fireEvent.click(clearBtn);

    expect(handleChange).toHaveBeenCalled();
  });

  test('clears the delayed autofocus timer on unmount', () => {
    vi.useFakeTimers();
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    const { unmount } = render(<Input autoFocus placeholder="Autofocus input" />);
    const focusTimer = setTimeoutSpy.mock.results.find(
      (_, index) => setTimeoutSpy.mock.calls[index][1] === 150,
    )?.value;

    expect(focusTimer).toBeDefined();
    unmount();
    expect(clearTimeoutSpy).toHaveBeenCalledWith(focusTimer);

    setTimeoutSpy.mockRestore();
    clearTimeoutSpy.mockRestore();
  });
});
