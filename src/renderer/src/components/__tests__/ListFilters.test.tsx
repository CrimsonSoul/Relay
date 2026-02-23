import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ListFilters } from '../ListFilters';
import type { FilterDef } from '../../hooks/useListFilters';

const defaultProps = {
  hasNotesFilter: false,
  selectedTags: new Set<string>(),
  availableTags: [],
  activeExtras: new Set<string>(),
  extraFilters: [] as FilterDef<unknown>[],
  isAnyFilterActive: false,
  onToggleHasNotes: vi.fn(),
  onToggleTag: vi.fn(),
  onToggleExtra: vi.fn(),
  onClearAll: vi.fn(),
};

describe('ListFilters', () => {
  it('renders Has Notes button', () => {
    render(<ListFilters {...defaultProps} />);
    expect(screen.getByText('Has Notes')).toBeInTheDocument();
  });

  it('calls onToggleHasNotes when Has Notes is clicked', () => {
    const onToggleHasNotes = vi.fn();
    render(<ListFilters {...defaultProps} onToggleHasNotes={onToggleHasNotes} />);
    fireEvent.click(screen.getByText('Has Notes'));
    expect(onToggleHasNotes).toHaveBeenCalled();
  });

  it('renders tag buttons for availableTags', () => {
    render(<ListFilters {...defaultProps} availableTags={['ops', 'dev']} />);
    expect(screen.getByText('#ops')).toBeInTheDocument();
    expect(screen.getByText('#dev')).toBeInTheDocument();
  });

  it('calls onToggleTag when a tag is clicked', () => {
    const onToggleTag = vi.fn();
    render(<ListFilters {...defaultProps} availableTags={['ops']} onToggleTag={onToggleTag} />);
    fireEvent.click(screen.getByText('#ops'));
    expect(onToggleTag).toHaveBeenCalledWith('ops');
  });

  it('shows Clear button when isAnyFilterActive', () => {
    render(<ListFilters {...defaultProps} isAnyFilterActive={true} />);
    expect(screen.getByText('Clear')).toBeInTheDocument();
  });

  it('does not show Clear button when no filter active', () => {
    render(<ListFilters {...defaultProps} isAnyFilterActive={false} />);
    expect(screen.queryByText('Clear')).toBeNull();
  });

  it('calls onClearAll when Clear is clicked', () => {
    const onClearAll = vi.fn();
    render(<ListFilters {...defaultProps} isAnyFilterActive={true} onClearAll={onClearAll} />);
    fireEvent.click(screen.getByText('Clear'));
    expect(onClearAll).toHaveBeenCalled();
  });

  it('renders extra filters', () => {
    const extraFilters: FilterDef<unknown>[] = [{ key: 'on_call', label: 'On Call', fn: vi.fn() }];
    render(<ListFilters {...defaultProps} extraFilters={extraFilters} />);
    expect(screen.getByText('On Call')).toBeInTheDocument();
  });

  it('calls onToggleExtra when extra filter is clicked', () => {
    const onToggleExtra = vi.fn();
    const extraFilters: FilterDef<unknown>[] = [{ key: 'on_call', label: 'On Call', fn: vi.fn() }];
    render(
      <ListFilters {...defaultProps} extraFilters={extraFilters} onToggleExtra={onToggleExtra} />,
    );
    fireEvent.click(screen.getByText('On Call'));
    expect(onToggleExtra).toHaveBeenCalledWith('on_call');
  });
});
