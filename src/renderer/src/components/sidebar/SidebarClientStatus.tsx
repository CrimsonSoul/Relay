import React from 'react';
import { Tooltip } from '../Tooltip';
import { ClientsIcon } from './SidebarIcons';

interface SidebarClientStatusProps {
  count: number;
  hostnames: string[];
}

function getClientLabel(count: number): string {
  return `${count} ${count === 1 ? 'client' : 'clients'}`;
}

function ClientPresenceTooltip({ hostnames }: { readonly hostnames: string[] }) {
  if (hostnames.length === 0) {
    return <div className="sidebar-client-tooltip-empty">No clients connected</div>;
  }

  return (
    <div className="sidebar-client-tooltip">
      {hostnames.map((hostname) => (
        <div key={hostname} className="sidebar-client-tooltip-row">
          {hostname}
        </div>
      ))}
    </div>
  );
}

export const SidebarClientStatus: React.FC<SidebarClientStatusProps> = React.memo(
  ({ count, hostnames }) => {
    const label = getClientLabel(count);

    return (
      <Tooltip content={<ClientPresenceTooltip hostnames={hostnames} />} position="right">
        <button
          type="button"
          aria-disabled="true"
          aria-live="polite"
          aria-label={`${label} connected`}
          data-testid="sidebar-clients"
          data-client-count={count}
          className="sidebar-button sidebar-client-status"
        >
          <div className="sidebar-button-icon sidebar-client-status-icon">
            <ClientsIcon />
          </div>
          <span className="sidebar-button-label">{label}</span>
        </button>
      </Tooltip>
    );
  },
);
