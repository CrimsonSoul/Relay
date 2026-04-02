import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DataManagerModal } from '../DataManagerModal';

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

vi.mock('../data-manager/SharedComponents', () => ({
  TabButton: ({
    children,
    onClick,
    active,
  }: {
    children: React.ReactNode;
    onClick: () => void;
    active: boolean;
  }) => (
    <button onClick={onClick} data-active={active}>
      {children}
    </button>
  ),
}));

describe('DataManagerModal', () => {
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockExportData.mockResolvedValue(true);
    mockImportData.mockResolvedValue({ success: true, imported: 5, updated: 2 });
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

  it('shows the Overview tab by default', () => {
    render(<DataManagerModal isOpen={true} onClose={onClose} />);
    expect(screen.getByTestId('overview')).toBeInTheDocument();
  });

  it('switches to Import tab when Import is clicked', () => {
    render(<DataManagerModal isOpen={true} onClose={onClose} />);
    fireEvent.click(screen.getByText('Import'));
    expect(screen.getByTestId('import-btn')).toBeInTheDocument();
    expect(screen.queryByTestId('overview')).not.toBeInTheDocument();
  });

  it('switches to Export tab when Export is clicked', () => {
    render(<DataManagerModal isOpen={true} onClose={onClose} />);
    fireEvent.click(screen.getByText('Export'));
    expect(screen.getByTestId('export-btn')).toBeInTheDocument();
    expect(screen.queryByTestId('overview')).not.toBeInTheDocument();
  });

  it('can switch back to Overview tab', () => {
    render(<DataManagerModal isOpen={true} onClose={onClose} />);
    fireEvent.click(screen.getByText('Import'));
    fireEvent.click(screen.getByText('Overview'));
    expect(screen.getByTestId('overview')).toBeInTheDocument();
  });

  it('triggers export when export button is clicked', () => {
    render(<DataManagerModal isOpen={true} onClose={onClose} />);
    fireEvent.click(screen.getByText('Export'));
    fireEvent.click(screen.getByTestId('export-btn'));
    expect(screen.getByTestId('export-btn')).toBeInTheDocument();
  });

  it('triggers import when import button is clicked', () => {
    render(<DataManagerModal isOpen={true} onClose={onClose} />);
    fireEvent.click(screen.getByText('Import'));
    fireEvent.click(screen.getByTestId('import-btn'));
    expect(screen.getByTestId('import-btn')).toBeInTheDocument();
  });

  it('switches to Backups tab', () => {
    render(<DataManagerModal isOpen={true} onClose={onClose} />);
    fireEvent.click(screen.getByText('Backups'));
    expect(screen.getByTestId('backups')).toBeInTheDocument();
    expect(screen.queryByTestId('overview')).not.toBeInTheDocument();
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
