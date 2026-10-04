import React from 'react';
import type { DataCategory, ExportFormat } from '@shared/ipc';

export const TabButton: React.FC<{
  id: string;
  controls: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}> = ({ id, controls, active, disabled, onClick, children }) => (
  <button
    disabled={disabled}
    id={id}
    type="button"
    role="tab"
    aria-selected={active}
    aria-controls={controls}
    tabIndex={active ? 0 : -1}
    onClick={onClick}
    className="tab-strip__tab"
  >
    {children}
  </button>
);

/**
 * One row of the Data Manager's stats definition list. The term names exactly
 * what is counted; the count and its management location follow on the same line.
 */
export const StatRow: React.FC<{
  label: string;
  count: number;
  lastUpdated?: number;
  /** Where those records are managed. */
  context?: string;
}> = ({ label, count, lastUpdated, context }) => (
  <div className="dm-stat-row">
    <dt className="dm-stat-label">{label}</dt>
    <dd className="dm-stat-count">{count}</dd>
    <dd className="dm-stat-context">
      {context}
      {typeof lastUpdated === 'number' && lastUpdated > 0 && (
        <span className="dm-stat-updated">
          {' · '}Updated {new Date(lastUpdated).toLocaleDateString()}
        </span>
      )}
    </dd>
  </div>
);

export const CategorySelect: React.FC<{
  value: DataCategory;
  onChange: (value: DataCategory) => void;
  excludeAll?: boolean;
  disabled?: boolean;
}> = ({ value, onChange, excludeAll, disabled }) => (
  <select
    value={value}
    disabled={disabled}
    aria-label="Data category"
    onChange={(e) => onChange(e.target.value as DataCategory)}
    className="dm-select dm-select--category"
  >
    {!excludeAll && <option value="all">All Data</option>}
    <option value="contacts">Contacts</option>
    <option value="servers">Servers</option>
    <option value="oncall">On-Call</option>
    <option value="groups">Bridge Groups</option>
    <option value="bridge_history">Bridge History</option>
    <option value="alert_history">Alert History</option>
    <option value="notes">Notes</option>
  </select>
);

export const FormatSelect: React.FC<{
  value: ExportFormat;
  onChange: (value: ExportFormat) => void;
}> = ({ value, onChange }) => (
  <select
    value={value}
    aria-label="Export format"
    onChange={(e) => onChange(e.target.value as ExportFormat)}
    className="dm-select dm-select--format"
  >
    <option value="json">JSON</option>
    <option value="csv">CSV</option>
    <option value="excel">Excel</option>
  </select>
);
