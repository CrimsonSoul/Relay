import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { SearchInput } from '../SearchInput';

const componentStyles = readFileSync(
  resolve(process.cwd(), 'src/renderer/src/styles/components.css'),
  'utf8',
);

describe('SearchInput', () => {
  it('renders with a search icon', () => {
    const { container } = render(<SearchInput value="" onChange={vi.fn()} />);
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
    expect(svg).toHaveAttribute('stroke', 'currentColor');
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

  it('suppresses the browser-native search clear control in favor of the Relay control', () => {
    expect(componentStyles).toMatch(
      /input\.tactile-input\[type='search'\]::-webkit-search-cancel-button\s*\{[^}]*-webkit-appearance:\s*none;/s,
    );
  });
});
