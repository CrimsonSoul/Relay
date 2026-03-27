import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import type { FontSize } from '../types';

type MockTactileButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  children?: React.ReactNode;
};

vi.mock('../../../../components/TactileButton', () => ({
  TactileButton: ({ children, onClick, ...props }: MockTactileButtonProps) => (
    <button onClick={onClick} {...props}>
      {children}
    </button>
  ),
}));

import { NoteToolbar } from '../NoteToolbar';

function defaultProps(overrides: Record<string, unknown> = {}) {
  return {
    allTags: [] as string[],
    activeTag: null as string | null,
    onTagClick: vi.fn(),
    fontSize: 'md' as FontSize,
    onFontSizeChange: vi.fn(),
    onNewNote: vi.fn(),
    noteCount: 5,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('NoteToolbar', () => {
  it('renders S, M, L font size buttons', () => {
    render(<NoteToolbar {...defaultProps()} />);

    expect(screen.getByRole('button', { name: 'Font size S' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Font size M' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Font size L' })).toBeDefined();
  });

  it('marks the active font size button', () => {
    render(<NoteToolbar {...defaultProps({ fontSize: 'lg' })} />);

    expect(screen.getByRole('button', { name: 'Font size L' }).className).toContain('is-active');
    expect(screen.getByRole('button', { name: 'Font size S' }).className).not.toContain(
      'is-active',
    );
  });

  it('calls onFontSizeChange when a size button is clicked', () => {
    const onFontSizeChange = vi.fn();
    render(<NoteToolbar {...defaultProps({ onFontSizeChange })} />);

    fireEvent.click(screen.getByRole('button', { name: 'Font size S' }));
    expect(onFontSizeChange).toHaveBeenCalledWith('sm');
  });

  it('calls onNewNote when New Note is clicked', () => {
    const onNewNote = vi.fn();
    render(<NoteToolbar {...defaultProps({ onNewNote })} />);

    fireEvent.click(screen.getByText('NEW NOTE'));
    expect(onNewNote).toHaveBeenCalledOnce();
  });

  it('does not render tag pills when allTags is empty', () => {
    render(<NoteToolbar {...defaultProps({ allTags: [] })} />);
    expect(screen.queryByText('All (5)')).toBeNull();
  });

  it('renders tag pills and toggles active tag', () => {
    const onTagClick = vi.fn();
    render(
      <NoteToolbar
        {...defaultProps({
          allTags: ['ops', 'infra'],
          activeTag: 'ops',
          onTagClick,
          noteCount: 12,
        })}
      />,
    );

    expect(screen.getByText('All (12)')).toBeDefined();
    expect(screen.getByText('ops').className).toContain('is-active');

    fireEvent.click(screen.getByText('ops'));
    expect(onTagClick).toHaveBeenCalledWith(null);

    fireEvent.click(screen.getByText('infra'));
    expect(onTagClick).toHaveBeenCalledWith('infra');
  });
});
