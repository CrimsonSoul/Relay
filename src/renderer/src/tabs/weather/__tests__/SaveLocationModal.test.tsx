import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { SaveLocationModal } from '../SaveLocationModal';
import type { Location } from '../types';

// Mock useFocusTrap
vi.mock('../../../hooks/useFocusTrap', () => ({
  useFocusTrap: () => ({ current: null }),
}));

const makeLocation = (overrides: Partial<Location> = {}): Location => ({
  latitude: 35.4676,
  longitude: -97.5164,
  name: 'Oklahoma City, OK',
  ...overrides,
});

describe('SaveLocationModal', () => {
  it('renders the modal with correct title', () => {
    render(<SaveLocationModal location={makeLocation()} onClose={vi.fn()} onSave={vi.fn()} />);
    expect(screen.getByText('Save Location')).toBeInTheDocument();
  });

  it('shows the location name and coordinates', () => {
    render(<SaveLocationModal location={makeLocation()} onClose={vi.fn()} onSave={vi.fn()} />);
    expect(screen.getByText(/Oklahoma City, OK/)).toBeInTheDocument();
    expect(screen.getByText(/35\.4676/)).toBeInTheDocument();
    expect(screen.getByText(/-97\.5164/)).toBeInTheDocument();
  });

  it('starts with empty name input', () => {
    render(<SaveLocationModal location={makeLocation()} onClose={vi.fn()} onSave={vi.fn()} />);
    const input = screen.getByPlaceholderText('e.g., HQ, Store #1234') as HTMLInputElement;
    expect(input.value).toBe('');
  });

  it('starts with save-as-default unchecked', () => {
    render(<SaveLocationModal location={makeLocation()} onClose={vi.fn()} onSave={vi.fn()} />);
    const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
  });

  it('calls onClose when Cancel is clicked', () => {
    const onClose = vi.fn();
    render(<SaveLocationModal location={makeLocation()} onClose={onClose} onSave={vi.fn()} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not call onSave when name is empty', () => {
    const onSave = vi.fn();
    render(<SaveLocationModal location={makeLocation()} onClose={vi.fn()} onSave={onSave} />);
    fireEvent.click(screen.getByText('Save'));
    expect(onSave).not.toHaveBeenCalled();
  });

  it('calls onSave with trimmed name and default=false when Save is clicked', () => {
    const onSave = vi.fn();
    render(<SaveLocationModal location={makeLocation()} onClose={vi.fn()} onSave={onSave} />);
    const input = screen.getByPlaceholderText('e.g., HQ, Store #1234');
    fireEvent.change(input, { target: { value: '  My Station  ' } });
    fireEvent.click(screen.getByText('Save'));
    expect(onSave).toHaveBeenCalledWith('My Station', false);
  });

  it('calls onSave with isDefault=true when checkbox is checked', () => {
    const onSave = vi.fn();
    render(<SaveLocationModal location={makeLocation()} onClose={vi.fn()} onSave={onSave} />);
    const input = screen.getByPlaceholderText('e.g., HQ, Store #1234');
    fireEvent.change(input, { target: { value: 'HQ' } });
    const checkbox = screen.getByRole('checkbox');
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByText('Save'));
    expect(onSave).toHaveBeenCalledWith('HQ', true);
  });

  it('Save button is disabled when name is empty', () => {
    render(<SaveLocationModal location={makeLocation()} onClose={vi.fn()} onSave={vi.fn()} />);
    const saveBtn = screen.getByText('Save').closest('button');
    expect(saveBtn).toBeDisabled();
  });

  it('Save button is enabled when name is non-empty', () => {
    render(<SaveLocationModal location={makeLocation()} onClose={vi.fn()} onSave={vi.fn()} />);
    const input = screen.getByPlaceholderText('e.g., HQ, Store #1234');
    fireEvent.change(input, { target: { value: 'HQ' } });
    const saveBtn = screen.getByText('Save').closest('button');
    expect(saveBtn).not.toBeDisabled();
  });

  it('does not call onSave when name is only whitespace', () => {
    const onSave = vi.fn();
    render(<SaveLocationModal location={makeLocation()} onClose={vi.fn()} onSave={onSave} />);
    const input = screen.getByPlaceholderText('e.g., HQ, Store #1234');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.click(screen.getByText('Save'));
    expect(onSave).not.toHaveBeenCalled();
  });

  it('renders correctly when location is null', () => {
    render(<SaveLocationModal location={null} onClose={vi.fn()} onSave={vi.fn()} />);
    expect(screen.getByText('Save Location')).toBeInTheDocument();
  });

  it('calls onClose when modal close button is clicked', () => {
    const onClose = vi.fn();
    render(<SaveLocationModal location={makeLocation()} onClose={onClose} onSave={vi.fn()} />);
    fireEvent.click(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalled();
  });
});
