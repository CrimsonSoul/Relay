import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SidebarDashboards } from '../../sidebar/SidebarDashboards';

const dashboard = {
  id: 'dt_1',
  name: 'NOC',
  url: 'https://abc.live.dynatrace.com/dashboard',
  state: 'live' as const,
};

describe('SidebarDashboards', () => {
  it('renders nothing when there are no dashboards', () => {
    const { container } = render(<SidebarDashboards dashboards={[]} onOpenDashboard={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('opens the only dashboard directly', () => {
    const onOpenDashboard = vi.fn();
    render(<SidebarDashboards dashboards={[dashboard]} onOpenDashboard={onOpenDashboard} />);

    fireEvent.click(screen.getByRole('button', { name: 'Dashboards: Open NOC' }));
    expect(onOpenDashboard).toHaveBeenCalledWith('dt_1');
  });

  it('shows a popover for multiple dashboards', () => {
    render(
      <SidebarDashboards
        dashboards={[
          dashboard,
          { ...dashboard, id: 'dt_2', name: 'Infra', state: 'authenticating' },
        ]}
        onOpenDashboard={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open Dynatrace dashboards' }));
    expect(screen.getByText('NOC')).toBeInTheDocument();
    expect(screen.getByText('Infra')).toBeInTheDocument();
    expect(screen.getByText('Live')).toBeInTheDocument();
    expect(screen.getByText('Signed out')).toBeInTheDocument();
  });

  it('moves focus into the multi-dashboard popover', () => {
    render(
      <SidebarDashboards
        dashboards={[
          dashboard,
          { ...dashboard, id: 'dt_2', name: 'Infra', state: 'authenticating' },
        ]}
        onOpenDashboard={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open Dynatrace dashboards' }));
    expect(screen.getByRole('menuitem', { name: 'NOC, Live' })).toHaveFocus();

    fireEvent.keyDown(screen.getByRole('menu', { name: 'Dynatrace dashboards' }), {
      key: 'ArrowDown',
    });
    expect(screen.getByRole('menuitem', { name: 'Infra, Signed out' })).toHaveFocus();
  });

  it('hides the launcher tooltip while the popover is open', () => {
    render(
      <SidebarDashboards
        dashboards={[
          dashboard,
          { ...dashboard, id: 'dt_2', name: 'Infra', state: 'authenticating' },
        ]}
        onOpenDashboard={vi.fn()}
      />,
    );

    const launcher = screen.getByRole('button', { name: 'Open Dynatrace dashboards' });
    fireEvent.focus(launcher);
    expect(document.querySelector('.tooltip-popup')).toBeInTheDocument();

    fireEvent.click(launcher);
    expect(document.querySelector('.tooltip-popup')).not.toBeInTheDocument();
  });

  it('opens a dashboard from the popover and closes it', () => {
    const onOpenDashboard = vi.fn();
    render(
      <SidebarDashboards
        dashboards={[dashboard, { ...dashboard, id: 'dt_2', name: 'Infra', state: 'blocked' }]}
        onOpenDashboard={onOpenDashboard}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open Dynatrace dashboards' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Infra, Blocked' }));

    expect(onOpenDashboard).toHaveBeenCalledWith('dt_2');
    expect(screen.queryByText('Infra')).not.toBeInTheDocument();
  });

  describe('popover dismissal', () => {
    const twoDashboards = [
      dashboard,
      { ...dashboard, id: 'dt_2', name: 'Infra', state: 'authenticating' as const },
    ];

    it('closes on Tab and hands focus back to the launcher', () => {
      render(<SidebarDashboards dashboards={twoDashboards} onOpenDashboard={vi.fn()} />);
      const launcher = screen.getByRole('button', { name: 'Open Dynatrace dashboards' });

      fireEvent.click(launcher);
      fireEvent.keyDown(screen.getByRole('menuitem', { name: 'NOC, Live' }), { key: 'Tab' });

      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
      expect(launcher).toHaveFocus();
      expect(launcher).toHaveAttribute('aria-expanded', 'false');
    });

    it('closes when focus moves outside the popover and launcher', () => {
      render(
        <>
          <SidebarDashboards dashboards={twoDashboards} onOpenDashboard={vi.fn()} />
          <button type="button">Elsewhere</button>
        </>,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Open Dynatrace dashboards' }));
      const elsewhere = screen.getByRole('button', { name: 'Elsewhere' });

      fireEvent.blur(screen.getByRole('menuitem', { name: 'NOC, Live' }), {
        relatedTarget: elsewhere,
      });

      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it('stays open while focus moves between menu items', () => {
      render(<SidebarDashboards dashboards={twoDashboards} onOpenDashboard={vi.fn()} />);
      fireEvent.click(screen.getByRole('button', { name: 'Open Dynatrace dashboards' }));

      fireEvent.blur(screen.getByRole('menuitem', { name: 'NOC, Live' }), {
        relatedTarget: screen.getByRole('menuitem', { name: 'Infra, Signed out' }),
      });

      expect(screen.getByRole('menu')).toBeInTheDocument();
    });

    it('restores focus to the launcher on Escape', () => {
      render(<SidebarDashboards dashboards={twoDashboards} onOpenDashboard={vi.fn()} />);
      const launcher = screen.getByRole('button', { name: 'Open Dynatrace dashboards' });

      fireEvent.click(launcher);
      fireEvent.keyDown(screen.getByRole('menuitem', { name: 'NOC, Live' }), { key: 'Escape' });

      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
      expect(launcher).toHaveFocus();
    });

    it('does not steal focus when closed by a pointer press outside', () => {
      render(
        <>
          <SidebarDashboards dashboards={twoDashboards} onOpenDashboard={vi.fn()} />
          <input aria-label="Search" />
        </>,
      );
      const launcher = screen.getByRole('button', { name: 'Open Dynatrace dashboards' });
      const search = screen.getByRole('textbox', { name: 'Search' });

      fireEvent.click(launcher);
      fireEvent.pointerDown(search);
      search.focus();

      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
      expect(search).toHaveFocus();
    });
  });
});
