import React, { useState, useEffect } from 'react';
import { Modal } from './Modal';
import { useToast } from './Toast';
import { useDataManager } from '../hooks/useDataManager';
import type { DataCategory, ExportFormat } from '@shared/ipc';
import { TabButton } from './data-manager/SharedComponents';
import { DataManagerOverview } from './data-manager/DataManagerOverview';
import { DataManagerImport } from './data-manager/DataManagerImport';
import { DataManagerExport } from './data-manager/DataManagerExport';

type Props = {
  isOpen: boolean;
  onClose: () => void;
};

type TabId = 'overview' | 'import' | 'export';

export const DataManagerModal: React.FC<Props> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [exportCategory, setExportCategory] = useState<DataCategory>('all');
  const [exportFormat, setExportFormat] = useState<ExportFormat>('json');
  const [importCategory, setImportCategory] = useState<DataCategory>('contacts');
  const [includeMetadata, setIncludeMetadata] = useState(false);

  const { showToast } = useToast();
  const {
    stats,
    exporting,
    importing,
    lastImportResult,
    loadStats,
    exportData,
    importData,
    clearLastImportResult,
  } = useDataManager();

  useEffect(() => {
    if (isOpen) {
      void loadStats();
    }
  }, [isOpen, loadStats]);

  const handleExport = async () => {
    try {
      const success = await exportData({
        format: exportFormat,
        category: exportCategory,
        includeMetadata,
      });
      if (success) {
        showToast(`Exported ${exportCategory} as ${exportFormat.toUpperCase()}`, 'success');
      } else {
        showToast('Export failed. Please try again.', 'error');
      }
    } catch {
      showToast('Export failed unexpectedly. Please try again.', 'error');
    }
  };

  const handleImport = async () => {
    try {
      const result = await importData(importCategory);
      if (result?.success) {
        showToast(`Imported ${result.imported} new, updated ${result.updated}`, 'success');
      } else if (result?.errors?.length) {
        showToast(`Import completed with errors`, 'info');
      } else {
        showToast('Import failed. Please try again.', 'error');
      }
    } catch {
      showToast('Import failed unexpectedly. Please try again.', 'error');
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Data Manager" width="820px">
      <div className="data-manager-body">
        <div role="tablist" aria-label="Data Manager sections" className="data-manager-tablist">
          <TabButton active={activeTab === 'overview'} onClick={() => setActiveTab('overview')}>
            Overview
          </TabButton>
          <TabButton active={activeTab === 'import'} onClick={() => setActiveTab('import')}>
            Import
          </TabButton>
          <TabButton active={activeTab === 'export'} onClick={() => setActiveTab('export')}>
            Export
          </TabButton>
        </div>

        <div role="tabpanel" aria-label={`${activeTab} panel`}>
          {activeTab === 'overview' && <DataManagerOverview stats={stats} />}
          {activeTab === 'import' && (
            <DataManagerImport
              importCategory={importCategory}
              setImportCategory={setImportCategory}
              importing={importing}
              onImport={handleImport}
              lastImportResult={lastImportResult}
              onClearResult={clearLastImportResult}
            />
          )}
          {activeTab === 'export' && (
            <DataManagerExport
              exportCategory={exportCategory}
              setExportCategory={setExportCategory}
              exportFormat={exportFormat}
              setExportFormat={setExportFormat}
              includeMetadata={includeMetadata}
              setIncludeMetadata={setIncludeMetadata}
              exporting={exporting}
              onExport={handleExport}
            />
          )}
        </div>
      </div>
    </Modal>
  );
};
