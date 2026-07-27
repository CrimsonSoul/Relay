import React from 'react';
import { StatCard } from './SharedComponents';
import type { DataStats } from '@shared/ipc';

interface Props {
  stats: DataStats | null;
}

type StatEntry = DataStats['contacts'];

/**
 * A stat is either the `{ count, lastUpdated }` record the current loader
 * produces or a bare count from the legacy shape. Reading `.count` off the bare
 * number form yields `undefined`, which rendered as a flat `0`.
 */
const readStat = (entry: StatEntry | undefined): { count: number; lastUpdated?: number } => {
  if (typeof entry === 'number') return { count: entry };
  if (!entry) return { count: 0 };
  return { count: entry.count, lastUpdated: entry.lastUpdated };
};

export const DataManagerOverview: React.FC<Props> = ({ stats }) => (
  <div className="data-manager-section">
    <div className="data-manager-section-heading">Data Statistics</div>
    <div className="data-manager-stats-row">
      <StatCard label="Contacts" {...readStat(stats?.contacts)} />
      <StatCard label="Servers" {...readStat(stats?.servers)} />
      <StatCard label="On-Call" {...readStat(stats?.oncall)} />
      <StatCard label="Groups" {...readStat(stats?.groups)} />
    </div>
  </div>
);
