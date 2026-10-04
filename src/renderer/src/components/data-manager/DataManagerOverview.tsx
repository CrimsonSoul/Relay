import React from 'react';
import { StatRow } from './SharedComponents';
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

// Each label names the stored record it counts. On-call stores one record per team role
// assignment, so a person covering several roles adds several rows while the board shows them once.
const OVERVIEW_STATS = [
  { key: 'contacts', label: 'Contact records', context: 'Managed in Knowledge › Contacts' },
  { key: 'servers', label: 'Server records', context: 'Managed in Knowledge › Servers' },
  {
    key: 'oncall',
    label: 'On-call role assignments',
    context: 'One per team role, managed in On-Call',
  },
  { key: 'groups', label: 'Saved bridge groups', context: 'Managed in Compose' },
] as const;

export const DataManagerOverview: React.FC<Props> = ({ stats }) => (
  <div className="data-manager-section">
    <div className="data-manager-section-heading">Data statistics</div>
    <dl className="data-manager-stats-list">
      {OVERVIEW_STATS.map(({ key, label, context }) => (
        <StatRow key={key} label={label} context={context} {...readStat(stats?.[key])} />
      ))}
    </dl>
  </div>
);
