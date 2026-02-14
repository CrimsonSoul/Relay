import React from 'react';
import { StatCard } from './SharedComponents';
import type { DataStats } from '@shared/ipc';

interface Props {
  stats: DataStats | null;
}

export const DataManagerOverview: React.FC<Props> = ({ stats }) => (
  <div className="data-manager-section">
    <div className="data-manager-section-heading">Data Statistics</div>
    <div className="data-manager-stats-row">
      <StatCard
        label="Contacts"
        count={stats?.contacts.count || 0}
        lastUpdated={stats?.contacts.lastUpdated}
      />
      <StatCard
        label="Servers"
        count={stats?.servers.count || 0}
        lastUpdated={stats?.servers.lastUpdated}
      />
      <StatCard
        label="On-Call"
        count={stats?.oncall.count || 0}
        lastUpdated={stats?.oncall.lastUpdated}
      />
      <StatCard
        label="Groups"
        count={stats?.groups.count || 0}
        lastUpdated={stats?.groups.lastUpdated}
      />
    </div>
  </div>
);
