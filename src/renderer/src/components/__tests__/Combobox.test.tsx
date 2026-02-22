import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
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
});
