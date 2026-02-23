import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ContextMenu } from '../ContextMenu';

describe('ContextMenu', () => {
  const defaultItems = [
    { label: 'Edit', onClick: vi.fn() },
    { label: 'Delete', onClick: vi.fn(), danger: true },
    { label: 'View', onClick: vi.fn(), disabled: true },
  ];

  it('renders items in the menu', () => {
    render(<ContextMenu x={100} y={100} onClose={vi.fn()} items={defaultItems} />);
    expect(screen.getByText('Edit')).toBeInTheDocument();
    expect(screen.getByText('Delete')).toBeInTheDocument();
    expect(screen.getByText('View')).toBeInTheDocument();
  });

  it('calls onClose when backdrop is clicked', () => {
    const onClose = vi.fn();
    render(<ContextMenu x={100} y={100} onClose={onClose} items={defaultItems} />);
    fireEvent.click(screen.getByLabelText('Close context menu'));
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when backdrop receives a context menu event', () => {
    const onClose = vi.fn();
    render(<ContextMenu x={100} y={100} onClose={onClose} items={defaultItems} />);
    fireEvent.contextMenu(screen.getByLabelText('Close context menu'));
    expect(onClose).toHaveBeenCalled();
  });

  it('calls item onClick and onClose when a non-disabled item is clicked', () => {
    const onClose = vi.fn();
    const editClick = vi.fn();
    const items = [{ label: 'Edit', onClick: editClick }];
    render(<ContextMenu x={10} y={10} onClose={onClose} items={items} />);
    fireEvent.click(screen.getByText('Edit'));
    expect(editClick).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('does not call item onClick when a disabled item is clicked', () => {
    const disabledClick = vi.fn();
    const onClose = vi.fn();
    const items = [{ label: 'View', onClick: disabledClick, disabled: true }];
    render(<ContextMenu x={10} y={10} onClose={onClose} items={items} />);
    fireEvent.click(screen.getByText('View'));
    expect(disabledClick).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('applies danger class for danger items', () => {
    render(
      <ContextMenu
        x={0}
        y={0}
        onClose={vi.fn()}
        items={[{ label: 'Remove', onClick: vi.fn(), danger: true }]}
      />,
    );
    const btn = screen.getByText('Remove').closest('button');
    expect(btn).toHaveClass('context-menu-item--danger');
  });

  it('applies disabled class for disabled items', () => {
    render(
      <ContextMenu
        x={0}
        y={0}
        onClose={vi.fn()}
        items={[{ label: 'Locked', onClick: vi.fn(), disabled: true }]}
      />,
    );
    const btn = screen.getByText('Locked').closest('button');
    expect(btn).toHaveClass('context-menu-item--disabled');
  });

  it('calls onClose on Escape key in the menu', () => {
    const onClose = vi.fn();
    render(
      <ContextMenu x={0} y={0} onClose={onClose} items={[{ label: 'Item', onClick: vi.fn() }]} />,
    );
    const menu = document.querySelector('.context-menu');
    fireEvent.keyDown(menu!, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('renders item icon when provided', () => {
    const items = [
      { label: 'Rename', onClick: vi.fn(), icon: <span data-testid="rename-icon">R</span> },
    ];
    render(<ContextMenu x={0} y={0} onClose={vi.fn()} items={items} />);
    expect(screen.getByTestId('rename-icon')).toBeInTheDocument();
  });

  it('positions the menu at the given coordinates', () => {
    render(
      <ContextMenu
        x={200}
        y={150}
        onClose={vi.fn()}
        items={[{ label: 'Item', onClick: vi.fn() }]}
      />,
    );
    const menu = document.querySelector('.context-menu') as HTMLElement;
    expect(menu.style.top).toBe('150px');
    expect(menu.style.left).toBe('200px');
  });

  it('calls onClose when window is resized', () => {
    const onClose = vi.fn();
    render(<ContextMenu x={0} y={0} onClose={onClose} items={[]} />);
    fireEvent(window, new Event('resize'));
    expect(onClose).toHaveBeenCalled();
  });
});
