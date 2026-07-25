import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DataManagerModal } from '../DataManagerModal';
import { ELECTRON_RUNTIME, WEB_RUNTIME } from '@shared/runtime';

const mockExportData = vi.fn().mockResolvedValue(true);
const mockImportData = vi.fn().mockResolvedValue({ success: true, imported: 5, updated: 2 });
const mockLoadStats = vi.fn().mockResolvedValue(undefined);
const mockShowToast = vi.fn();

// Mock useDataManager hook
vi.mock('../../hooks/useDataManager', () => ({
  useDataManager: () => ({
    stats: { contacts: 10, servers: 5, groups: 3, oncall: 8 },
    exporting: false,
    importing: false,
    lastImportResult: null,
    loadStats: mockLoadStats,
    exportData: mockExportData,
    importData: mockImportData,
    clearLastImportResult: vi.fn(),
  }),
}));

// Mock Toast
vi.mock('../Toast', () => ({
  useToast: () => ({ showToast: mockShowToast }),
}));

// Mock logger
vi.mock('../../utils/logger', () => ({
  loggers: {
    app: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
  },
}));

// Mock data-manager sub-components to avoid deep rendering complexity
vi.mock('../data-manager/DataManagerOverview', () => ({
  DataManagerOverview: ({ stats }: { stats: unknown }) => (
    <div data-testid="overview">{JSON.stringify(stats)}</div>
  ),
}));

vi.mock('../data-manager/DataManagerImport', () => ({
  DataManagerImport: ({ onImport }: { onImport: () => void }) => (
    <button data-testid="import-btn" onClick={onImport}>
      Run Import
    </button>
  ),
}));

vi.mock('../data-manager/DataManagerExport', () => ({
  DataManagerExport: ({ onExport }: { onExport: () => void }) => (
    <button data-testid="export-btn" onClick={onExport}>
      Run Export
    </button>
  ),
}));

vi.mock('../data-manager/DataManagerBackups', () => ({
  DataManagerBackups: () => <div data-testid="backups">Backups content</div>,
}));

