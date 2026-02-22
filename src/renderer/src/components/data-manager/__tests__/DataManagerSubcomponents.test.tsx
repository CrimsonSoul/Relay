import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { DataManagerOverview } from '../DataManagerOverview';
import { DataManagerImport } from '../DataManagerImport';
import { DataManagerExport } from '../DataManagerExport';
import type { DataStats, ImportResult } from '@shared/ipc';

// ── DataManagerOverview ──────────────────────────────────────────────────────
describe('DataManagerOverview', () => {
  it('renders stat cards with zero counts when stats is null', () => {
    render(<DataManagerOverview stats={null} />);
    expect(screen.getByText('Data Statistics')).toBeInTheDocument();
    // Four zero counts
    const zeros = screen.getAllByText('0');
    expect(zeros.length).toBeGreaterThanOrEqual(4);
  });

  it('renders correct counts from stats object', () => {
    const stats: DataStats = {
      contacts: { count: 42, lastUpdated: 0 },
      servers: { count: 7, lastUpdated: 0 },
      oncall: { count: 15, lastUpdated: 0 },
      groups: { count: 3, lastUpdated: 0 },
    };
    render(<DataManagerOverview stats={stats} />);
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText('15')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('renders label names for each stat category', () => {
    render(<DataManagerOverview stats={null} />);
    expect(screen.getByText('Contacts')).toBeInTheDocument();
    expect(screen.getByText('Servers')).toBeInTheDocument();
    expect(screen.getByText('On-Call')).toBeInTheDocument();
    expect(screen.getByText('Groups')).toBeInTheDocument();
  });

  it('shows lastUpdated date when provided and non-zero', () => {
    const ts = new Date('2025-01-15').getTime();
    const stats: DataStats = {
      contacts: { count: 1, lastUpdated: ts },
      servers: { count: 0, lastUpdated: 0 },
      oncall: { count: 0, lastUpdated: 0 },
      groups: { count: 0, lastUpdated: 0 },
    };
    render(<DataManagerOverview stats={stats} />);
    expect(screen.getByText(/Updated/)).toBeInTheDocument();
  });
});

// ── DataManagerImport ────────────────────────────────────────────────────────
describe('DataManagerImport', () => {
  const defaultImportProps = {
    importCategory: 'contacts' as const,
    setImportCategory: vi.fn(),
    importing: false,
    onImport: vi.fn(),
    lastImportResult: null,
    onClearResult: vi.fn(),
  };

  it('renders the import section heading', () => {
    render(<DataManagerImport {...defaultImportProps} />);
    expect(screen.getByText('Import Data')).toBeInTheDocument();
  });

  it('renders Import button in idle state', () => {
    render(<DataManagerImport {...defaultImportProps} />);
    expect(screen.getByText('Import...')).toBeInTheDocument();
  });

  it('renders Importing... when importing is true', () => {
    render(<DataManagerImport {...defaultImportProps} importing={true} />);
    expect(screen.getByText('Importing...')).toBeInTheDocument();
  });

  it('disables button while importing', () => {
    render(<DataManagerImport {...defaultImportProps} importing={true} />);
    const btn = screen.getByText('Importing...').closest('button');
    expect(btn).toBeDisabled();
  });

  it('calls onImport when Import button is clicked', () => {
    const onImport = vi.fn();
    render(<DataManagerImport {...defaultImportProps} onImport={onImport} />);
    fireEvent.click(screen.getByText('Import...'));
    expect(onImport).toHaveBeenCalled();
  });

  it('does not show result panel when lastImportResult is null', () => {
    render(<DataManagerImport {...defaultImportProps} />);
    expect(screen.queryByText(/Imported:/)).not.toBeInTheDocument();
  });

  it('shows success result with counts', () => {
    const result: ImportResult = {
      success: true,
      imported: 5,
      updated: 2,
      skipped: 1,
      errors: [],
    };
    render(<DataManagerImport {...defaultImportProps} lastImportResult={result} />);
    expect(screen.getByText(/Imported: 5/)).toBeInTheDocument();
    expect(screen.getByText(/Updated: 2/)).toBeInTheDocument();
    expect(screen.getByText(/Skipped: 1/)).toBeInTheDocument();
  });

  it('shows error messages in result panel', () => {
    const result: ImportResult = {
      success: false,
      imported: 0,
      updated: 0,
      skipped: 0,
      errors: ['Error one', 'Error two'],
    };
    render(<DataManagerImport {...defaultImportProps} lastImportResult={result} />);
    expect(screen.getByText(/Errors:/)).toBeInTheDocument();
    expect(screen.getByText(/Error one/)).toBeInTheDocument();
  });

  it('calls onClearResult when close button is clicked', () => {
    const onClearResult = vi.fn();
    const result: ImportResult = {
      success: true,
      imported: 1,
      updated: 0,
      skipped: 0,
      errors: [],
    };
    render(
      <DataManagerImport
        {...defaultImportProps}
        lastImportResult={result}
        onClearResult={onClearResult}
      />,
    );
    fireEvent.click(screen.getByText('×'));
    expect(onClearResult).toHaveBeenCalled();
  });

  it('shows "+N more" when there are more than 3 errors', () => {
    const result: ImportResult = {
      success: false,
      imported: 0,
      updated: 0,
      skipped: 0,
      errors: ['e1', 'e2', 'e3', 'e4', 'e5'],
    };
    render(<DataManagerImport {...defaultImportProps} lastImportResult={result} />);
    expect(screen.getByText(/\+2 more/)).toBeInTheDocument();
  });

  it('calls setImportCategory when category select changes', () => {
    const setImportCategory = vi.fn();
    render(<DataManagerImport {...defaultImportProps} setImportCategory={setImportCategory} />);
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'servers' } });
    expect(setImportCategory).toHaveBeenCalledWith('servers');
  });
});

