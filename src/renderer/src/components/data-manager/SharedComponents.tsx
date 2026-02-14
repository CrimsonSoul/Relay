import React from 'react';
import type { DataCategory, ExportFormat } from '@shared/ipc';

export const TabButton: React.FC<{
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}> = ({ active, onClick, children }) => (
  <button
    type="button"
    onClick={onClick}
    className={`dm-tab-btn${active ? ' dm-tab-btn--active' : ''}`}
  >
    {children}
  </button>
);

export const StatCard: React.FC<{
  label: string;
  count: number;
  lastUpdated?: number;
}> = ({ label, count, lastUpdated }) => (
  <div className="dm-stat-card">
    <div className="dm-stat-count">{count}</div>
    <div className="dm-stat-label">{label}</div>
    {lastUpdated && lastUpdated > 0 && (
      <div className="dm-stat-updated">Updated {new Date(lastUpdated).toLocaleDateString()}</div>
    )}
  </div>
);

export const CategorySelect: React.FC<{
  value: DataCategory;
  onChange: (value: DataCategory) => void;
  excludeAll?: boolean;
}> = ({ value, onChange, excludeAll }) => (
  <select
    value={value}
    onChange={(e) => onChange(e.target.value as DataCategory)}
    className="dm-select dm-select--category"
  >
    {!excludeAll && <option value="all">All Data</option>}
    <option value="contacts">Contacts</option>
    <option value="servers">Servers</option>
    <option value="oncall">On-Call</option>
    <option value="groups">Groups</option>
  </select>
);

export const FormatSelect: React.FC<{
  value: ExportFormat;
  onChange: (value: ExportFormat) => void;
}> = ({ value, onChange }) => (
  <select
    value={value}
    onChange={(e) => onChange(e.target.value as ExportFormat)}
    className="dm-select dm-select--format"
  >
    <option value="json">JSON</option>
    <option value="csv">CSV</option>
  </select>
);
