import React from "react";
import type { DataCategory, ExportFormat } from "@shared/ipc";

export const TabButton: React.FC<{
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}> = ({ active, onClick, children }) => (
  <button
    type="button"
    onClick={onClick}
    style={{
      padding: "8px 16px",
      background: active ? "var(--color-bg-tertiary)" : "transparent",
      border: "none",
      borderBottom: active ? "2px solid var(--color-accent)" : "2px solid transparent",
      color: active ? "var(--color-text-primary)" : "var(--color-text-secondary)",
      cursor: "pointer",
      fontSize: "13px",
      fontWeight: 500,
      transition: "all 0.15s ease",
    }}
  >
    {children}
  </button>
);

export const StatCard: React.FC<{
  label: string;
  count: number;
  lastUpdated?: number;
}> = ({ label, count, lastUpdated }) => (
  <div
    style={{
      padding: "12px 16px",
      background: "rgba(0,0,0,0.2)",
      border: "1px solid var(--border-subtle)",
      borderRadius: "8px",
      flex: 1,
      minWidth: "120px",
    }}
  >
    <div
      style={{
        fontSize: "24px",
        fontWeight: 600,
        color: "var(--color-text-primary)",
      }}
    >
      {count}
    </div>
    <div
      style={{
        fontSize: "12px",
        color: "var(--color-text-secondary)",
        textTransform: "capitalize",
      }}
    >
      {label}
    </div>
    {lastUpdated && lastUpdated > 0 && (
      <div
        style={{
          fontSize: "10px",
          color: "var(--color-text-tertiary)",
          marginTop: "4px",
        }}
      >
        Updated {new Date(lastUpdated).toLocaleDateString()}
      </div>
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
    style={{
      padding: "10px 14px",
      background: "var(--color-bg-surface-elevated)",
      border: "var(--border-medium)",
      borderRadius: "8px",
      color: "var(--color-text-primary)",
      fontSize: "13px",
      flex: 1,
      cursor: "pointer",
      colorScheme: "dark",
    }}
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
    style={{
      padding: "10px 14px",
      background: "var(--color-bg-surface-elevated)",
      border: "var(--border-medium)",
      borderRadius: "8px",
      color: "var(--color-text-primary)",
      fontSize: "13px",
      width: "100px",
      cursor: "pointer",
      colorScheme: "dark",
    }}
  >
    <option value="json">JSON</option>
    <option value="csv">CSV</option>
  </select>
);
