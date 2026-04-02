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

  it('renders business area and LOB', () => {
    render(<ServerCard server={makeServer()} onContextMenu={vi.fn()} />);

    expect(screen.getByText('Engineering')).toBeInTheDocument();
    expect(screen.getByText('Platform')).toBeInTheDocument();
  });

  it('renders separator between meta items', () => {
    render(<ServerCard server={makeServer()} onContextMenu={vi.fn()} />);

    expect(screen.getByText('|')).toBeInTheDocument();
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

    // The os badge should render with the platform color
    const badge = container.querySelector('.server-card-os-badge') as HTMLElement;
    expect(badge).toBeInTheDocument();
  });
});
