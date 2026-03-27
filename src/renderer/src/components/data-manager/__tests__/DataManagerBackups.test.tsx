import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BackupEntry, IpcResult } from '@shared/ipc';

const mockListBackups = vi.fn<() => Promise<BackupEntry[]>>();
const mockCreateBackup = vi.fn<() => Promise<IpcResult<string>>>();
const mockRestoreBackup = vi.fn<(name: string) => Promise<IpcResult>>();

vi.stubGlobal('api', {
  listBackups: mockListBackups,
  createBackup: mockCreateBackup,
  restoreBackup: mockRestoreBackup,
});

// Mock TactileButton
vi.mock('../../../components/TactileButton', () => ({
  TactileButton: ({
    children,
    onClick,
    disabled,
    className,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    className?: string;
  }) => (
    <button onClick={onClick} disabled={disabled} className={className}>
      {children}
    </button>
  ),
}));

import { DataManagerBackups } from '../DataManagerBackups';

const SAMPLE_BACKUPS: BackupEntry[] = [
  { name: '2026-03-25T10-30-00-000Z.zip', date: '2026-03-25T10:30:00.000Z', size: 2_500_000 },
  { name: '2026-03-24T08-00-00-000Z.zip', date: '2026-03-24T08:00:00.000Z', size: 1_200_000 },
];

describe('DataManagerBackups', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListBackups.mockResolvedValue(SAMPLE_BACKUPS);
  });

  it('renders backup list on mount', async () => {
    render(<DataManagerBackups />);

    await waitFor(() => {
      expect(screen.getByText(/Mar 25, 2026/)).toBeInTheDocument();
      expect(screen.getByText(/Mar 24, 2026/)).toBeInTheDocument();
    });
  });

  it('shows file sizes in human-readable format', async () => {
    render(<DataManagerBackups />);

    await waitFor(() => {
      expect(screen.getByText('2.4 MB')).toBeInTheDocument();
      expect(screen.getByText('1.1 MB')).toBeInTheDocument();
    });
  });

  it('shows empty state when no backups exist', async () => {
    mockListBackups.mockResolvedValue([]);
    render(<DataManagerBackups />);

    await waitFor(() => {
      expect(screen.getByText('No backups available')).toBeInTheDocument();
    });
  });

  it('creates a backup when clicking Create Backup', async () => {
    mockCreateBackup.mockResolvedValue({ success: true, data: 'new-backup.zip' });
    render(<DataManagerBackups />);

    await waitFor(() => screen.getByText('Create Backup'));
    fireEvent.click(screen.getByText('Create Backup'));

    await waitFor(() => {
      expect(mockCreateBackup).toHaveBeenCalledTimes(1);
    });
  });

  it('shows confirmation dialog before restore', async () => {
    render(<DataManagerBackups />);

    await waitFor(() => screen.getAllByText('Restore'));
    fireEvent.click(screen.getAllByText('Restore')[0]);

    expect(screen.getByText(/This will replace all current data/)).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
    expect(screen.getByText('Confirm Restore')).toBeInTheDocument();
  });

  it('calls restoreBackup on confirm', async () => {
    mockRestoreBackup.mockResolvedValue({ success: true });

    render(<DataManagerBackups />);

    await waitFor(() => screen.getAllByText('Restore'));
    fireEvent.click(screen.getAllByText('Restore')[0]);
    fireEvent.click(screen.getByText('Confirm Restore'));

    await waitFor(() => {
      expect(mockRestoreBackup).toHaveBeenCalledWith('2026-03-25T10-30-00-000Z.zip');
    });
  });

  it('cancels restore confirmation', async () => {
    render(<DataManagerBackups />);

    await waitFor(() => screen.getAllByText('Restore'));
    fireEvent.click(screen.getAllByText('Restore')[0]);

    expect(screen.getByText(/This will replace all current data/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.queryByText(/This will replace all current data/)).not.toBeInTheDocument();
  });

  it('shows error when listBackups fails', async () => {
    mockListBackups.mockRejectedValue(new Error('network error'));
    render(<DataManagerBackups />);

    await waitFor(() => {
      expect(screen.getByText('Failed to load backups')).toBeInTheDocument();
    });
  });

  it('shows error when createBackup returns failure', async () => {
    mockCreateBackup.mockResolvedValue({ success: false, error: 'Disk full' });
    render(<DataManagerBackups />);

    await waitFor(() => screen.getByText('Create Backup'));
    fireEvent.click(screen.getByText('Create Backup'));

    await waitFor(() => {
      expect(screen.getByText('Disk full')).toBeInTheDocument();
    });
  });

  it('shows default error when createBackup fails without message', async () => {
    mockCreateBackup.mockResolvedValue({ success: false });
    render(<DataManagerBackups />);

    await waitFor(() => screen.getByText('Create Backup'));
    fireEvent.click(screen.getByText('Create Backup'));

    await waitFor(() => {
      expect(screen.getByText('Failed to create backup')).toBeInTheDocument();
    });
  });

  it('shows error when createBackup throws', async () => {
    mockCreateBackup.mockRejectedValue(new Error('unexpected'));
    render(<DataManagerBackups />);

    await waitFor(() => screen.getByText('Create Backup'));
    fireEvent.click(screen.getByText('Create Backup'));

    await waitFor(() => {
      expect(screen.getByText('Failed to create backup')).toBeInTheDocument();
    });
  });

  it('shows error when restoreBackup returns failure', async () => {
    mockRestoreBackup.mockResolvedValue({ success: false, error: 'Corrupt backup' });
    render(<DataManagerBackups />);

    await waitFor(() => screen.getAllByText('Restore'));
    fireEvent.click(screen.getAllByText('Restore')[0]);
    fireEvent.click(screen.getByText('Confirm Restore'));

    await waitFor(() => {
      expect(screen.getByText('Corrupt backup')).toBeInTheDocument();
    });
  });

  it('shows default error when restoreBackup fails without message', async () => {
    mockRestoreBackup.mockResolvedValue({ success: false });
    render(<DataManagerBackups />);

    await waitFor(() => screen.getAllByText('Restore'));
    fireEvent.click(screen.getAllByText('Restore')[0]);
    fireEvent.click(screen.getByText('Confirm Restore'));

    await waitFor(() => {
      expect(screen.getByText('Restore failed')).toBeInTheDocument();
    });
  });

  it('shows error when restoreBackup throws', async () => {
    mockRestoreBackup.mockRejectedValue(new Error('unexpected'));
    render(<DataManagerBackups />);

    await waitFor(() => screen.getAllByText('Restore'));
    fireEvent.click(screen.getAllByText('Restore')[0]);
    fireEvent.click(screen.getByText('Confirm Restore'));

    await waitFor(() => {
      expect(screen.getByText('Restore failed unexpectedly')).toBeInTheDocument();
    });
  });

  it('dismisses error when Dismiss is clicked', async () => {
    mockListBackups.mockRejectedValue(new Error('network error'));
    render(<DataManagerBackups />);

    await waitFor(() => {
      expect(screen.getByText('Failed to load backups')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Dismiss'));
    expect(screen.queryByText('Failed to load backups')).not.toBeInTheDocument();
  });
});
