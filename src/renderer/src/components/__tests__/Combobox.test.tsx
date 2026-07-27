import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { Combobox } from '../Combobox';

const defaultOptions = [
  { label: 'Alpha', value: 'alpha' },
  { label: 'Beta', value: 'beta' },
  { label: 'Gamma', value: 'gamma' },
  { label: 'Delta', value: 'delta', subLabel: 'sub-label' },
];

describe('Combobox', () => {
  it('renders the input with the provided value', () => {
    render(<Combobox value="alpha" onChange={vi.fn()} options={defaultOptions} />);
    expect(screen.getByDisplayValue('alpha')).toBeInTheDocument();
  });

  it('renders with placeholder', () => {
    render(
      <Combobox value="" onChange={vi.fn()} options={defaultOptions} placeholder="Pick one" />,
    );
    expect(screen.getByPlaceholderText('Pick one')).toBeInTheDocument();
  });

  it('opens dropdown on input focus', () => {
    render(<Combobox value="" onChange={vi.fn()} options={defaultOptions} />);
    fireEvent.focus(screen.getByRole('textbox'));
    expect(screen.getByText('Alpha')).toBeInTheDocument();
  });

  it('calls onChange when user types', () => {
    const onChange = vi.fn();
    render(<Combobox value="" onChange={onChange} options={defaultOptions} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'al' } });
    expect(onChange).toHaveBeenCalledWith('al');
  });

  it('filters options by typed value', () => {
    const onChange = vi.fn();
    const { rerender } = render(<Combobox value="" onChange={onChange} options={defaultOptions} />);
    // Focus to open
    fireEvent.focus(screen.getByRole('textbox'));
    // Rerender with filtered value
    rerender(<Combobox value="al" onChange={onChange} options={defaultOptions} />);
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.queryByText('Beta')).toBeNull();
  });

  it('calls onChange with selected value when option is clicked', () => {
    const onChange = vi.fn();
    render(<Combobox value="" onChange={onChange} options={defaultOptions} />);
    fireEvent.focus(screen.getByRole('textbox'));
    fireEvent.click(screen.getByText('Beta'));
    expect(onChange).toHaveBeenCalledWith('beta');
  });

  it('closes dropdown after selecting an option', () => {
    const onChange = vi.fn();
    const { rerender } = render(<Combobox value="" onChange={onChange} options={defaultOptions} />);
    fireEvent.focus(screen.getByRole('textbox'));
    fireEvent.click(screen.getByText('Beta'));
    rerender(<Combobox value="beta" onChange={onChange} options={defaultOptions} />);
    expect(screen.queryByText('Alpha')).toBeNull();
  });

  it('renders subLabel when provided', () => {
    render(<Combobox value="" onChange={vi.fn()} options={defaultOptions} />);
    fireEvent.focus(screen.getByRole('textbox'));
    expect(screen.getByText('sub-label')).toBeInTheDocument();
  });

  it('shows "No matches" when no options match', () => {
    const { rerender } = render(<Combobox value="" onChange={vi.fn()} options={defaultOptions} />);
    fireEvent.focus(screen.getByRole('textbox'));
    rerender(<Combobox value="zzz" onChange={vi.fn()} options={defaultOptions} />);
    expect(screen.getByText('No matches')).toBeInTheDocument();
  });

  it('calls onOpenChange when dropdown opens', () => {
    const onOpenChange = vi.fn();
    render(
      <Combobox value="" onChange={vi.fn()} options={defaultOptions} onOpenChange={onOpenChange} />,
    );
    fireEvent.focus(screen.getByRole('textbox'));
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  describe('keyboard', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('closes only the dropdown on Escape and stops the event reaching the dialog', () => {
      const onDialogEscape = vi.fn();
      document.addEventListener('keydown', onDialogEscape);

      try {
        render(<Combobox value="" onChange={vi.fn()} options={defaultOptions} />);
        const input = screen.getByRole('textbox');
        fireEvent.focus(input);
        expect(screen.getByText('Alpha')).toBeInTheDocument();

        fireEvent.keyDown(input, { key: 'Escape' });

        expect(screen.queryByText('Alpha')).toBeNull();
        // Modal listens for Escape on the document; letting it through here
        // closed the whole Edit Card dialog and lost every unsaved row.
        expect(onDialogEscape).not.toHaveBeenCalled();
      } finally {
        document.removeEventListener('keydown', onDialogEscape);
      }
    });

    it('lets Escape through to the dialog when the dropdown is already closed', () => {
      const onDialogEscape = vi.fn();
      document.addEventListener('keydown', onDialogEscape);

      try {
        render(<Combobox value="" onChange={vi.fn()} options={defaultOptions} />);
        fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
        expect(onDialogEscape).toHaveBeenCalled();
      } finally {
        document.removeEventListener('keydown', onDialogEscape);
      }
    });

    it('selects the arrow-highlighted option with Enter', () => {
      const onChange = vi.fn();
      render(<Combobox value="" onChange={onChange} options={defaultOptions} />);
      const input = screen.getByRole('textbox');
      fireEvent.focus(input);

      fireEvent.keyDown(input, { key: 'ArrowDown' });
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      expect(screen.getByText('Beta').closest('button')).toHaveAttribute('data-active', 'true');

      fireEvent.keyDown(input, { key: 'Enter' });
      expect(onChange).toHaveBeenCalledWith('beta');
    });

    it('wraps the highlight around the option list with ArrowUp', () => {
      render(<Combobox value="" onChange={vi.fn()} options={defaultOptions} />);
      const input = screen.getByRole('textbox');
      fireEvent.focus(input);

      fireEvent.keyDown(input, { key: 'ArrowUp' });

      expect(screen.getByText('Delta').closest('button')).toHaveAttribute('data-active', 'true');
    });

    it('reopens a closed dropdown with ArrowDown', () => {
      render(<Combobox value="" onChange={vi.fn()} options={defaultOptions} />);
      const input = screen.getByRole('textbox');
      fireEvent.focus(input);
      fireEvent.keyDown(input, { key: 'Escape' });
      expect(screen.queryByText('Alpha')).toBeNull();

      fireEvent.keyDown(input, { key: 'ArrowDown' });

      expect(screen.getByText('Alpha')).toBeInTheDocument();
    });
  });

  it('anchors the dropdown to the input', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      top: 120,
      bottom: 148,
      left: 64,
      right: 264,
      width: 200,
      height: 28,
      x: 64,
      y: 120,
      toJSON: () => ({}),
    } as DOMRect);

    render(<Combobox value="" onChange={vi.fn()} options={defaultOptions} />);
    fireEvent.focus(screen.getByRole('textbox'));

    const dropdown = document.querySelector('.combobox-dropdown') as HTMLElement;
    expect(dropdown.style.position).toBe('fixed');
    expect(dropdown.style.top).toBe('152px');
    vi.restoreAllMocks();
  });
});
