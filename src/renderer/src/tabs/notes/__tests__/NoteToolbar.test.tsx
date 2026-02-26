import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import type { NoteSort, FontSize } from '../types';

vi.mock('../../../../components/TactileButton', () => ({
  TactileButton: ({ children, onClick, ...props }: any) => (
    <button onClick={onClick} {...props}>
      {children}
    </button>
  ),
}));

import { NoteToolbar } from '../NoteToolbar';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function defaultProps(overrides: Record<string, unknown> = {}) {
  return {
    allTags: [] as string[],
    activeTag: null as string | null,
    onTagClick: vi.fn(),
    sort: { key: 'updatedAt', direction: 'desc' } as NoteSort,
    onSortChange: vi.fn(),
    fontSize: 'md' as FontSize,
    onFontSizeChange: vi.fn(),
    onNewNote: vi.fn(),
    noteCount: 5,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

// ===========================================================================
// Tests
// ===========================================================================

describe('NoteToolbar', () => {
  // -------------------------------------------------------------------------
  // 1. Font size buttons
  // -------------------------------------------------------------------------
  describe('font size buttons', () => {
    it('renders S, M, L buttons', () => {
      render(<NoteToolbar {...defaultProps()} />);

      expect(screen.getByRole('button', { name: 'Font size S' })).toBeDefined();
      expect(screen.getByRole('button', { name: 'Font size M' })).toBeDefined();
      expect(screen.getByRole('button', { name: 'Font size L' })).toBeDefined();
    });

    it('marks the active font size with is-active class', () => {
      render(<NoteToolbar {...defaultProps({ fontSize: 'lg' })} />);

      const lgBtn = screen.getByRole('button', { name: 'Font size L' });
      const smBtn = screen.getByRole('button', { name: 'Font size S' });

      expect(lgBtn.className).toContain('is-active');
      expect(smBtn.className).not.toContain('is-active');
    });

    it('marks md as active by default', () => {
      render(<NoteToolbar {...defaultProps({ fontSize: 'md' })} />);

      const mdBtn = screen.getByRole('button', { name: 'Font size M' });
      expect(mdBtn.className).toContain('is-active');
    });
  });

  // -------------------------------------------------------------------------
  // 2. Clicking font size button
  // -------------------------------------------------------------------------
  describe('clicking font size button', () => {
    it('calls onFontSizeChange with "sm" when S is clicked', () => {
      const onFontSizeChange = vi.fn();
      render(<NoteToolbar {...defaultProps({ onFontSizeChange })} />);

      fireEvent.click(screen.getByRole('button', { name: 'Font size S' }));

      expect(onFontSizeChange).toHaveBeenCalledWith('sm');
    });

    it('calls onFontSizeChange with "lg" when L is clicked', () => {
      const onFontSizeChange = vi.fn();
      render(<NoteToolbar {...defaultProps({ onFontSizeChange })} />);

      fireEvent.click(screen.getByRole('button', { name: 'Font size L' }));

      expect(onFontSizeChange).toHaveBeenCalledWith('lg');
    });
  });

  // -------------------------------------------------------------------------
  // 3. Sort select
  // -------------------------------------------------------------------------
  describe('sort select', () => {
    it('shows correct value for the current sort key', () => {
      render(<NoteToolbar {...defaultProps({ sort: { key: 'title', direction: 'asc' } })} />);

      const select = screen.getByRole('combobox', { name: 'Sort notes by' }) as HTMLSelectElement;
      expect(select.value).toBe('title');
    });

    it('has all four sort options', () => {
      render(<NoteToolbar {...defaultProps()} />);

      const options = screen.getAllByRole('option');
      const values = options.map((o) => (o as HTMLOptionElement).value);
      expect(values).toEqual(['updatedAt', 'createdAt', 'title', 'color']);
    });

    it('calls onSortChange when selection changes', () => {
      const onSortChange = vi.fn();
      render(
        <NoteToolbar
          {...defaultProps({ onSortChange, sort: { key: 'updatedAt', direction: 'desc' } })}
        />,
      );

      const select = screen.getByRole('combobox', { name: 'Sort notes by' });
      fireEvent.change(select, { target: { value: 'createdAt' } });

      expect(onSortChange).toHaveBeenCalledWith({ key: 'createdAt', direction: 'desc' });
    });
  });

  // -------------------------------------------------------------------------
  // 4. Sort direction button
  // -------------------------------------------------------------------------
  describe('sort direction button', () => {
    it('shows "Sort ascending" label when direction is desc', () => {
      render(<NoteToolbar {...defaultProps({ sort: { key: 'updatedAt', direction: 'desc' } })} />);

      expect(screen.getByRole('button', { name: 'Sort ascending' })).toBeDefined();
    });

    it('shows "Sort descending" label when direction is asc', () => {
      render(<NoteToolbar {...defaultProps({ sort: { key: 'updatedAt', direction: 'asc' } })} />);

      expect(screen.getByRole('button', { name: 'Sort descending' })).toBeDefined();
    });

    it('toggles direction from desc to asc when clicked', () => {
      const onSortChange = vi.fn();
      render(
        <NoteToolbar
          {...defaultProps({ onSortChange, sort: { key: 'updatedAt', direction: 'desc' } })}
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: 'Sort ascending' }));

      expect(onSortChange).toHaveBeenCalledWith({ key: 'updatedAt', direction: 'asc' });
    });

    it('toggles direction from asc to desc when clicked', () => {
      const onSortChange = vi.fn();
      render(
        <NoteToolbar
          {...defaultProps({ onSortChange, sort: { key: 'title', direction: 'asc' } })}
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: 'Sort descending' }));

      expect(onSortChange).toHaveBeenCalledWith({ key: 'title', direction: 'desc' });
    });
  });

  // -------------------------------------------------------------------------
  // 5. New Note button
  // -------------------------------------------------------------------------
  describe('New Note button', () => {
    it('calls onNewNote when clicked', () => {
      const onNewNote = vi.fn();
      render(<NoteToolbar {...defaultProps({ onNewNote })} />);

      fireEvent.click(screen.getByText('New Note'));

      expect(onNewNote).toHaveBeenCalledOnce();
    });
  });

  // -------------------------------------------------------------------------
  // 6. Tag pills - hidden when allTags is empty
  // -------------------------------------------------------------------------
  describe('tag pills (empty)', () => {
    it('does not render tag pills when allTags is empty', () => {
      render(<NoteToolbar {...defaultProps({ allTags: [] })} />);

      expect(screen.queryByText('All (5)')).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // 7. Tag pills - shown when allTags has items
  // -------------------------------------------------------------------------
  describe('tag pills (with tags)', () => {
    it('renders "All" pill with noteCount and tag pills', () => {
      render(<NoteToolbar {...defaultProps({ allTags: ['ops', 'infra'], noteCount: 12 })} />);

      expect(screen.getByText('All (12)')).toBeDefined();
      expect(screen.getByText('ops')).toBeDefined();
      expect(screen.getByText('infra')).toBeDefined();
    });

    it('"All" pill has is-active class when activeTag is null', () => {
      render(<NoteToolbar {...defaultProps({ allTags: ['ops'], activeTag: null })} />);

      const allBtn = screen.getByText('All (5)');
      expect(allBtn.className).toContain('is-active');
    });

    it('tag pill has is-active class when it matches activeTag', () => {
      render(<NoteToolbar {...defaultProps({ allTags: ['ops', 'infra'], activeTag: 'ops' })} />);

      const opsBtn = screen.getByText('ops');
      expect(opsBtn.className).toContain('is-active');

      const infraBtn = screen.getByText('infra');
      expect(infraBtn.className).not.toContain('is-active');
    });
  });

  // -------------------------------------------------------------------------
  // 8. Clicking a tag
  // -------------------------------------------------------------------------
  describe('clicking a tag pill', () => {
    it('calls onTagClick with the tag name when an inactive tag is clicked', () => {
      const onTagClick = vi.fn();
      render(
        <NoteToolbar
          {...defaultProps({ allTags: ['ops', 'infra'], activeTag: null, onTagClick })}
        />,
      );

      fireEvent.click(screen.getByText('ops'));

      expect(onTagClick).toHaveBeenCalledWith('ops');
    });
  });

  // -------------------------------------------------------------------------
  // 9. Clicking active tag deactivates it
  // -------------------------------------------------------------------------
  describe('clicking active tag', () => {
    it('calls onTagClick(null) when the currently active tag is clicked', () => {
      const onTagClick = vi.fn();
      render(<NoteToolbar {...defaultProps({ allTags: ['ops'], activeTag: 'ops', onTagClick })} />);

      fireEvent.click(screen.getByText('ops'));

      expect(onTagClick).toHaveBeenCalledWith(null);
    });
  });

  // -------------------------------------------------------------------------
  // 10. Clicking "All" pill
  // -------------------------------------------------------------------------
  describe('clicking "All" pill', () => {
    it('calls onTagClick(null)', () => {
      const onTagClick = vi.fn();
      render(<NoteToolbar {...defaultProps({ allTags: ['ops'], activeTag: 'ops', onTagClick })} />);

      fireEvent.click(screen.getByText('All (5)'));

      expect(onTagClick).toHaveBeenCalledWith(null);
    });
  });
});
