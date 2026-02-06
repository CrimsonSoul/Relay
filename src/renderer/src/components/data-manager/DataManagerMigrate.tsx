import React from "react";
import { TactileButton } from "../TactileButton";
import type { MigrationResult } from "@shared/ipc";
import type { DataStats } from "../hooks/useDataManager";

interface Props {
  stats: DataStats | null;
  migrating: boolean;
  onMigrate: () => void;
  lastMigrationResult: MigrationResult | null;
  onClearResult: () => void;
}

export const DataManagerMigrate: React.FC<Props> = ({
  stats,
  migrating,
  onMigrate,
  lastMigrationResult,
  onClearResult,
}) => (
  <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
    <div
      style={{
        fontSize: "18px",
        fontWeight: 700,
        color: "var(--color-text-tertiary)",
        textTransform: "uppercase",
        letterSpacing: "0.04em",
      }}
    >
      Migrate from CSV
    </div>
    {stats?.hasCsvFiles ? (
      <>
        <div
          style={{
            fontSize: "18px",
            color: "var(--color-text-secondary)",
            lineHeight: 1.55,
          }}
        >
          Convert your existing CSV files (contacts.csv, servers.csv, oncall.csv)
          to the new JSON format. This adds unique IDs and timestamps to each
          record, enabling better editing and sync capabilities.
        </div>
        <div
          style={{
            padding: "14px 18px",
            background: "var(--color-bg-surface-elevated)",
            border: "1px solid var(--border-subtle)",
            borderRadius: "10px",
            fontSize: "16px",
            color: "var(--color-text-secondary)",
          }}
        >
          <strong style={{ color: "var(--color-text-primary)" }}>
            What will happen:
          </strong>
          <ul style={{ margin: "8px 0 0 0", paddingLeft: "20px" }}>
            <li>A backup of your current files will be created</li>
            <li>CSV files will be converted to JSON format</li>
            <li>Original CSV files will be renamed to .csv.migrated</li>
            <li>All existing data will be preserved</li>
          </ul>
        </div>
        <TactileButton
          onClick={onMigrate}
          variant="primary"
          disabled={migrating}
          style={{ justifyContent: "center", height: "56px", fontSize: "20px" }}
        >
          {migrating ? "Migrating..." : "Migrate to JSON"}
        </TactileButton>
      </>
    ) : (
      <div
        style={{
          padding: "28px",
          textAlign: "center",
          color: "var(--color-text-secondary)",
        }}
      >
        <div style={{ fontSize: "20px", marginBottom: "10px" }}>
          No CSV files found
        </div>
        <div style={{ fontSize: "16px", color: "var(--color-text-tertiary)" }}>
          Your data is already using the JSON format
        </div>
      </div>
    )}
    {lastMigrationResult && (
      <div
        style={{
          padding: "14px 18px",
          background: lastMigrationResult.success
            ? "rgba(0, 180, 80, 0.1)"
            : "rgba(255, 180, 0, 0.1)",
          border: `1px solid ${
            lastMigrationResult.success
              ? "rgba(0, 180, 80, 0.3)"
              : "rgba(255, 180, 0, 0.3)"
          }`,
          borderRadius: "10px",
          fontSize: "17px",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span>
            Migrated: {lastMigrationResult.contacts.migrated} contacts,{" "}
            {lastMigrationResult.servers.migrated} servers,{" "}
            {lastMigrationResult.oncall.migrated} on-call,{" "}
            {lastMigrationResult.groups?.migrated ?? 0} groups
          </span>
          <button
            type="button"
            onClick={onClearResult}
            style={{
              background: "none",
              border: "none",
              color: "var(--color-text-tertiary)",
              cursor: "pointer",
              padding: 0,
            }}
          >
            &times;
          </button>
        </div>
      </div>
    )}
  </div>
);
