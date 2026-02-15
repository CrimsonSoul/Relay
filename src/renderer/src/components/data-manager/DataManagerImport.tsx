import React from 'react';
import { CategorySelect } from './SharedComponents';
import { TactileButton } from '../TactileButton';
import type { DataCategory, ImportResult } from '@shared/ipc';

interface Props {
  importCategory: DataCategory;
  setImportCategory: (category: DataCategory) => void;
  importing: boolean;
  onImport: () => void;
  lastImportResult: ImportResult | null;
  onClearResult: () => void;
}

export const DataManagerImport: React.FC<Props> = ({
  importCategory,
  setImportCategory,
  importing,
  onImport,
  lastImportResult,
  onClearResult,
}) => (
  <div className="data-manager-section">
    <div className="data-manager-section-heading">Import Data</div>
    <div className="data-manager-section-description">
      Import data from JSON or CSV files. Existing records will be updated by email (contacts), name
      (servers), or team+role+name (on-call).
    </div>
    <div className="data-manager-controls-row">
      <CategorySelect value={importCategory} onChange={setImportCategory} excludeAll />
      <TactileButton
        onClick={onImport}
        variant="primary"
        disabled={importing}
        className="dm-big-btn"
      >
        {importing ? 'Importing...' : 'Import...'}
      </TactileButton>
    </div>
    {lastImportResult && (
      <div
        className={`data-manager-import-result ${lastImportResult.success ? 'data-manager-import-result--success' : 'data-manager-import-result--error'}`}
      >
        <div className="data-manager-import-result-header">
          <span>
            Imported: {lastImportResult.imported}, Updated: {lastImportResult.updated}, Skipped:{' '}
            {lastImportResult.skipped}
          </span>
          <button type="button" onClick={onClearResult} className="data-manager-import-close-btn">
            &times;
          </button>
        </div>
        {lastImportResult.errors.length > 0 && (
          <div className="data-manager-import-errors">
            Errors: {lastImportResult.errors.slice(0, 3).join(', ')}
            {lastImportResult.errors.length > 3 && ` +${lastImportResult.errors.length - 3} more`}
          </div>
        )}
      </div>
    )}
  </div>
);
