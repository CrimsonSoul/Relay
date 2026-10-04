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
  const ImportResultTag = lastImportResult?.success ? 'output' : 'div';
  return (
    <div className="data-manager-section">
      <div className="data-manager-section-heading">Import data</div>
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
        <output className="data-manager-import-progress">
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
      {/* Success is a polite <output>, matching ServerSyncImport; a failure interrupts as an alert. */}
      {!syncing && lastImportResult && (
        <ImportResultTag
          className={
            lastImportResult.success
              ? 'data-manager-import-result data-manager-import-result--success'
              : 'data-manager-import-result--error panel-error ink-rail ink-rail--alarm'
          }
          role={lastImportResult.success ? undefined : 'alert'}
        >
          <span className="data-manager-import-result-header">
            <span>
              {!lastImportResult.success && <strong>Import failed. </strong>}
              Imported: {lastImportResult.imported}, Updated: {lastImportResult.updated}, Skipped:{' '}
              {lastImportResult.skipped}
            </span>
            <TactileButton
              size="xs"
              variant="ghost"
              onClick={onClearResult}
              aria-label="Dismiss Import Results"
              icon={
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              }
            />
          </span>
          {lastImportResult.errors.length > 0 && (
            <span className="data-manager-import-errors">
              Errors: {lastImportResult.errors.slice(0, 3).join(', ')}
              {lastImportResult.errors.length > 3 && ` +${lastImportResult.errors.length - 3} more`}
            </span>
          )}
        </ImportResultTag>
      )}
    </div>
  );
};
