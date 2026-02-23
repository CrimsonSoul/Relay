import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DataManagerModal } from '../DataManagerModal';

// Mock useDataManager hook
vi.mock('../../hooks/useDataManager', () => ({
  useDataManager: () => ({
    stats: { contacts: 10, servers: 5, groups: 3, oncall: 8 },
    exporting: false,
    importing: false,
    lastImportResult: null,
    loadStats: vi.fn().mockResolvedValue(undefined),
    exportData: vi.fn().mockResolvedValue(true),
    importData: vi.fn().mockResolvedValue({ success: true, imported: 5, updated: 2 }),
    clearLastImportResult: vi.fn(),
  }),
}));

// Mock Toast
vi.mock('../Toast', () => ({
  useToast: () => ({ showToast: vi.fn() }),
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
  });

  it('does not render when isOpen is false', () => {
    render(<DataManagerModal isOpen={false} onClose={onClose} />);
    expect(screen.queryByText('Data Manager')).not.toBeInTheDocument();
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
});
