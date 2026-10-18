import type { ChangeEvent } from 'react';
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
    // Read the value during the call: React restores a controlled input right afterwards.
    const changedValues: string[] = [];
    const handleChange = vi.fn((event: ChangeEvent<HTMLInputElement>) => {
      changedValues.push(event.target.value);
    });
    render(<Input value="Test" onChange={handleChange} />);

    const clearBtn = screen.getByTestId('input-clear-button');
    expect(clearBtn).toBeInTheDocument();

    // Click the clear button
    fireEvent.click(clearBtn);

    expect(handleChange).toHaveBeenCalledTimes(1);
    expect(changedValues).toEqual(['']);
  });

  test('keeps the clear button in sync when the caller also handles focus and blur', () => {
    const onFocus = vi.fn();
    const onBlur = vi.fn();
    render(<Input defaultValue="" onFocus={onFocus} onBlur={onBlur} />);
    const input = screen.getByRole('textbox');

    // Uncontrolled: the value changes without a React onChange, so focus/blur must resync it.
    (input as HTMLInputElement).value = 'typed';
    fireEvent.blur(input);

    expect(onBlur).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('input-clear-button')).toBeInTheDocument();
    fireEvent.focus(input);
    expect(onFocus).toHaveBeenCalledTimes(1);
  });

  test('treats a numeric zero as a value that can be cleared', () => {
    render(<Input type="number" value={0} onChange={vi.fn()} />);
    expect(screen.getByTestId('input-clear-button')).toBeInTheDocument();
  });

  test('clears the delayed autofocus timer on unmount', () => {
    vi.useFakeTimers();
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    const { unmount } = render(<Input autoFocus placeholder="Autofocus input" />);
    const focusTimer = setTimeoutSpy.mock.results.find(
      (_, index) => setTimeoutSpy.mock.calls[index]?.[1] === 150,
    )?.value;

    expect(focusTimer).toBeDefined();
    unmount();
    expect(clearTimeoutSpy).toHaveBeenCalledWith(focusTimer);

    setTimeoutSpy.mockRestore();
    clearTimeoutSpy.mockRestore();
  });

  test('wires an error message through aria-invalid and aria-describedby', () => {
    render(
      <Input
        id="team-name"
        label="Team name"
        aria-describedby="team-name-hint"
        error="Team name is required"
      />,
    );
    const input = screen.getByLabelText('Team name');
    const message = screen.getByRole('alert');

    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-describedby', 'team-name-hint team-name-error');
    expect(message).toHaveAttribute('id', 'team-name-error');
    expect(message).toHaveClass('field-error');
    expect(message).toHaveTextContent('Team name is required');
  });

  test('omits error wiring when there is no error', () => {
    render(<Input label="Team name" />);
    const input = screen.getByLabelText('Team name');

    expect(input).not.toHaveAttribute('aria-invalid');
    expect(input).not.toHaveAttribute('aria-describedby');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
