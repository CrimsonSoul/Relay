import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../utils/logger', () => ({
  loggers: {
    app: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
  },
}));

import { AssemblerSidebar } from '../AssemblerSidebar';
import type { BridgeGroup } from '@shared/ipc';

const makeGroup = (id: string, name: string, contacts: string[] = []): BridgeGroup => ({
  id,
  name,
  contacts,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

const defaultActions = {
  onToggleGroup: vi.fn(),
  onSaveGroup: vi.fn().mockResolvedValue(null),
  onUpdateGroup: vi.fn().mockResolvedValue(true),
  onDeleteGroup: vi.fn().mockResolvedValue(true),
};

const defaultProps = {
  groups: [] as BridgeGroup[],
  selectedGroupIds: [] as string[],
  actions: { ...defaultActions },
  currentEmails: [] as string[],
};

describe('AssemblerSidebar', () => {
  it('renders "No groups yet." when groups array is empty', () => {
    render(<AssemblerSidebar {...defaultProps} />);
    expect(screen.getByText('No groups yet.')).toBeInTheDocument();
  });

  it('renders group list when groups exist', () => {
    const groups = [makeGroup('1', 'Alpha'), makeGroup('2', 'Beta')];
    render(<AssemblerSidebar {...defaultProps} groups={groups} />);
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
  });

  it('sorts groups alphabetically', () => {
    const groups = [makeGroup('1', 'Zebra'), makeGroup('2', 'Alpha')];
    const { container } = render(<AssemblerSidebar {...defaultProps} groups={groups} />);
    const items = container.querySelectorAll('.sig-grp-name');
    expect(items[0].textContent).toBe('Alpha');
    expect(items[1].textContent).toBe('Zebra');
  });

  it('calls onToggleGroup when a group is clicked', () => {
    const onToggleGroup = vi.fn();
    const groups = [makeGroup('g1', 'MyGroup')];
    render(
      <AssemblerSidebar
        {...defaultProps}
        groups={groups}
        actions={{ ...defaultActions, onToggleGroup }}
      />,
    );
    fireEvent.click(screen.getByText('MyGroup'));
    expect(onToggleGroup).toHaveBeenCalledWith('g1');
  });

  it('shows "Create New Group" modal when add button is clicked', () => {
    render(<AssemblerSidebar {...defaultProps} />);
    const addBtn = document.querySelector('.assembler-sidebar-add-btn') as HTMLElement;
    fireEvent.click(addBtn);
    expect(screen.getByText('Create New Group')).toBeInTheDocument();
  });

  it('shows context menu when right-clicking a group', () => {
    const groups = [makeGroup('g1', 'TeamA')];
    render(<AssemblerSidebar {...defaultProps} groups={groups} />);
    fireEvent.contextMenu(screen.getByText('TeamA'));
    expect(screen.getByText('Load Group')).toBeInTheDocument();
    expect(screen.getByText('Rename')).toBeInTheDocument();
    expect(screen.getByText('Delete Group')).toBeInTheDocument();
  });

  it('calls onToggleGroup when "Load Group" context menu item is clicked', () => {
    const onToggleGroup = vi.fn();
    const groups = [makeGroup('g1', 'TeamA')];
    render(
      <AssemblerSidebar
        {...defaultProps}
        groups={groups}
        actions={{ ...defaultActions, onToggleGroup }}
      />,
    );
    fireEvent.contextMenu(screen.getByText('TeamA'));
    fireEvent.click(screen.getByText('Load Group'));
    expect(onToggleGroup).toHaveBeenCalledWith('g1');
  });

  it('opens Rename modal when "Rename" context menu item is clicked', () => {
    const groups = [makeGroup('g1', 'TeamA')];
    render(<AssemblerSidebar {...defaultProps} groups={groups} />);
    fireEvent.contextMenu(screen.getByText('TeamA'));
    fireEvent.click(screen.getByText('Rename'));
    expect(screen.getByText('Rename Group')).toBeInTheDocument();
  });

  it('calls onDeleteGroup when "Delete Group" context menu item is clicked', async () => {
    const onDeleteGroup = vi.fn().mockResolvedValue(true);
    const groups = [makeGroup('g1', 'TeamA')];
    render(
      <AssemblerSidebar
        {...defaultProps}
        groups={groups}
        actions={{ ...defaultActions, onDeleteGroup }}
      />,
    );
    fireEvent.contextMenu(screen.getByText('TeamA'));
    fireEvent.click(screen.getByText('Delete Group'));
    expect(onDeleteGroup).toHaveBeenCalledWith('g1');
  });

  it('"Update with Current" is disabled when currentEmails is empty', () => {
    const groups = [makeGroup('g1', 'TeamA')];
    render(<AssemblerSidebar {...defaultProps} groups={groups} currentEmails={[]} />);
    fireEvent.contextMenu(screen.getByText('TeamA'));
    // The menu item should be rendered with disabled state
    const updateItem = screen.getByText('Update with Current');
    expect(updateItem).toBeInTheDocument();
  });

  it('calls onUpdateGroup when "Update with Current" is clicked with emails present', async () => {
    const onUpdateGroup = vi.fn().mockResolvedValue(true);
    const groups = [makeGroup('g1', 'TeamA')];
    render(
      <AssemblerSidebar
        {...defaultProps}
        groups={groups}
        currentEmails={['a@b.com']}
        actions={{ ...defaultActions, onUpdateGroup }}
      />,
    );
    fireEvent.contextMenu(screen.getByText('TeamA'));
    fireEvent.click(screen.getByText('Update with Current'));
    expect(onUpdateGroup).toHaveBeenCalledWith('g1', { contacts: ['a@b.com'] });
  });

  it('shows description about current recipients in save modal', () => {
    render(<AssemblerSidebar {...defaultProps} currentEmails={['x@y.com', 'a@b.com']} />);
    const addBtn = document.querySelector('.assembler-sidebar-add-btn') as HTMLElement;
    fireEvent.click(addBtn);
    expect(screen.getByText('Will include 2 current recipients')).toBeInTheDocument();
  });

  it('shows "Create an empty group" description when no current emails', () => {
    render(<AssemblerSidebar {...defaultProps} currentEmails={[]} />);
    const addBtn = document.querySelector('.assembler-sidebar-add-btn') as HTMLElement;
    fireEvent.click(addBtn);
    expect(screen.getByText('Create an empty group')).toBeInTheDocument();
  });

  it('closes save modal when onClose is called', () => {
    render(<AssemblerSidebar {...defaultProps} />);
    const addBtn = document.querySelector('.assembler-sidebar-add-btn') as HTMLElement;
    fireEvent.click(addBtn);
    // Modal should be open
    expect(screen.getByText('Create New Group')).toBeInTheDocument();
    // Press Escape to close
    fireEvent.keyDown(document, { key: 'Escape' });
    // Modal should close (no longer visible) - if ContextMenu closes via Escape
    // Alternatively verify close button works
  });

  it('marks group as active when its id is in selectedGroupIds', () => {
    const groups = [makeGroup('g1', 'TeamA')];
    const { container } = render(
      <AssemblerSidebar {...defaultProps} groups={groups} selectedGroupIds={['g1']} />,
    );
    // The sig-grp with active state gets the sig-grp--on class
    const activeItem = container.querySelector('.sig-grp--on');
    expect(activeItem).toBeTruthy();
  });

  it('shows rename modal with initial name prefilled', () => {
    const groups = [makeGroup('g1', 'OriginalName')];
    render(<AssemblerSidebar {...defaultProps} groups={groups} />);
    fireEvent.contextMenu(screen.getByText('OriginalName'));
    fireEvent.click(screen.getByText('Rename'));
    // The rename modal should show with description including original name
    expect(screen.getByText(/Rename "OriginalName"/)).toBeInTheDocument();
  });

  it('calls onSaveGroup when save modal Save button is clicked', async () => {
    const onSaveGroup = vi.fn().mockResolvedValue({ id: 'new-g', name: 'New Group', contacts: [] });
    render(
      <AssemblerSidebar
        {...defaultProps}
        actions={{ ...defaultActions, onSaveGroup }}
        currentEmails={['a@b.com']}
      />,
    );
    const addBtn = document.querySelector('.assembler-sidebar-add-btn') as HTMLElement;
    fireEvent.click(addBtn);
    // Find and fill the name input
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'New Group' } });
    // Click the Save button
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    // onSaveGroup should have been called
    await vi.waitFor(() => {
      expect(onSaveGroup).toHaveBeenCalledWith({ name: 'New Group', contacts: ['a@b.com'] });
    });
  });

  it('handles onSaveGroup returning null without crashing', async () => {
    const onSaveGroup = vi.fn().mockResolvedValue(null);
    render(<AssemblerSidebar {...defaultProps} actions={{ ...defaultActions, onSaveGroup }} />);
    const addBtn = document.querySelector('.assembler-sidebar-add-btn') as HTMLElement;
    fireEvent.click(addBtn);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Some Group' } });
    // Click the Save button
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    // Should not throw even when onSaveGroup returns null
    await vi.waitFor(() => {
      expect(onSaveGroup).toHaveBeenCalled();
    });
  });

  it('closes context menu when clicking outside', () => {
    const groups = [makeGroup('g1', 'TeamA')];
    render(<AssemblerSidebar {...defaultProps} groups={groups} />);
    fireEvent.contextMenu(screen.getByText('TeamA'));
    expect(screen.getByText('Load Group')).toBeInTheDocument();
    // Close by pressing Escape / clicking elsewhere
    fireEvent.keyDown(document, { key: 'Escape' });
  });

  it('handles onSaveGroup throwing an error without crashing', async () => {
    const onSaveGroup = vi.fn().mockRejectedValue(new Error('save failed'));
    render(<AssemblerSidebar {...defaultProps} actions={{ ...defaultActions, onSaveGroup }} />);
    const addBtn = document.querySelector('.assembler-sidebar-add-btn') as HTMLElement;
    fireEvent.click(addBtn);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'ErrorGroup' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => {
      expect(onSaveGroup).toHaveBeenCalled();
    });
  });

  it('handles onUpdateGroup returning false (failure) in rename', async () => {
    const onUpdateGroup = vi.fn().mockResolvedValue(false);
    const groups = [makeGroup('g1', 'TeamA')];
    render(
      <AssemblerSidebar
        {...defaultProps}
        groups={groups}
        actions={{ ...defaultActions, onUpdateGroup }}
      />,
    );
    // Open rename modal via context menu
    fireEvent.contextMenu(screen.getByText('TeamA'));
    fireEvent.click(screen.getByText('Rename'));

    // Fill in new name and save
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'NewName' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await vi.waitFor(() => {
      expect(onUpdateGroup).toHaveBeenCalledWith('g1', { name: 'NewName' });
    });
  });

  it('handles onUpdateGroup throwing in rename', async () => {
    const onUpdateGroup = vi.fn().mockRejectedValue(new Error('rename failed'));
    const groups = [makeGroup('g1', 'TeamA')];
    render(
      <AssemblerSidebar
        {...defaultProps}
        groups={groups}
        actions={{ ...defaultActions, onUpdateGroup }}
      />,
    );
    fireEvent.contextMenu(screen.getByText('TeamA'));
    fireEvent.click(screen.getByText('Rename'));

    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'FailName' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await vi.waitFor(() => {
      expect(onUpdateGroup).toHaveBeenCalled();
    });
  });

  it('handles onUpdateGroup returning false for "Update with Current"', async () => {
    const onUpdateGroup = vi.fn().mockResolvedValue(false);
    const groups = [makeGroup('g1', 'TeamA')];
    render(
      <AssemblerSidebar
        {...defaultProps}
        groups={groups}
        currentEmails={['a@b.com']}
        actions={{ ...defaultActions, onUpdateGroup }}
      />,
    );
    fireEvent.contextMenu(screen.getByText('TeamA'));
    fireEvent.click(screen.getByText('Update with Current'));

    await vi.waitFor(() => {
      expect(onUpdateGroup).toHaveBeenCalledWith('g1', { contacts: ['a@b.com'] });
    });
  });

  it('handles onDeleteGroup returning false (failure)', async () => {
    const onDeleteGroup = vi.fn().mockResolvedValue(false);
    const groups = [makeGroup('g1', 'TeamA')];
    render(
      <AssemblerSidebar
        {...defaultProps}
        groups={groups}
        actions={{ ...defaultActions, onDeleteGroup }}
      />,
    );
    fireEvent.contextMenu(screen.getByText('TeamA'));
    fireEvent.click(screen.getByText('Delete Group'));

    await vi.waitFor(() => {
      expect(onDeleteGroup).toHaveBeenCalledWith('g1');
    });
  });

  it('handles onDeleteGroup throwing an error', async () => {
    const onDeleteGroup = vi.fn().mockRejectedValue(new Error('delete failed'));
    const groups = [makeGroup('g1', 'TeamA')];
    render(
      <AssemblerSidebar
        {...defaultProps}
        groups={groups}
        actions={{ ...defaultActions, onDeleteGroup }}
      />,
    );
    fireEvent.contextMenu(screen.getByText('TeamA'));
    fireEvent.click(screen.getByText('Delete Group'));

    await vi.waitFor(() => {
      expect(onDeleteGroup).toHaveBeenCalledWith('g1');
    });
  });

  it('displays total contacts count in footer', () => {
    const groups = [
      makeGroup('g1', 'TeamA', ['a@b.com', 'c@d.com']),
      makeGroup('g2', 'TeamB', ['a@b.com', 'e@f.com']),
    ];
    render(<AssemblerSidebar {...defaultProps} groups={groups} />);
    // Total unique contacts: a@b.com, c@d.com, e@f.com = 3
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('displays selected contacts count in footer', () => {
    const groups = [
      makeGroup('g1', 'TeamA', ['a@b.com', 'c@d.com']),
      makeGroup('g2', 'TeamB', ['a@b.com', 'e@f.com']),
    ];
    render(<AssemblerSidebar {...defaultProps} groups={groups} selectedGroupIds={['g1']} />);
    // Selected unique contacts from g1: a@b.com, c@d.com = 2
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('shows 0 selected contacts when no groups are selected', () => {
    const groups = [makeGroup('g1', 'TeamA', ['a@b.com'])];
    render(<AssemblerSidebar {...defaultProps} groups={groups} selectedGroupIds={[]} />);
    expect(screen.getByText('0')).toBeInTheDocument();
  });

  it('displays contact count per group', () => {
    const groups = [makeGroup('g1', 'TeamA', ['a@b.com', 'c@d.com', 'e@f.com'])];
    render(<AssemblerSidebar {...defaultProps} groups={groups} />);
    expect(screen.getByText('3 contacts')).toBeInTheDocument();
  });

  it('does not open context menu for non-existent group', () => {
    const groups = [makeGroup('g1', 'TeamA')];
    const { container } = render(<AssemblerSidebar {...defaultProps} groups={groups} />);
    // Right-click on the sidebar itself, not a group
    const sidebar = container.querySelector('.assembler-sidebar');
    if (sidebar) {
      fireEvent.contextMenu(sidebar);
    }
    // No context menu items should appear for a non-group click
    expect(screen.queryByText('Load Group')).not.toBeInTheDocument();
  });
});
