import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import { ServerCard } from '../ServerCard';
import type { Server } from '@shared/ipc';

// Mock Tooltip to render children directly
vi.mock('../Tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

function makeServer(overrides: Partial<Server> = {}): Server {
  return {
    name: 'web-prod-01',
    businessArea: 'Engineering',
    lob: 'Platform',
    comment: '',
    owner: 'admin@example.com',
    contact: 'ops@example.com',
    os: 'Linux',
    _searchString: 'web-prod-01 engineering platform linux',
    raw: {},
    ...overrides,
  };
}

describe('ServerCard', () => {
  it('renders server name', () => {
    render(<ServerCard server={makeServer()} onContextMenu={vi.fn()} />);

    expect(screen.getByText('web-prod-01')).toBeInTheDocument();
  });

  it('renders business area, LOB and OS in the meta row', () => {
    render(<ServerCard server={makeServer()} onContextMenu={vi.fn()} />);

    expect(screen.getByText('Engineering')).toBeInTheDocument();
    expect(screen.getByText('Platform')).toBeInTheDocument();
    expect(screen.getByText('Linux')).toHaveClass('server-card-meta-os');
  });

  it('omits empty meta fields and their separators', () => {
    render(<ServerCard server={makeServer({ lob: '-', os: '' })} onContextMenu={vi.fn()} />);

    expect(screen.queryByText('·')).not.toBeInTheDocument();
  });

  it('renders owner and support names when provided', () => {
    render(
      <ServerCard
        server={makeServer()}
        ownerName="Alice Johnson"
        supportName="Steve Rogers"
        onContextMenu={vi.fn()}
      />,
    );

    expect(screen.getByText('Owner: Alice Johnson')).toBeInTheDocument();
    expect(screen.getByText('Support: Steve Rogers')).toBeInTheDocument();
  });

  it('renders middle-dot separators between meta items', () => {
    render(<ServerCard server={makeServer()} onContextMenu={vi.fn()} />);

    expect(screen.getAllByText('·')).toHaveLength(2);
    expect(screen.queryByText('|')).not.toBeInTheDocument();
  });

  it('renders as a static div when no onRowClick', () => {
    const { container } = render(<ServerCard server={makeServer()} onContextMenu={vi.fn()} />);

    expect(container.querySelector('.server-card')).toBeInTheDocument();
    expect(container.querySelector('button')).not.toBeInTheDocument();
  });

  it('renders as a button when onRowClick is provided', () => {
    const onClick = vi.fn();
    const { container } = render(
      <ServerCard server={makeServer()} onContextMenu={vi.fn()} onRowClick={onClick} />,
    );

    const button = container.querySelector('button');
    expect(button).toBeInTheDocument();
    expect(button).toHaveClass('server-card--interactive');
  });

  it('exposes its stable record key on an interactive row', () => {
    render(
      <ServerCard
        server={makeServer()}
        recordKey="id:server_1"
        onContextMenu={vi.fn()}
        onRowClick={vi.fn()}
      />,
    );

    expect(screen.getByRole('button')).toHaveAttribute('data-record-key', 'id:server_1');
  });

  it('calls onRowClick when button is clicked', () => {
    const onClick = vi.fn();
    const { container } = render(
      <ServerCard server={makeServer()} onContextMenu={vi.fn()} onRowClick={onClick} />,
    );

    fireEvent.click(container.querySelector('button')!);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('calls onContextMenu on right-click when interactive', () => {
    const onCtx = vi.fn();
    const server = makeServer();
    const { container } = render(
      <ServerCard server={server} onContextMenu={onCtx} onRowClick={vi.fn()} />,
    );

    fireEvent.contextMenu(container.querySelector('button')!);
    expect(onCtx).toHaveBeenCalledWith(expect.anything(), server);
  });

  it('overlays a row actions button that opens the menu, keeping the row style on the wrapper', () => {
    const onOpenActions = vi.fn();
    const { container } = render(
      <ServerCard
        server={makeServer()}
        onContextMenu={vi.fn()}
        onRowClick={vi.fn()}
        onOpenActions={onOpenActions}
        style={{ top: '67px' }}
      />,
    );

    const wrapper = container.querySelector('.server-card-row') as HTMLElement;
    expect(wrapper.style.top).toBe('67px');
    expect((container.querySelector('.server-card--interactive') as HTMLElement).style.top).toBe(
      '',
    );
    const actions = screen.getByRole('button', { name: 'Actions for web-prod-01' });
    expect(actions).toHaveAttribute('aria-haspopup', 'menu');
    expect(actions.closest('.server-card--interactive')).toBeNull();
    fireEvent.click(actions);
    expect(onOpenActions).toHaveBeenCalledWith({ x: expect.any(Number), y: expect.any(Number) });
  });

  it('applies selected class when selected is true', () => {
    const { container } = render(
      <ServerCard server={makeServer()} onContextMenu={vi.fn()} selected={true} />,
    );

    expect(container.querySelector('.server-card-body--selected')).toBeInTheDocument();
  });

  it('does not apply selected class by default', () => {
    const { container } = render(<ServerCard server={makeServer()} onContextMenu={vi.fn()} />);

    expect(container.querySelector('.server-card-body--selected')).not.toBeInTheDocument();
  });

  it('outlines the row an open menu acts on', () => {
    const { container } = render(
      <ServerCard server={makeServer()} onContextMenu={vi.fn()} onRowClick={vi.fn()} menuTarget />,
    );

    expect(container.querySelector('.server-card-body--menu-target')).toBeInTheDocument();
  });

  it('applies custom style prop', () => {
    const { container } = render(
      <ServerCard server={makeServer()} onContextMenu={vi.fn()} style={{ height: '100px' }} />,
    );

    const card = container.querySelector('.server-card') as HTMLElement;
    expect(card.style.height).toBe('100px');
  });

  it('renders with different OS types', () => {
    const { container } = render(
      <ServerCard server={makeServer({ os: 'Windows Server 2019' })} onContextMenu={vi.fn()} />,
    );

    // The badge is a neutral server glyph whatever the platform; the OS reads as meta text.
    const badge = container.querySelector('.server-card-os-badge') as HTMLElement;
    expect(badge).toBeInTheDocument();
  });
});
