import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CommandPalette } from '../CommandPalette';
import type { SearchResult } from '../../hooks/useCommandSearch';

const useCommandSearchMock = vi.fn();

vi.mock('../../hooks/useCommandSearch', () => ({
  useCommandSearch: (...args: unknown[]) => useCommandSearchMock(...args),
}));

describe('CommandPalette', () => {
  const baseProps = {
    isOpen: true,
    onClose: vi.fn(),
    contacts: [
      { name: 'Alpha', email: 'alpha@test.com', phone: '', title: '', _searchString: '', raw: {} },
    ],
    servers: [
      {
        name: 'Server A',
        businessArea: '',
        lob: '',
        comment: '',
        owner: '',
        contact: '',
        os: '',
        _searchString: '',
        raw: {},
      },
    ],
    groups: [
      { id: 'g1', name: 'Group A', contacts: ['alpha@test.com'], createdAt: 0, updatedAt: 0 },
    ],
    onAddContactToBridge: vi.fn(),
    onToggleGroup: vi.fn(),
    onNavigateToTab: vi.fn(),
    onOpenAddContact: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    useCommandSearchMock.mockReturnValue([]);
    Object.defineProperty(globalThis.HTMLElement.prototype, 'scrollIntoView', {
      value: vi.fn(),
      configurable: true,
    });
  });

  it('returns null when closed', () => {
    const { container } = render(<CommandPalette {...baseProps} isOpen={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders empty state and closes from backdrop and escape', () => {
    render(<CommandPalette {...baseProps} />);

    expect(screen.getByText('No results found')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Close command palette backdrop'));
    expect(baseProps.onClose).toHaveBeenCalled();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(baseProps.onClose).toHaveBeenCalledTimes(2);
  });

  it('supports keyboard navigation and selects a contact', () => {
    const results: SearchResult[] = [
      {
        id: 'c1',
        type: 'contact',
        title: 'Alpha',
        subtitle: 'alpha@test.com',
        iconType: 'contact',
        data: baseProps.contacts[0],
      },
      {
        id: 'g1',
        type: 'group',
        title: 'Group A',
        subtitle: '',
        iconType: 'group',
        data: baseProps.groups[0],
      },
    ];
    useCommandSearchMock.mockReturnValue(results);

    render(<CommandPalette {...baseProps} />);
    const input = screen.getByLabelText('Search command palette');

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(baseProps.onAddContactToBridge).toHaveBeenCalledWith('alpha@test.com');
    expect(baseProps.onClose).toHaveBeenCalled();
  });

  it('handles action/server/group result types', () => {
    const results: SearchResult[] = [
      {
        id: 'a1',
        type: 'action',
        title: 'Go Weather',
        subtitle: '',
        iconType: 'navigate',
        data: { action: 'navigate', tab: 'Weather' },
      },
      {
        id: 'a2',
        type: 'action',
        title: 'Create Contact',
        subtitle: '',
        iconType: 'create',
        data: { action: 'create-contact', value: 'new@test.com' },
      },
      {
        id: 'a3',
        type: 'action',
        title: 'Add Manual',
        subtitle: '',
        iconType: 'add',
        data: { action: 'add-manual', value: 'manual@test.com' },
      },
      {
        id: 's1',
        type: 'server',
        title: 'Server A',
        subtitle: '',
        iconType: 'server',
        data: baseProps.servers[0],
      },
      {
        id: 'g1',
        type: 'group',
        title: 'Group A',
        subtitle: '',
        iconType: 'group',
        data: baseProps.groups[0],
      },
    ];
    useCommandSearchMock.mockReturnValue(results);

    render(<CommandPalette {...baseProps} />);

    fireEvent.click(screen.getByText('Go Weather').closest('button')!);
    fireEvent.click(screen.getByText('Create Contact').closest('button')!);
    fireEvent.click(screen.getByText('Add Manual').closest('button')!);
    fireEvent.click(screen.getByText('Server A').closest('button')!);
    fireEvent.click(screen.getByText('Group A').closest('button')!);

    expect(baseProps.onNavigateToTab).toHaveBeenCalledWith('Weather');
    expect(baseProps.onOpenAddContact).toHaveBeenCalledWith('new@test.com');
    expect(baseProps.onAddContactToBridge).toHaveBeenCalledWith('manual@test.com');
    expect(baseProps.onNavigateToTab).toHaveBeenCalledWith('Servers');
    expect(baseProps.onToggleGroup).toHaveBeenCalledWith('g1');
  });
});
