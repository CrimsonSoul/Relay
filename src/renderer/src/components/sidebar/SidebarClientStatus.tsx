import React from 'react';
import { Tooltip } from '../Tooltip';
import { ClientsIcon } from './SidebarIcons';

interface SidebarClientStatusProps {
  count: number;
  hostnames: string[];
}

// Matches the StatusBar's "Relay server connected": this server hosts the data, and Relay clients
// (desktops in client mode) and Relay Web sessions (browsers) connect to it. The count covers both.
const CLIENT_PRESENCE_HEADING = 'Relay clients and Relay Web sessions connected to this server';

function ClientPresenceTooltip({ hostnames }: { readonly hostnames: string[] }) {
  if (hostnames.length === 0) {
    return (
      <div className="sidebar-client-tooltip-empty">
        No Relay clients or Relay Web sessions connected. That is normal when this is the only Relay
        workstation. The count covers both: Relay client desktops and Relay Web browsers appear here
        while they are connected to this server.
      </div>
    );
  }

  return (
    <div className="sidebar-client-tooltip">
      <div className="sidebar-client-tooltip-heading">{CLIENT_PRESENCE_HEADING}</div>
      {hostnames.map((hostname) => (
        <div key={hostname} className="sidebar-client-tooltip-row">
          {hostname}
        </div>
      ))}
    </div>
  );
}

/**
 * Footer readout of who is connected, not a destination: an `<output>` (implicit `status` live
 * region) rather than a disabled button. It stays focusable so keyboard users can open the same
 * hostname tooltip as pointer users. The visible label stacks the count over "clients" so it fits
 * the rail whole beside the icon; the full sentence is the accessible name and the rest of it is
 * spoken from visually hidden text.
 */
export const SidebarClientStatus: React.FC<Readonly<SidebarClientStatusProps>> = React.memo(
  ({ count, hostnames }) => {
    const noun = count === 1 ? 'client' : 'clients';

    return (
      <Tooltip content={<ClientPresenceTooltip hostnames={hostnames} />} position="right">
        <output
          aria-label={`${count} ${noun} connected to this Relay server`}
          data-testid="sidebar-clients"
          data-client-count={count}
          className="sidebar-button sidebar-client-status"
          // Tooltip trigger: focus reveals the connected hostnames (WAI-ARIA tooltip pattern).
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
          tabIndex={0}
        >
          <span className="sidebar-button-icon sidebar-client-status-icon" aria-hidden="true">
            <ClientsIcon />
          </span>
          <span className="sidebar-button-label sidebar-client-status-label">
            <span className="sidebar-client-status-count">{count}</span>{' '}
            <span className="sidebar-client-status-noun">{noun}</span>
            <span className="sr-only"> connected to this Relay server</span>
          </span>
        </output>
      </Tooltip>
    );
  },
);
