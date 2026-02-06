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
  <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
    <div
      style={{
        fontSize: '18px',
        fontWeight: 700,
        color: 'var(--color-text-tertiary)',
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
      }}
    >
      Import Data
    </div>
    <div
      style={{
        fontSize: '18px',
        color: 'var(--color-text-secondary)',
        lineHeight: 1.55,
      }}
    >
      Import data from JSON or CSV files. Existing records will be updated by email (contacts), name
      (servers), or team+role+name (on-call).
    </div>
    <div style={{ display: 'flex', gap: '14px', alignItems: 'center' }}>
      <CategorySelect value={importCategory} onChange={setImportCategory} excludeAll />
      <TactileButton
        onClick={onImport}
        variant="primary"
        disabled={importing}
        style={{ minWidth: '170px', height: '56px', fontSize: '20px', justifyContent: 'center' }}
      >
        {importing ? 'Importing...' : 'Import...'}
      </TactileButton>
    </div>
    {lastImportResult && (
      <div
        style={{
          padding: '14px 18px',
          background: lastImportResult.success ? 'rgba(0, 180, 80, 0.1)' : 'rgba(255, 80, 80, 0.1)',
          border: `1px solid ${
            lastImportResult.success ? 'rgba(0, 180, 80, 0.3)' : 'rgba(255, 80, 80, 0.3)'
          }`,
          borderRadius: '10px',
          fontSize: '18px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>
            Imported: {lastImportResult.imported}, Updated: {lastImportResult.updated}, Skipped:{' '}
            {lastImportResult.skipped}
          </span>
          <button
            type="button"
            onClick={onClearResult}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--color-text-tertiary)',
              cursor: 'pointer',
              padding: 0,
            }}
          >
            &times;
          </button>
        </div>
        {lastImportResult.errors.length > 0 && (
          <div
            style={{
              marginTop: '8px',
              fontSize: '16px',
              color: 'var(--color-text-secondary)',
            }}
          >
            Errors: {lastImportResult.errors.slice(0, 3).join(', ')}
            {lastImportResult.errors.length > 3 && ` +${lastImportResult.errors.length - 3} more`}
          </div>
        )}
      </div>
    )}
  </div>
);
