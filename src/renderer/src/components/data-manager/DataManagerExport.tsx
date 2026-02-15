import React from 'react';
import { CategorySelect, FormatSelect } from './SharedComponents';
import { TactileButton } from '../TactileButton';
import type { DataCategory, ExportFormat } from '@shared/ipc';

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
  <div className="data-manager-section">
    <div className="data-manager-section-heading">Export Data</div>
    <div className="data-manager-section-description">
      Export your data as JSON or CSV. JSON preserves all data including IDs and timestamps. CSV is
      compatible with spreadsheet applications.
    </div>
    <div className="data-manager-controls-row">
      <CategorySelect value={exportCategory} onChange={setExportCategory} />
      <FormatSelect value={exportFormat} onChange={setExportFormat} />
    </div>
    <label className="data-manager-checkbox-label">
      <input
        type="checkbox"
        checked={includeMetadata}
        onChange={(e) => setIncludeMetadata(e.target.checked)}
        className="data-manager-checkbox"
      />
      Include IDs and timestamps
    </label>
    <TactileButton onClick={onExport} variant="primary" disabled={exporting} className="dm-big-btn">
      {exporting ? 'Exporting...' : 'Export...'}
    </TactileButton>
  </div>
);
