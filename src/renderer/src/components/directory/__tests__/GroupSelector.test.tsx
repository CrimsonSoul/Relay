import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GroupSelector } from '../GroupSelector';
import type { Contact, BridgeGroup } from '@shared/ipc';

// Mock logger
vi.mock('../../../utils/logger', () => ({
  loggers: {
    directory: { error: vi.fn() },
  },
}));

const makeContact = (email: string): Contact => ({
  name: email.split('@')[0],
  email,
  phone: '',
  title: '',
  _searchString: email.toLowerCase(),
  raw: {},
});

const makeGroup = (id: string, name: string, emails: string[]): BridgeGroup => ({
  id,
  name,
  contacts: emails,
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

describe('GroupSelector', () => {
  const contact = makeContact('alice@test.com');
  const groups = [
    makeGroup('g1', 'Engineering', ['alice@test.com', 'bob@test.com']),
    makeGroup('g2', 'Leadership', ['charlie@test.com']),
    makeGroup('g3', 'Support', []),
  ];

  const mockApi = {
    updateGroup: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as Window & { api: typeof mockApi }).api = mockApi as typeof globalThis.api;
  });

  it('renders group names', () => {
    render(<GroupSelector contact={contact} groups={groups} onClose={vi.fn()} />);
    expect(screen.getByText('Engineering')).toBeInTheDocument();
    expect(screen.getByText('Leadership')).toBeInTheDocument();
    expect(screen.getByText('Support')).toBeInTheDocument();
  });

  it('shows checkmark for groups the contact belongs to', () => {
    render(<GroupSelector contact={contact} groups={groups} onClose={vi.fn()} />);
    // Alice is in Engineering, should have checkmark
    const checkmarks = screen.getAllByText('✓');
    expect(checkmarks).toHaveLength(1); // Only Engineering
  });

  it('toggles contact into a group (add)', async () => {
    mockApi.updateGroup.mockResolvedValue({ success: true });

    render(<GroupSelector contact={contact} groups={groups} onClose={vi.fn()} />);

    // Click on Leadership (alice is NOT a member)
    fireEvent.click(screen.getByText('Leadership'));

    await waitFor(() => {
      expect(mockApi.updateGroup).toHaveBeenCalledWith('g2', {
        contacts: ['charlie@test.com', 'alice@test.com'],
      });
    });
  });

  it('toggles contact out of a group (remove)', async () => {
    mockApi.updateGroup.mockResolvedValue({ success: true });

    render(<GroupSelector contact={contact} groups={groups} onClose={vi.fn()} />);

    // Click on Engineering (alice IS a member)
    fireEvent.click(screen.getByText('Engineering'));

    await waitFor(() => {
      expect(mockApi.updateGroup).toHaveBeenCalledWith('g1', {
        contacts: ['bob@test.com'], // alice removed
      });
    });
  });

  it('rolls back on API failure and calls onError', async () => {
    mockApi.updateGroup.mockResolvedValue(false);
    const onError = vi.fn();

    render(<GroupSelector contact={contact} groups={groups} onClose={vi.fn()} onError={onError} />);

    // Try to add to Leadership
    fireEvent.click(screen.getByText('Leadership'));

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith('Failed to add to Leadership');
    });
  });

  it('rolls back on API failure for remove and calls onError', async () => {
    mockApi.updateGroup.mockResolvedValue(false);
    const onError = vi.fn();

    render(<GroupSelector contact={contact} groups={groups} onClose={vi.fn()} onError={onError} />);

    // Try to remove from Engineering
    fireEvent.click(screen.getByText('Engineering'));

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith('Failed to remove from Engineering');
    });
  });

  it('prevents concurrent updates', async () => {
    // Create a promise that won't resolve immediately
    let resolveUpdate: () => void;
    mockApi.updateGroup.mockReturnValue(
      new Promise<{ success: boolean }>((resolve) => {
        resolveUpdate = () => resolve({ success: true });
      }),
    );

    render(<GroupSelector contact={contact} groups={groups} onClose={vi.fn()} />);

    // Click one group
    fireEvent.click(screen.getByText('Leadership'));

    // Try clicking another while first is pending
    fireEvent.click(screen.getByText('Support'));

    // Only one API call should have been made
    expect(mockApi.updateGroup).toHaveBeenCalledTimes(1);

    // Resolve the first call
    resolveUpdate!();
    await waitFor(() => {
      expect(mockApi.updateGroup).toHaveBeenCalledTimes(1);
    });
  });

  it('shows empty state when no groups', () => {
    render(<GroupSelector contact={contact} groups={[]} onClose={vi.fn()} />);
    expect(screen.getByText('No groups available')).toBeInTheDocument();
  });

  it('handles case-insensitive email matching', () => {
    const upperContact = makeContact('Alice@Test.Com');
    const groupWithLower = makeGroup('g1', 'Team', ['alice@test.com']);

    render(<GroupSelector contact={upperContact} groups={[groupWithLower]} onClose={vi.fn()} />);

    // Should still show checkmark (case-insensitive match)
    expect(screen.getByText('✓')).toBeInTheDocument();
  });
});
