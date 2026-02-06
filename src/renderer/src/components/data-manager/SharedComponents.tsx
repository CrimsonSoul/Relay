import React from "react";
import type { DataCategory, ExportFormat } from "@shared/ipc";

const selectChevron =
  'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'14\' height=\'9\' viewBox=\'0 0 14 9\' fill=\'none\'%3E%3Cpath d=\'M1 1.5L7 7.5L13 1.5\' stroke=\'%2394A3B8\' stroke-width=\'1.8\' stroke-linecap=\'round\' stroke-linejoin=\'round\'/%3E%3C/svg%3E")';

export const TabButton: React.FC<{
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}> = ({ active, onClick, children }) => (
  <button
    type="button"
    onClick={onClick}
    style={{
      padding: "12px 20px",
      background: active ? "var(--color-bg-surface-elevated)" : "transparent",
      border: "none",
      borderBottom: active
        ? "1px solid rgba(96, 165, 250, 0.45)"
        : "1px solid transparent",
      color: active ? "var(--color-text-primary)" : "var(--color-text-secondary)",
      cursor: "pointer",
      fontSize: "22px",
      fontWeight: 600,
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
      padding: "18px 22px",
      background: "var(--color-bg-surface-elevated)",
      border: "1px solid var(--border-subtle)",
      borderRadius: "12px",
      flex: 1,
      minWidth: "120px",
    }}
  >
    <div
      style={{
        fontSize: "48px",
        fontWeight: 600,
        color: "var(--color-text-primary)",
        lineHeight: 1,
      }}
    >
      {count}
    </div>
    <div
      style={{
        fontSize: "24px",
        color: "var(--color-text-secondary)",
        textTransform: "capitalize",
        marginTop: "8px",
      }}
    >
      {label}
    </div>
    {lastUpdated && lastUpdated > 0 && (
      <div
        style={{
          fontSize: "16px",
          color: "var(--color-text-tertiary)",
          marginTop: "8px",
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
      height: "56px",
      padding: "0 48px 0 16px",
      background: "var(--color-bg-surface-elevated)",
      border: "var(--border-medium)",
      borderRadius: "10px",
      color: "var(--color-text-primary)",
      fontSize: "20px",
      fontWeight: 500,
      flex: 1,
      cursor: "pointer",
      colorScheme: "dark",
      outline: "none",
      appearance: "none",
      WebkitAppearance: "none",
      backgroundImage: selectChevron,
      backgroundRepeat: "no-repeat",
      backgroundPosition: "right 16px center",
      backgroundSize: "14px 9px",
    }}
    onFocus={(e) => {
      e.currentTarget.style.borderColor = "rgba(96, 165, 250, 0.45)";
      e.currentTarget.style.boxShadow = "0 0 0 1px rgba(96, 165, 250, 0.15)";
    }}
    onBlur={(e) => {
      e.currentTarget.style.borderColor = "rgba(255, 255, 255, 0.08)";
      e.currentTarget.style.boxShadow = "none";
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
      height: "56px",
      padding: "0 48px 0 16px",
      background: "var(--color-bg-surface-elevated)",
      border: "var(--border-medium)",
      borderRadius: "10px",
      color: "var(--color-text-primary)",
      fontSize: "20px",
      fontWeight: 500,
      width: "160px",
      cursor: "pointer",
      colorScheme: "dark",
      outline: "none",
      appearance: "none",
      WebkitAppearance: "none",
      backgroundImage: selectChevron,
      backgroundRepeat: "no-repeat",
      backgroundPosition: "right 16px center",
      backgroundSize: "14px 9px",
    }}
    onFocus={(e) => {
      e.currentTarget.style.borderColor = "rgba(96, 165, 250, 0.45)";
      e.currentTarget.style.boxShadow = "0 0 0 1px rgba(96, 165, 250, 0.15)";
    }}
    onBlur={(e) => {
      e.currentTarget.style.borderColor = "rgba(255, 255, 255, 0.08)";
      e.currentTarget.style.boxShadow = "none";
    }}
  >
    <option value="json">JSON</option>
    <option value="csv">CSV</option>
  </select>
);
