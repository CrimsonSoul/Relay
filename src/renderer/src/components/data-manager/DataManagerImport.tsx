import React, { useState } from 'react';
import type { ServerSyncController } from '../../hooks/useServerSyncImport';
import { ServerSyncImport } from './ServerSyncImport';
import { CategorySelect } from './SharedComponents';
import { TactileButton } from '../TactileButton';
import type { DataCategory, ImportProgress, ImportResult } from '@shared/ipc';

interface Props {
  sync?: ServerSyncController;
  importCategory: DataCategory;
  setImportCategory: (category: DataCategory) => void;
  importing: boolean;
  importProgress: ImportProgress | null;
  onImport: () => void;
  lastImportResult: ImportResult | null;
  onClearResult: () => void;
}

export const DataManagerImport: React.FC<Props> = ({
  sync,
  importCategory,
  setImportCategory,
  importing,
  importProgress,
  onImport,
  lastImportResult,
  onClearResult,
}) => {
  const [mode, setMode] = useState('merge');
  const syncing = importCategory === 'servers' && mode === 'sync' && sync;
  const busy = importing || Boolean(sync?.busy);
  const changeCategory = (category: DataCategory) => {
    sync?.reset();
    setMode('merge');
    setImportCategory(category);
  };
  return (
    <div className="data-manager-section">
      <div className="data-manager-section-heading">Import Data</div>
      <div className="data-manager-section-description">
        Import data from JSON, CSV, or XLSX files. Existing records will be updated by email
        (contacts), name (servers), or team+role+name (on-call).
      </div>
      <div className="data-manager-controls-row">
        <CategorySelect
          value={importCategory}
          onChange={changeCategory}
          excludeAll
          disabled={busy}
        />
        {importCategory === 'servers' && sync && (
          <select
            aria-label="Server import mode"
            className="dm-select"
            value={mode}
            disabled={busy}
            onChange={(e) => {
              sync.reset();
              setMode(e.target.value);
            }}
          >
            <option value="merge">Add or update</option>
            <option value="sync">Sync full list</option>
          </select>
        )}
        {!syncing && (
          <TactileButton
            onClick={onImport}
            variant="primary"
            disabled={busy}
            className="dm-big-btn"
          >
            {importing ? 'Importing...' : 'Import...'}
          </TactileButton>
        )}
      </div>
      {syncing && <ServerSyncImport sync={syncing} />}
      {!syncing && importing && importProgress && (
        <output className="data-manager-import-progress" aria-live="polite">
          <strong>
            Processed {importProgress.processed.toLocaleString()} of{' '}
            {importProgress.total.toLocaleString()}
          </strong>
          <span>
            Imported {importProgress.imported.toLocaleString()} · Updated{' '}
            {importProgress.updated.toLocaleString()} · Errors{' '}
            {importProgress.errors.toLocaleString()}
          </span>
        </output>
      )}
      {!syncing && lastImportResult && (
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
};
