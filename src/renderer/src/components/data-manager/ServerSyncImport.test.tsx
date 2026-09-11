import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ServerSyncImport } from './ServerSyncImport';
import type { ServerSyncController } from '../../hooks/useServerSyncImport';
const controller: ServerSyncController = {
  preview: {
    fileName: 'servers.json',
    added: ['NEW'],
    updated: ['SHARED'],
    removed: ['USER-01', 'USER-02'],
    unchanged: 3,
    incomingCount: 5,
    currentCount: 6,
    backupJson: '[]',
    apply: vi.fn(),
  },
  busy: false,
  progress: null,
  result: null,
  error: null,
  chooseFile: vi.fn(),
  apply: vi.fn(),
  reset: vi.fn(),
  downloadBackup: vi.fn(),
};
it('lists every removal and requires explicit review before applying', () => {
  render(<ServerSyncImport sync={controller} />);
  expect(screen.getByText('USER-01')).toBeInTheDocument();
  expect(screen.getByText('USER-02')).toBeInTheDocument();
  const apply = screen.getByRole('button', { name: 'Sync and remove 2 servers' });
  expect(apply).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox'));
  expect(apply).toBeEnabled();
  fireEvent.click(apply);
  expect(controller.apply).toHaveBeenCalledTimes(1);
});
it('offers cancellation and a backup before applying', () => {
  render(<ServerSyncImport sync={controller} />);
  fireEvent.click(screen.getByRole('button', { name: 'Download current list' }));
  expect(controller.downloadBackup).toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel preview' }));
  expect(controller.reset).toHaveBeenCalled();
});
it('locks review actions while a sync is running', () => {
  render(<ServerSyncImport sync={{ ...controller, busy: true }} />);
  expect(screen.getByRole('checkbox')).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Cancel preview' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Sync and remove 2 servers' })).toBeDisabled();
});