// ── DataManagerExport ────────────────────────────────────────────────────────
describe('DataManagerExport', () => {
  const defaultExportProps = {
    exportCategory: 'contacts' as const,
    setExportCategory: vi.fn(),
    exportFormat: 'json' as const,
    setExportFormat: vi.fn(),
    includeMetadata: false,
    setIncludeMetadata: vi.fn(),
    exporting: false,
    onExport: vi.fn(),
  };

  it('renders the export section heading', () => {
    render(<DataManagerExport {...defaultExportProps} />);
    expect(screen.getByText('Export Data')).toBeInTheDocument();
  });

  it('renders Export button in idle state', () => {
    render(<DataManagerExport {...defaultExportProps} />);
    expect(screen.getByText('Export...')).toBeInTheDocument();
  });

  it('renders Exporting... when exporting is true', () => {
    render(<DataManagerExport {...defaultExportProps} exporting={true} />);
    expect(screen.getByText('Exporting...')).toBeInTheDocument();
  });

  it('disables button while exporting', () => {
    render(<DataManagerExport {...defaultExportProps} exporting={true} />);
    const btn = screen.getByText('Exporting...').closest('button');
    expect(btn).toBeDisabled();
  });

  it('calls onExport when Export button is clicked', () => {
    const onExport = vi.fn();
    render(<DataManagerExport {...defaultExportProps} onExport={onExport} />);
    fireEvent.click(screen.getByText('Export...'));
    expect(onExport).toHaveBeenCalled();
  });

  it('renders the metadata checkbox', () => {
    render(<DataManagerExport {...defaultExportProps} />);
    expect(screen.getByRole('checkbox')).toBeInTheDocument();
    expect(screen.getByText('Include IDs and timestamps')).toBeInTheDocument();
  });

  it('calls setIncludeMetadata when checkbox is toggled', () => {
    const setIncludeMetadata = vi.fn();
    render(<DataManagerExport {...defaultExportProps} setIncludeMetadata={setIncludeMetadata} />);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(setIncludeMetadata).toHaveBeenCalledWith(true);
  });

  it('reflects checked state of includeMetadata prop', () => {
    render(<DataManagerExport {...defaultExportProps} includeMetadata={true} />);
    expect(screen.getByRole('checkbox')).toBeChecked();
  });

  it('has two selects (category and format)', () => {
    render(<DataManagerExport {...defaultExportProps} />);
    const selects = screen.getAllByRole('combobox');
    expect(selects.length).toBe(2);
  });

  it('calls setExportFormat when format select changes', () => {
    const setExportFormat = vi.fn();
    render(<DataManagerExport {...defaultExportProps} setExportFormat={setExportFormat} />);
    const [, formatSelect] = screen.getAllByRole('combobox');
    fireEvent.change(formatSelect, { target: { value: 'csv' } });
    expect(setExportFormat).toHaveBeenCalledWith('csv');
  });
});
