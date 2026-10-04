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
  it('renders the client count as a status readout, not a button', () => {
    render(<SidebarClientStatus count={2} hostnames={['ops-laptop', 'war-room-mac']} />);

    const status = screen.getByRole('status', {
      name: '2 clients connected to this Relay server',
    });
    expect(status).toBe(screen.getByTestId('sidebar-clients'));
    expect(status.tagName).toBe('OUTPUT');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    // Short visible label; the rest of the sentence is visually hidden, never ellipsised.
    const label = status.querySelector('.sidebar-button-label');
    const hidden = label?.querySelector('.sr-only')?.textContent ?? '';
    expect(label?.textContent?.replace(hidden, '')).toBe('2 clients');
    expect(status).toHaveTextContent('2 clients connected to this Relay server');
    expect(status.querySelector('.sr-only')).toHaveTextContent('connected to this Relay server');
  });

  it('uses singular copy for one connected client', () => {
    render(<SidebarClientStatus count={1} hostnames={['ops-laptop']} />);

    expect(
      screen.getByRole('status', { name: '1 client connected to this Relay server' }),
    ).toHaveTextContent('1 client');
  });

  it('shows hostnames in the hover tooltip', () => {
    render(<SidebarClientStatus count={2} hostnames={['ops-laptop', 'war-room-mac']} />);

    fireEvent.mouseEnter(screen.getByTestId('sidebar-clients'));

    const tooltip = document.body.querySelector('.tooltip-popup');
    expect(tooltip).toHaveTextContent(
      'Relay clients and Relay Web sessions connected to this server',
    );
    expect(tooltip).toHaveTextContent('ops-laptop');
    expect(tooltip).toHaveTextContent('war-room-mac');
  });

  it('opens the same tooltip from the keyboard', () => {
    render(<SidebarClientStatus count={1} hostnames={['ops-laptop']} />);

    const status = screen.getByTestId('sidebar-clients');
    expect(status).toHaveAttribute('tabindex', '0');
    fireEvent.focus(status);

    expect(document.body.querySelector('.tooltip-popup')).toHaveTextContent('ops-laptop');
  });

  it('explains in the tooltip that zero clients is normal for a single workstation', () => {
    render(<SidebarClientStatus count={0} hostnames={[]} />);

    fireEvent.mouseEnter(screen.getByTestId('sidebar-clients'));

    const tooltip = document.body.querySelector('.tooltip-popup');
    expect(tooltip).toHaveTextContent('No Relay clients or Relay Web sessions connected');
    expect(tooltip).toHaveTextContent('normal when this is the only Relay workstation');
    expect(tooltip).toHaveTextContent('The count covers both');
    expect(tooltip).toHaveTextContent('Relay Web browsers');
  });

  it('drops to regular weight at zero so it sits below Settings', () => {
    const zeroLabelRule = ".sidebar-client-status[data-client-count='0'] .sidebar-button-label {";
    const zeroLabelStart = sidebarCss.indexOf(zeroLabelRule);
    expect(zeroLabelStart).toBeGreaterThan(-1);
    expect(sidebarCss.slice(zeroLabelStart, sidebarCss.indexOf('}', zeroLabelStart))).toContain(
      'font-weight: var(--weight-regular)',
    );
    // Count stacked over the word beside the icon: each line stays whole, never wraps or ellipsises.
    const labelBlock = cssBlockFor('.sidebar-client-status .sidebar-button-label');
    expect(labelBlock).toContain('white-space: nowrap');
    expect(labelBlock).not.toContain('ellipsis');
    // No `display` on the label: the compact rail hides and re-shows labels by display.
    expect(labelBlock).not.toMatch(/display:/);
    expect(cssBlockFor('.sidebar-client-status-count,\n.sidebar-client-status-noun')).toContain(
      'display: block',
    );
  });

  it('reads as a readout: no pointer cursor, but the hover highlight still marks the tooltip', () => {
    expect(cssBlockFor('.sidebar-client-status')).toContain('cursor: default');

    const zeroCountRuleIndex = sidebarCss.indexOf(".sidebar-client-status[data-client-count='0']");
    const hoverRuleIndex = sidebarCss.indexOf('.sidebar-client-status:hover');
    const hoverStyles = cssBlockFor('.sidebar-client-status:hover');

    expect(hoverRuleIndex).toBeGreaterThan(zeroCountRuleIndex);
    expect(hoverStyles).toContain('color: var(--color-text-primary)');
    expect(sidebarCss).toContain(".sidebar-client-status[data-client-count='0']:hover");
  });
});
