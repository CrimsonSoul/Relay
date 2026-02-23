import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { RenameLocationModal } from '../RenameLocationModal';
import type { SavedLocation } from '@shared/ipc';

// Mock useFocusTrap
vi.mock('../../../hooks/useFocusTrap', () => ({
  useFocusTrap: () => ({ current: null }),
}));

const makeLocation = (overrides: Partial<SavedLocation> = {}): SavedLocation => ({
  id: 'loc-1',
  name: 'Headquarters',
  lat: 35.4676,
  lon: -97.5164,
  isDefault: false,
  ...overrides,
});

describe('RenameLocationModal', () => {
  it('renders the modal with correct title', () => {
    render(<RenameLocationModal location={makeLocation()} onClose={vi.fn()} onRename={vi.fn()} />);
    expect(screen.getByText('Rename Location')).toBeInTheDocument();
  });

  it('shows the location coordinates as subtitle', () => {
    render(<RenameLocationModal location={makeLocation()} onClose={vi.fn()} onRename={vi.fn()} />);
    expect(screen.getByText(/35\.4676/)).toBeInTheDocument();
    expect(screen.getByText(/-97\.5164/)).toBeInTheDocument();
  });

  it('pre-fills the input with the current location name', () => {
    render(
      <RenameLocationModal
        location={makeLocation({ name: 'My Office' })}
        onClose={vi.fn()}
        onRename={vi.fn()}
      />,
    );
    const input = screen.getByDisplayValue('My Office');
    expect(input).toBeInTheDocument();
  });

  it('calls onClose when Cancel is clicked', () => {
    const onClose = vi.fn();
    render(<RenameLocationModal location={makeLocation()} onClose={onClose} onRename={vi.fn()} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onRename with trimmed name when Rename is clicked', () => {
    const onRename = vi.fn();
    render(
      <RenameLocationModal
        location={makeLocation({ name: 'Old Name' })}
        onClose={vi.fn()}
        onRename={onRename}
      />,
    );
    const input = screen.getByDisplayValue('Old Name');
    fireEvent.change(input, { target: { value: '  New Name  ' } });
    fireEvent.click(screen.getByText('Rename'));
    expect(onRename).toHaveBeenCalledWith('New Name');
  });

  it('does not call onRename when name is empty', () => {
    const onRename = vi.fn();
    render(
      <RenameLocationModal
        location={makeLocation({ name: 'Old Name' })}
        onClose={vi.fn()}
        onRename={onRename}
      />,
    );
    const input = screen.getByDisplayValue('Old Name');
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.click(screen.getByText('Rename'));
    expect(onRename).not.toHaveBeenCalled();
  });

  it('does not call onRename when name is only whitespace', () => {
    const onRename = vi.fn();
    render(
      <RenameLocationModal
        location={makeLocation({ name: 'Old Name' })}
        onClose={vi.fn()}
        onRename={onRename}
      />,
    );
    const input = screen.getByDisplayValue('Old Name');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.click(screen.getByText('Rename'));
    expect(onRename).not.toHaveBeenCalled();
  });

  it('calls onRename on Enter keydown when name is valid', () => {
    const onRename = vi.fn();
    render(
      <RenameLocationModal
        location={makeLocation({ name: 'Old Name' })}
        onClose={vi.fn()}
        onRename={onRename}
      />,
    );
    const input = screen.getByDisplayValue('Old Name');
    fireEvent.change(input, { target: { value: 'New Name' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onRename).toHaveBeenCalledWith('New Name');
  });

  it('does not call onRename on Enter keydown when name is empty', () => {
    const onRename = vi.fn();
    render(
      <RenameLocationModal
        location={makeLocation({ name: 'Old Name' })}
        onClose={vi.fn()}
        onRename={onRename}
      />,
    );
    const input = screen.getByDisplayValue('Old Name');
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onRename).not.toHaveBeenCalled();
  });

  it('Rename button is disabled when name is empty', () => {
    render(
      <RenameLocationModal
        location={makeLocation({ name: 'Old Name' })}
        onClose={vi.fn()}
        onRename={vi.fn()}
      />,
    );
    const input = screen.getByDisplayValue('Old Name');
    fireEvent.change(input, { target: { value: '' } });
    const renameBtn = screen.getByText('Rename').closest('button');
    expect(renameBtn).toBeDisabled();
  });

  it('calls onClose when the modal close button is clicked', () => {
    const onClose = vi.fn();
    render(<RenameLocationModal location={makeLocation()} onClose={onClose} onRename={vi.fn()} />);
    fireEvent.click(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalled();
  });
});
