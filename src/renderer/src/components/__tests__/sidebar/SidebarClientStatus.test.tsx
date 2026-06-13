import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SidebarClientStatus } from '../../sidebar/SidebarClientStatus';

const sidebarCss = readFileSync(
  resolve(process.cwd(), 'src/renderer/src/components/sidebar/sidebar.css'),
  'utf8',
);

const cssBlockFor = (selector: string) => {
  const match = new RegExp(`${selector.replaceAll('.', '\\.')}\\s*{([^}]*)}`).exec(sidebarCss);
  return match?.[1] ?? '';
};

describe('SidebarClientStatus', () => {
  it('renders the connected client count in the sidebar button style', () => {
    render(<SidebarClientStatus count={2} hostnames={['ops-laptop', 'war-room-mac']} />);

    const status = screen.getByTestId('sidebar-clients');
    expect(status).toHaveClass('sidebar-button');
    expect(status).toHaveTextContent('2 clients');
    expect(status).toHaveAttribute('aria-label', '2 clients connected');
  });

  it('uses singular copy for one connected client', () => {
    render(<SidebarClientStatus count={1} hostnames={['ops-laptop']} />);

    expect(screen.getByTestId('sidebar-clients')).toHaveTextContent('1 client');
    expect(screen.getByTestId('sidebar-clients')).toHaveAttribute(
      'aria-label',
      '1 client connected',
    );
  });

  it('shows hostnames in the hover tooltip', () => {
    render(<SidebarClientStatus count={2} hostnames={['ops-laptop', 'war-room-mac']} />);

    fireEvent.mouseEnter(screen.getByTestId('sidebar-clients'));

    expect(document.body.querySelector('.tooltip-popup')).toHaveTextContent('ops-laptop');
    expect(document.body.querySelector('.tooltip-popup')).toHaveTextContent('war-room-mac');
  });

  it('shows an empty state in the tooltip when no clients are connected', () => {
    render(<SidebarClientStatus count={0} hostnames={[]} />);

    fireEvent.mouseEnter(screen.getByTestId('sidebar-clients'));

    expect(document.body.querySelector('.tooltip-popup')).toHaveTextContent('No clients connected');
  });

  it('inherits the normal sidebar button pointer and hover highlight even at zero clients', () => {
    const clientStatusStyles = cssBlockFor('.sidebar-client-status');
    expect(clientStatusStyles).not.toContain('cursor: default');

    const zeroCountRuleIndex = sidebarCss.indexOf(".sidebar-client-status[data-client-count='0']");
    const hoverRuleIndex = sidebarCss.indexOf('.sidebar-client-status:hover');
    const hoverStyles = cssBlockFor('.sidebar-client-status:hover');

    expect(hoverRuleIndex).toBeGreaterThan(zeroCountRuleIndex);
    expect(hoverStyles).toContain('color: var(--color-text-primary)');
    expect(sidebarCss).toContain(".sidebar-client-status[data-client-count='0']:hover");
  });
});
