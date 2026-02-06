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
        fontSize: "18px",
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
        fontSize: "18px",
        color: "var(--color-text-secondary)",
        lineHeight: 1.55,
      }}
    >
      Export your data as JSON or CSV. JSON preserves all data including IDs
      and timestamps. CSV is compatible with spreadsheet applications.
    </div>
    <div style={{ display: "flex", gap: "14px", alignItems: "center" }}>
      <CategorySelect value={exportCategory} onChange={setExportCategory} />
      <FormatSelect value={exportFormat} onChange={setExportFormat} />
    </div>
    <label
      style={{
        display: "flex",
        alignItems: "center",
        gap: "10px",
        fontSize: "18px",
        color: "var(--color-text-secondary)",
        cursor: "pointer",
      }}
    >
      <input
        type="checkbox"
        checked={includeMetadata}
        onChange={(e) => setIncludeMetadata(e.target.checked)}
        style={{ cursor: "pointer", width: "20px", height: "20px" }}
      />
      Include IDs and timestamps
    </label>
    <TactileButton
      onClick={onExport}
      variant="primary"
      disabled={exporting}
      style={{ justifyContent: "center", height: "56px", fontSize: "20px" }}
    >
      {exporting ? "Exporting..." : "Export..."}
    </TactileButton>
  </div>
);
