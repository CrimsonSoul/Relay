import React from "react";
import { StatCard } from "./SharedComponents";
import type { DataStats } from "../hooks/useDataManager";

interface Props {
  stats: DataStats | null;
}

export const DataManagerOverview: React.FC<Props> = ({ stats }) => (
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
      Data Statistics
    </div>
    <div style={{ display: "flex", gap: "14px", flexWrap: "wrap" }}>
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
    {stats?.hasCsvFiles && (
      <div
        style={{
          padding: "14px 18px",
          background: "rgba(255, 180, 0, 0.1)",
          border: "1px solid rgba(255, 180, 0, 0.3)",
          borderRadius: "10px",
          fontSize: "18px",
          color: "var(--color-text-secondary)",
        }}
      >
        <strong style={{ color: "var(--color-text-primary)" }}>CSV files detected.</strong>{" "}
        Go to the Migrate tab to convert your data to the new JSON format.
      </div>
    )}
  </div>
);
