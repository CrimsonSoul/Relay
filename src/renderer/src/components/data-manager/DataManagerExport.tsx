import React from "react";
import { CategorySelect, FormatSelect } from "./SharedComponents";
import { TactileButton } from "../TactileButton";
import type { DataCategory, ExportFormat } from "@shared/ipc";

interface Props {
  exportCategory: DataCategory;
  setExportCategory: (category: DataCategory) => void;
  exportFormat: ExportFormat;
  setExportFormat: (format: ExportFormat) => void;
  includeMetadata: boolean;
  setIncludeMetadata: (include: boolean) => void;
  exporting: boolean;
  onExport: () => void;
}

export const DataManagerExport: React.FC<Props> = ({
  exportCategory,
  setExportCategory,
  exportFormat,
  setExportFormat,
  includeMetadata,
  setIncludeMetadata,
  exporting,
  onExport,
}) => (
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
      onClick={onExport}
      variant="primary"
      disabled={exporting}
      style={{ justifyContent: "center" }}
    >
      {exporting ? "Exporting..." : "Export..."}
    </TactileButton>
  </div>
);