describe('DataManagerModal', () => {
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockExportData.mockResolvedValue(true);
    mockImportData.mockResolvedValue({ success: true, imported: 5, updated: 2 });
    globalThis.api = { runtime: ELECTRON_RUNTIME } as typeof globalThis.api;
  });

  it('does not render when isOpen is false', () => {
    render(<DataManagerModal isOpen={false} onClose={onClose} />);
    const dialog = document.querySelector('dialog');
    expect(!dialog || !dialog.hasAttribute('open')).toBe(true);
  });

  it('renders when isOpen is true', () => {
    render(<DataManagerModal isOpen={true} onClose={onClose} />);
    expect(screen.getByText('Data Manager')).toBeInTheDocument();
  });

  it('uses the wide shared shell and stable tab rail', () => {
    render(<DataManagerModal isOpen onClose={onClose} />);

    const dialog = screen.getByRole('dialog', { name: 'Data Manager' });
    expect(dialog).toHaveAttribute('data-variant', 'wide');
    expect(dialog.querySelector('.modal-tabs-generic')).not.toBeNull();
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
  });

  it('keys the active panel for the shared 160ms content transition', () => {
    render(<DataManagerModal isOpen onClose={onClose} />);

    fireEvent.click(screen.getByRole('tab', { name: 'Import' }));

    expect(screen.getByRole('tabpanel', { name: 'Import' })).toHaveAttribute(
      'data-motion',
      'panel',
    );
  });

  it('shows the Overview tab by default', () => {
    render(<DataManagerModal isOpen={true} onClose={onClose} />);
    expect(screen.getByTestId('overview')).toBeInTheDocument();
  });

  it.each([
    ['Import', 'import-btn'],
    ['Export', 'export-btn'],
  ])('switches to the %s tab when clicked', (tabName, expectedTestId) => {
    render(<DataManagerModal isOpen={true} onClose={onClose} />);
    fireEvent.click(screen.getByText(tabName));
    expect(screen.getByTestId(expectedTestId)).toBeInTheDocument();
    expect(screen.queryByTestId('overview')).not.toBeInTheDocument();
  });

  it('can switch back to Overview tab', () => {
    render(<DataManagerModal isOpen={true} onClose={onClose} />);
    fireEvent.click(screen.getByText('Import'));
    fireEvent.click(screen.getByText('Overview'));
    expect(screen.getByTestId('overview')).toBeInTheDocument();
  });

  it('triggers export with the exact selected payload', async () => {
    render(<DataManagerModal isOpen={true} onClose={onClose} />);
    fireEvent.click(screen.getByText('Export'));
    fireEvent.click(screen.getByTestId('export-btn'));

    await vi.waitFor(() => {
      expect(mockExportData).toHaveBeenCalledWith({
        format: 'json',
        category: 'all',
        includeMetadata: false,
      });
    });
  });

  it('triggers import with the exact selected category', async () => {
    render(<DataManagerModal isOpen={true} onClose={onClose} />);
    fireEvent.click(screen.getByText('Import'));
    fireEvent.click(screen.getByTestId('import-btn'));

    await vi.waitFor(() => {
      expect(mockImportData).toHaveBeenCalledWith('contacts');
    });
  });

  it('switches to Backups tab', () => {
    render(<DataManagerModal isOpen={true} onClose={onClose} />);
    fireEvent.click(screen.getByText('Backups'));
    expect(screen.getByTestId('backups')).toBeInTheDocument();
    expect(screen.queryByTestId('overview')).not.toBeInTheDocument();
  });

  it('keeps import and export but removes backup controls in the web runtime', () => {
    globalThis.api = { runtime: WEB_RUNTIME } as typeof globalThis.api;
    render(<DataManagerModal isOpen onClose={onClose} />);

    expect(screen.getByRole('tab', { name: 'Import' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Export' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Backups' })).not.toBeInTheDocument();
  });

  it('shows error toast when export returns false', async () => {
    mockExportData.mockResolvedValue(false);

    render(<DataManagerModal isOpen={true} onClose={onClose} />);
    fireEvent.click(screen.getByText('Export'));
    fireEvent.click(screen.getByTestId('export-btn'));

    await vi.waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith('Export failed. Please try again.', 'error');
    });
  });

  it('shows error toast when export throws', async () => {
    mockExportData.mockRejectedValue(new Error('disk full'));

    render(<DataManagerModal isOpen={true} onClose={onClose} />);
    fireEvent.click(screen.getByText('Export'));
    fireEvent.click(screen.getByTestId('export-btn'));

    await vi.waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith(
        'Export failed unexpectedly. Please try again.',
        'error',
      );
    });
  });

  it('shows success toast when export succeeds', async () => {
    mockExportData.mockResolvedValue(true);

    render(<DataManagerModal isOpen={true} onClose={onClose} />);
    fireEvent.click(screen.getByText('Export'));
    fireEvent.click(screen.getByTestId('export-btn'));

    await vi.waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith('Exported all as JSON', 'success');
    });
  });

  it('shows info toast when import has errors', async () => {
    mockImportData.mockResolvedValue({ success: false, errors: ['bad row'] });

    render(<DataManagerModal isOpen={true} onClose={onClose} />);
    fireEvent.click(screen.getByText('Import'));
    fireEvent.click(screen.getByTestId('import-btn'));

    await vi.waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith('Import completed with errors', 'info');
    });
  });

  it('shows error toast when import returns no success and no errors', async () => {
    mockImportData.mockResolvedValue({ success: false });

    render(<DataManagerModal isOpen={true} onClose={onClose} />);
    fireEvent.click(screen.getByText('Import'));
    fireEvent.click(screen.getByTestId('import-btn'));

    await vi.waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith('Import failed. Please try again.', 'error');
    });
  });

  it('shows error toast when import throws', async () => {
    mockImportData.mockRejectedValue(new Error('oops'));

    render(<DataManagerModal isOpen={true} onClose={onClose} />);
    fireEvent.click(screen.getByText('Import'));
    fireEvent.click(screen.getByTestId('import-btn'));

    await vi.waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith(
        'Import failed unexpectedly. Please try again.',
        'error',
      );
    });
  });
});
