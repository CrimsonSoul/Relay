import React, { useState, useEffect } from 'react';
import { Modal } from './Modal';
import { useToast } from './Toast';
import { useServerSyncImport } from '../hooks/useServerSyncImport';
import { useDataManager } from '../hooks/useDataManager';
import type { DataCategory, ExportFormat } from '@shared/ipc';
import { TabButton } from './data-manager/SharedComponents';
import { DataManagerOverview } from './data-manager/DataManagerOverview';
import { DataManagerImport } from './data-manager/DataManagerImport';
import { DataManagerExport } from './data-manager/DataManagerExport';
import { DataManagerBackups } from './data-manager/DataManagerBackups';
import { loggers } from '../utils/logger';
import { formatFailure } from '../utils/failureMessage';
import { hasRelayCapability } from '../runtime/relayRuntime';
import type { ToastType } from './Toast';

type Props = {
  isOpen: boolean;
  onClose: () => void;
};

type TabId = 'overview' | 'import' | 'export' | 'backups';

const DATA_MANAGER_TABS: readonly TabId[] = ['overview', 'import', 'export', 'backups'];

const getTabLabel = (tab: TabId) => tab.charAt(0).toUpperCase() + tab.slice(1);

const categoryLabel = (category: DataCategory) => (category === 'all' ? 'all data' : category);

type ImportOutcome = { imported: number; updated: number; errors: string[] };

function describeImport(
  result: ImportOutcome,
  category: DataCategory,
): { message: string; type: ToastType } {
  const label = categoryLabel(category);
  const counts = `${result.imported} new and ${result.updated} updated ${label}`;
  if (result.errors.length === 0) return { message: `Imported ${counts}`, type: 'success' };
  if (result.imported + result.updated > 0) {
    const rows = result.errors.length === 1 ? 'row' : 'rows';
    return {
      message: `Imported ${counts}; ${result.errors.length} ${rows} could not be imported. The errors are listed under Import.`,
      type: 'warning',
    };
  }
  return {
    message: formatFailure({
      what: `Couldn't import ${label}`,
      error: result.errors[0],
      outcome: 'Nothing was imported.',
      next: 'Check the file and try again.',
    }),
    type: 'error',
  };
}

export const DataManagerModal: React.FC<Props> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [exportCategory, setExportCategory] = useState<DataCategory>('all');
  const [exportFormat, setExportFormat] = useState<ExportFormat>('json');
  const [importCategory, setImportCategory] = useState<DataCategory>('contacts');
  const [includeMetadata, setIncludeMetadata] = useState(false);
  const supportsBackups = hasRelayCapability('pocketBaseRecovery');
  const availableTabs = supportsBackups
    ? DATA_MANAGER_TABS
    : DATA_MANAGER_TABS.filter((tab) => tab !== 'backups');

  const sync = useServerSyncImport();
  const { showToast } = useToast();
  const {
    stats,
    exporting,
    importing,
    importProgress,
    lastImportResult,
    loadStats,
    exportData,
    importData,
    clearLastImportResult,
  } = useDataManager();

  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;
    loadStats().catch((error_) => {
      if (cancelled) return;
      loggers.app.error('[DataManagerModal] Failed to load stats', { error: error_ });
      showToast(
        formatFailure({
          what: "Couldn't load Data Manager record counts",
          error: error_,
          next: 'Close and reopen Data Manager to try again.',
        }),
        'error',
      );
    });

    return () => {
      cancelled = true;
    };
  }, [isOpen, loadStats, showToast]);

  useEffect(() => {
    if (!supportsBackups && activeTab === 'backups') setActiveTab('overview');
  }, [activeTab, supportsBackups]);

  const handleExport = async () => {
    const label = categoryLabel(exportCategory);
    const format = exportFormat.toUpperCase();
    const retry = { label: 'Retry', onClick: () => void handleExport() };
    try {
      const success = await exportData({
        format: exportFormat,
        category: exportCategory,
        includeMetadata,
      });
      if (success) {
        showToast(`Exported ${label} as ${format}`, 'success');
      } else {
        showToast(formatFailure({ what: `Couldn't export ${label} as ${format}` }), 'error', {
          action: retry,
        });
      }
    } catch (error_) {
      showToast(
        formatFailure({ what: `Couldn't export ${label} as ${format}`, error: error_ }),
        'error',
        { action: retry },
      );
    }
  };

  const handleImport = async () => {
    try {
      const result = await importData(importCategory);
      if (!result) return;
      const { message, type } = describeImport(result, importCategory);
      showToast(message, type);
    } catch (error_) {
      showToast(
        formatFailure({
          what: `Couldn't import ${categoryLabel(importCategory)}`,
          error: error_,
          next: 'Check the Import results, then try again.',
        }),
        'error',
      );
    }
  };

  const tabs = (
    <div
      role="tablist"
      tabIndex={-1}
      aria-label="Data Manager sections"
      className="data-manager-tablist tab-strip"
      onKeyDown={(event) => {
        if (
          !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) ||
          sync.busy ||
          importing
        )
          return;
        const buttons = [
          ...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)'),
        ];
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        if (index < 0) return;
        event.preventDefault();
        const step = event.key === 'ArrowRight' ? 1 : -1;
        let next = (index + step + buttons.length) % buttons.length;
        if (event.key === 'Home') next = 0;
        if (event.key === 'End') next = buttons.length - 1;
        buttons[next]?.focus();
        // Arrowing through the rail only previews panels; it must not discard an
        // in-progress import preview the way an explicit tab click does.
        const nextTab = availableTabs[next];
        if (nextTab) setActiveTab(nextTab);
      }}
    >
      {availableTabs.map((tab) => (
        <TabButton
          key={tab}
          id={`data-manager-tab-${tab}`}
          controls={`data-manager-panel-${tab}`}
          active={activeTab === tab}
          disabled={sync.busy || importing}
          onClick={() => {
            sync.reset();
            setActiveTab(tab);
          }}
        >
          {getTabLabel(tab)}
        </TabButton>
      ))}
    </div>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        sync.reset();
        onClose();
      }}
      dismissible={!sync.busy && !importing}
      title="Data Manager"
      subtitle="Import, export, inspect, and protect Relay data."
      variant="wide"
      tabs={tabs}
      bodyClassName="data-manager-body"
    >
      <div
        key={activeTab}
        id={`data-manager-panel-${activeTab}`}
        role="tabpanel"
        aria-labelledby={`data-manager-tab-${activeTab}`}
        data-motion="panel"
        className="data-manager-panel"
      >
        {activeTab === 'overview' && <DataManagerOverview stats={stats} />}
        {activeTab === 'import' && (
          <DataManagerImport
            sync={sync}
            importCategory={importCategory}
            setImportCategory={setImportCategory}
            importing={importing}
            importProgress={importProgress}
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
        {supportsBackups && activeTab === 'backups' && <DataManagerBackups />}
      </div>
    </Modal>
  );
};
