import React, { useState, useEffect } from "react";
import { Modal } from "./Modal";
import { TactileButton } from "./TactileButton";
import { useToast } from "./Toast";
import { useDataManager } from "../hooks/useDataManager";
import type { DataCategory, ExportFormat } from "@shared/ipc";

type Props = {
  isOpen: boolean;
  onClose: () => void;
};

type TabId = "overview" | "import" | "export" | "migrate";

const TabButton: React.FC<{
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}> = ({ active, onClick, children }) => (
  <button
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

const StatCard: React.FC<{
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

const CategorySelect: React.FC<{
  value: DataCategory;
  onChange: (value: DataCategory) => void;
  excludeAll?: boolean;
}> = ({ value, onChange, excludeAll }) => (
  <select
    value={value}
    onChange={(e) => onChange(e.target.value as DataCategory)}
    style={{
      padding: "10px 14px",
      background: "var(--color-bg-secondary)",
      border: "1px solid var(--border-subtle)",
      borderRadius: "8px",
      color: "var(--color-text-primary)",
      fontSize: "13px",
      flex: 1,
      cursor: "pointer",
    }}
  >
    {!excludeAll && <option value="all">All Data</option>}
    <option value="contacts">Contacts</option>
    <option value="servers">Servers</option>
    <option value="oncall">On-Call</option>
    <option value="groups">Groups</option>
  </select>
);

const FormatSelect: React.FC<{
  value: ExportFormat;
  onChange: (value: ExportFormat) => void;
}> = ({ value, onChange }) => (
  <select
    value={value}
    onChange={(e) => onChange(e.target.value as ExportFormat)}
    style={{
      padding: "10px 14px",
      background: "var(--color-bg-secondary)",
      border: "1px solid var(--border-subtle)",
      borderRadius: "8px",
      color: "var(--color-text-primary)",
      fontSize: "13px",
      width: "100px",
      cursor: "pointer",
    }}
  >
    <option value="json">JSON</option>
    <option value="csv">CSV</option>
  </select>
);

export const DataManagerModal: React.FC<Props> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [exportCategory, setExportCategory] = useState<DataCategory>("all");
  const [exportFormat, setExportFormat] = useState<ExportFormat>("json");
  const [importCategory, setImportCategory] = useState<DataCategory>("contacts");
  const [includeMetadata, setIncludeMetadata] = useState(false);

  const { showToast } = useToast();
  const {
    stats,
    exporting,
    importing,
    migrating,
    lastImportResult,
    lastMigrationResult,
    loadStats,
    exportData,
    importData,
    migrateFromCsv,
    clearLastImportResult,
    clearLastMigrationResult,
  } = useDataManager();

  useEffect(() => {
    if (isOpen) {
      void loadStats();
      // Show migrate tab if CSV files exist
      if (stats?.hasCsvFiles) {
        setActiveTab("migrate");
      }
    }
  }, [isOpen, loadStats]);

  const handleExport = async () => {
    const success = await exportData({
      format: exportFormat,
      category: exportCategory,
      includeMetadata,
    });
    if (success) {
      showToast(`Exported ${exportCategory} as ${exportFormat.toUpperCase()}`, "success");
    }
  };

  const handleImport = async () => {
    const result = await importData(importCategory);
    if (result?.success) {
      showToast(
        `Imported ${result.imported} new, updated ${result.updated}`,
        "success"
      );
    } else if (result?.errors.length) {
      showToast(`Import completed with errors`, "info");
    }
  };

  const handleMigrate = async () => {
    const result = await migrateFromCsv();
    if (result?.success) {
      const total =
        result.contacts.migrated + result.servers.migrated + result.oncall.migrated;
      showToast(`Migrated ${total} records to JSON`, "success");
      await loadStats();
    } else if (result) {
      showToast("Migration completed with some errors", "info");
    }
  };

  const renderOverviewTab = () => (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <div
        style={{
          fontSize: "13px",
          fontWeight: 700,
          color: "var(--color-text-tertiary)",
          textTransform: "uppercase",
          letterSpacing: "0.04em",
        }}
      >
        Data Statistics
      </div>
      <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
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
            padding: "12px 16px",
            background: "rgba(255, 180, 0, 0.1)",
            border: "1px solid rgba(255, 180, 0, 0.3)",
            borderRadius: "8px",
            fontSize: "13px",
            color: "var(--color-text-secondary)",
          }}
        >
          <strong style={{ color: "var(--color-text-primary)" }}>CSV files detected.</strong>{" "}
          Go to the Migrate tab to convert your data to the new JSON format.
        </div>
      )}
    </div>
  );

  const renderImportTab = () => (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <div
        style={{
          fontSize: "13px",
          fontWeight: 700,
          color: "var(--color-text-tertiary)",
          textTransform: "uppercase",
          letterSpacing: "0.04em",
        }}
      >
        Import Data
      </div>
      <div
        style={{
          fontSize: "12px",
          color: "var(--color-text-secondary)",
          lineHeight: 1.5,
        }}
      >
        Import data from JSON or CSV files. Existing records will be updated by
        email (contacts), name (servers), or team+role+name (on-call).
      </div>
      <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
        <CategorySelect
          value={importCategory}
          onChange={setImportCategory}
          excludeAll
        />
        <TactileButton
          onClick={handleImport}
          variant="primary"
          disabled={importing}
          style={{ minWidth: "100px", justifyContent: "center" }}
        >
          {importing ? "Importing..." : "Import..."}
        </TactileButton>
      </div>
      {lastImportResult && (
        <div
          style={{
            padding: "12px 16px",
            background: lastImportResult.success
              ? "rgba(0, 180, 80, 0.1)"
              : "rgba(255, 80, 80, 0.1)",
            border: `1px solid ${
              lastImportResult.success
                ? "rgba(0, 180, 80, 0.3)"
                : "rgba(255, 80, 80, 0.3)"
            }`,
            borderRadius: "8px",
            fontSize: "13px",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>
              Imported: {lastImportResult.imported}, Updated:{" "}
              {lastImportResult.updated}, Skipped: {lastImportResult.skipped}
            </span>
            <button
              onClick={clearLastImportResult}
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
          {lastImportResult.errors.length > 0 && (
            <div
              style={{
                marginTop: "8px",
                fontSize: "12px",
                color: "var(--color-text-secondary)",
              }}
            >
              Errors: {lastImportResult.errors.slice(0, 3).join(", ")}
              {lastImportResult.errors.length > 3 &&
                ` +${lastImportResult.errors.length - 3} more`}
            </div>
          )}
        </div>
      )}
    </div>
  );

  const renderExportTab = () => (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <div
        style={{
          fontSize: "13px",
          fontWeight: 700,
          color: "var(--color-text-tertiary)",
          textTransform: "uppercase",
          letterSpacing: "0.04em",
        }}
      >
        Export Data
      </div>
      <div
        style={{
          fontSize: "12px",
          color: "var(--color-text-secondary)",
          lineHeight: 1.5,
        }}
      >
        Export your data as JSON or CSV. JSON preserves all data including IDs
        and timestamps. CSV is compatible with spreadsheet applications.
      </div>
      <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
        <CategorySelect value={exportCategory} onChange={setExportCategory} />
        <FormatSelect value={exportFormat} onChange={setExportFormat} />
      </div>
      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          fontSize: "13px",
          color: "var(--color-text-secondary)",
          cursor: "pointer",
        }}
      >
        <input
          type="checkbox"
          checked={includeMetadata}
          onChange={(e) => setIncludeMetadata(e.target.checked)}
          style={{ cursor: "pointer" }}
        />
        Include IDs and timestamps
      </label>
      <TactileButton
        onClick={handleExport}
        variant="primary"
        disabled={exporting}
        style={{ justifyContent: "center" }}
      >
        {exporting ? "Exporting..." : "Export..."}
      </TactileButton>
    </div>
  );

  const renderMigrateTab = () => (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <div
        style={{
          fontSize: "13px",
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
              fontSize: "12px",
              color: "var(--color-text-secondary)",
              lineHeight: 1.5,
            }}
          >
            Convert your existing CSV files (contacts.csv, servers.csv, oncall.csv)
            to the new JSON format. This adds unique IDs and timestamps to each
            record, enabling better editing and sync capabilities.
          </div>
          <div
            style={{
              padding: "12px 16px",
              background: "rgba(0,0,0,0.2)",
              border: "1px solid var(--border-subtle)",
              borderRadius: "8px",
              fontSize: "12px",
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
            onClick={handleMigrate}
            variant="primary"
            disabled={migrating}
            style={{ justifyContent: "center" }}
          >
            {migrating ? "Migrating..." : "Migrate to JSON"}
          </TactileButton>
        </>
      ) : (
        <div
          style={{
            padding: "24px",
            textAlign: "center",
            color: "var(--color-text-secondary)",
          }}
        >
          <div style={{ fontSize: "14px", marginBottom: "8px" }}>
            No CSV files found
          </div>
          <div style={{ fontSize: "12px", color: "var(--color-text-tertiary)" }}>
            Your data is already using the JSON format
          </div>
        </div>
      )}
      {lastMigrationResult && (
        <div
          style={{
            padding: "12px 16px",
            background: lastMigrationResult.success
              ? "rgba(0, 180, 80, 0.1)"
              : "rgba(255, 180, 0, 0.1)",
            border: `1px solid ${
              lastMigrationResult.success
                ? "rgba(0, 180, 80, 0.3)"
                : "rgba(255, 180, 0, 0.3)"
            }`,
            borderRadius: "8px",
            fontSize: "13px",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>
              Migrated: {lastMigrationResult.contacts.migrated} contacts,{" "}
              {lastMigrationResult.servers.migrated} servers,{" "}
              {lastMigrationResult.oncall.migrated} on-call
            </span>
            <button
              onClick={clearLastMigrationResult}
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

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Data Manager" width="520px">
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <div
          style={{
            display: "flex",
            borderBottom: "1px solid var(--border-subtle)",
            marginBottom: "8px",
          }}
        >
          <TabButton
            active={activeTab === "overview"}
            onClick={() => setActiveTab("overview")}
          >
            Overview
          </TabButton>
          <TabButton
            active={activeTab === "import"}
            onClick={() => setActiveTab("import")}
          >
            Import
          </TabButton>
          <TabButton
            active={activeTab === "export"}
            onClick={() => setActiveTab("export")}
          >
            Export
          </TabButton>
          {stats?.hasCsvFiles && (
            <TabButton
              active={activeTab === "migrate"}
              onClick={() => setActiveTab("migrate")}
            >
              Migrate
            </TabButton>
          )}
        </div>

        {activeTab === "overview" && renderOverviewTab()}
        {activeTab === "import" && renderImportTab()}
        {activeTab === "export" && renderExportTab()}
        {activeTab === "migrate" && renderMigrateTab()}
      </div>
    </Modal>
  );
};
