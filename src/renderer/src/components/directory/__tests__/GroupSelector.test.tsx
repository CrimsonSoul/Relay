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

// Mock the PocketBase bridge group service
const mockUpdateGroup = vi.fn();
vi.mock('../../../services/bridgeGroupService', () => ({
  updateGroup: (...args: unknown[]) => mockUpdateGroup(...args),
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

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders group names', () => {
    render(<GroupSelector contact={contact} groups={groups} onClose={vi.fn()} />);
    expect(screen.getByText('Engineering')).toBeInTheDocument();
    expect(screen.getByText('Leadership')).toBeInTheDocument();
    expect(screen.getByText('Support')).toBeInTheDocument();
  });

  it('shows checkmark for groups the contact belongs to', () => {
    render(<GroupSelector contact={contact} groups={groups} onClose={vi.fn()} />);
    const checkmarks = screen.getAllByText('\u2713');
    expect(checkmarks).toHaveLength(1); // Only Engineering
  });

  it('toggles contact into a group (add)', async () => {
    mockUpdateGroup.mockResolvedValue({
      id: 'g2',
      name: 'Leadership',
      contacts: ['charlie@test.com', 'alice@test.com'],
    });

    render(<GroupSelector contact={contact} groups={groups} onClose={vi.fn()} />);

    fireEvent.click(screen.getByText('Leadership'));

    await waitFor(() => {
      expect(mockUpdateGroup).toHaveBeenCalledWith('g2', {
        contacts: ['charlie@test.com', 'alice@test.com'],
      });
    });
  });

  it('toggles contact into a group from keyboard', async () => {
    mockUpdateGroup.mockResolvedValue({
      id: 'g2',
      name: 'Leadership',
      contacts: ['charlie@test.com', 'alice@test.com'],
    });

    render(<GroupSelector contact={contact} groups={groups} onClose={vi.fn()} />);

    fireEvent.keyDown(screen.getByText('Leadership'), { key: 'Enter' });

    await waitFor(() => {
      expect(mockUpdateGroup).toHaveBeenCalledWith('g2', {
        contacts: ['charlie@test.com', 'alice@test.com'],
      });
    });
  });

  it('toggles contact out of a group (remove)', async () => {
    mockUpdateGroup.mockResolvedValue({
      id: 'g1',
      name: 'Engineering',
      contacts: ['bob@test.com'],
    });

    render(<GroupSelector contact={contact} groups={groups} onClose={vi.fn()} />);

    fireEvent.click(screen.getByText('Engineering'));

    await waitFor(() => {
      expect(mockUpdateGroup).toHaveBeenCalledWith('g1', {
        contacts: ['bob@test.com'],
      });
    });
  });

  it('rolls back on API failure and calls onError', async () => {
    mockUpdateGroup.mockRejectedValue(new Error('Update failed'));
    const onError = vi.fn();

    render(<GroupSelector contact={contact} groups={groups} onClose={vi.fn()} onError={onError} />);

    fireEvent.click(screen.getByText('Leadership'));

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith('Failed to add to Leadership');
    });
  });

  it('rolls back on API failure for remove and calls onError', async () => {
    mockUpdateGroup.mockRejectedValue(new Error('Update failed'));
    const onError = vi.fn();

    render(<GroupSelector contact={contact} groups={groups} onClose={vi.fn()} onError={onError} />);

    fireEvent.click(screen.getByText('Engineering'));

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith('Failed to remove from Engineering');
    });
  });

  it('handles thrown error and surfaces add failure message', async () => {
    mockUpdateGroup.mockRejectedValue(new Error('Network error'));
    const onError = vi.fn();

    render(<GroupSelector contact={contact} groups={groups} onClose={vi.fn()} onError={onError} />);

    fireEvent.keyDown(screen.getByText('Leadership'), { key: ' ' });

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith('Failed to add to Leadership');
    });
  });

  it('prevents concurrent updates', async () => {
    let resolveUpdate: () => void;
    mockUpdateGroup.mockReturnValue(
      new Promise<{ id: string }>((resolve) => {
        resolveUpdate = () => resolve({ id: 'g2' });
      }),
    );

    render(<GroupSelector contact={contact} groups={groups} onClose={vi.fn()} />);

    fireEvent.click(screen.getByText('Leadership'));
    fireEvent.click(screen.getByText('Support'));

    expect(mockUpdateGroup).toHaveBeenCalledTimes(1);

    resolveUpdate!();
    await waitFor(() => {
      expect(mockUpdateGroup).toHaveBeenCalledTimes(1);
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

    expect(screen.getByText('\u2713')).toBeInTheDocument();
  });
});
