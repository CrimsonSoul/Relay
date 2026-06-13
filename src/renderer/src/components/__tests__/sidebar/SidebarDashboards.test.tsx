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

    fireEvent.click(screen.getByRole('button', { name: 'Open Dynatrace dashboard NOC' }));
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

  it('opens a dashboard from the popover and closes it', () => {
    const onOpenDashboard = vi.fn();
    render(
      <SidebarDashboards
        dashboards={[dashboard, { ...dashboard, id: 'dt_2', name: 'Infra', state: 'blocked' }]}
        onOpenDashboard={onOpenDashboard}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open Dynatrace dashboards' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open Infra dashboard, Blocked' }));

    expect(onOpenDashboard).toHaveBeenCalledWith('dt_2');
    expect(screen.queryByText('Infra')).not.toBeInTheDocument();
  });
});
