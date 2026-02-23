import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { SearchInput } from '../SearchInput';

describe('SearchInput', () => {
  it('renders with a search icon', () => {
    const { container } = render(<SearchInput value="" onChange={vi.fn()} />);
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
  });

  it('renders with the provided value', () => {
    render(<SearchInput value="hello" onChange={vi.fn()} />);
    const input = screen.getByDisplayValue('hello');
    expect(input).toBeInTheDocument();
  });

  it('renders with placeholder', () => {
    render(<SearchInput value="" onChange={vi.fn()} placeholder="Search..." />);
    expect(screen.getByPlaceholderText('Search...')).toBeInTheDocument();
  });

  it('calls onChange when user types', () => {
    const onChange = vi.fn();
    render(<SearchInput value="" onChange={onChange} />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'test' } });
    expect(onChange).toHaveBeenCalled();
  });
});
