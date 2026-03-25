import React, { useState, useEffect, useCallback } from 'react';
import type { BackupEntry } from '@shared/ipc';

declare const api: {
  listBackups: () => Promise<BackupEntry[]>;
  createBackup: () => Promise<{ success: boolean; data?: string; error?: string }>;
  restoreBackup: (name: string) => Promise<{ success: boolean; error?: string }>;
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export const DataManagerBackups: React.FC = () => {
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState<BackupEntry | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadBackups = useCallback(async () => {
    setLoading(true);
    try {
      const list = await api.listBackups();
      setBackups(list);
      setError(null);
    } catch {
      setError('Failed to load backups');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadBackups();
  }, [loadBackups]);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const result = await api.createBackup();
      if (result.success) {
        await loadBackups();
      } else {
        setError(result.error ?? 'Failed to create backup');
      }
    } catch {
      setError('Failed to create backup');
    } finally {
      setCreating(false);
    }
  };

  const handleRestore = async (backup: BackupEntry) => {
    setRestoring(true);
    setConfirmRestore(null);
    try {
      const result = await api.restoreBackup(backup.name);
      if (result.success) {
        window.location.reload();
      } else {
        setError(result.error ?? 'Restore failed');
        setRestoring(false);
      }
    } catch {
      setError('Restore failed unexpectedly');
      setRestoring(false);
    }
  };

  return (
    <div className="dm-backups">
      <div className="dm-backups-header">
        <p className="dm-backups-desc">
          Backups are created automatically on startup. You can also create one manually or restore
          from a previous backup.
        </p>
        <button
          type="button"
          className="dm-btn dm-btn--primary"
          onClick={handleCreate}
          disabled={creating || restoring}
        >
          {creating ? 'Creating...' : 'Create Backup'}
        </button>
      </div>

      {error && (
        <div className="dm-backups-error">
          {error}
          <button type="button" className="dm-btn-link" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      )}

      {loading && <div className="dm-backups-loading">Loading backups...</div>}

      {!loading && backups.length === 0 && (
        <div className="dm-backups-empty">No backups available</div>
      )}

      {!loading && backups.length > 0 && (
        <div className="dm-backups-list">
          {backups.map((b) => (
            <div key={b.name} className="dm-backup-row">
              <div className="dm-backup-info">
                <span className="dm-backup-date">{formatDate(b.date)}</span>
                <span className="dm-backup-size">{formatSize(b.size)}</span>
              </div>
              <button
                type="button"
                className="dm-btn dm-btn--secondary"
                onClick={() => setConfirmRestore(b)}
                disabled={restoring}
              >
                Restore
              </button>
            </div>
          ))}
        </div>
      )}

      {confirmRestore && (
        <div className="dm-backups-confirm">
          <p>
            This will replace all current data with the backup from{' '}
            <strong>{formatDate(confirmRestore.date)}</strong>. A safety backup of the current state
            will be created first. Continue?
          </p>
          <div className="dm-backups-confirm-actions">
            <button
              type="button"
              className="dm-btn dm-btn--secondary"
              onClick={() => setConfirmRestore(null)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="dm-btn dm-btn--danger"
              onClick={() => handleRestore(confirmRestore)}
            >
              Confirm Restore
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
