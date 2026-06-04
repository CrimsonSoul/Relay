import React, { useState, useEffect, useCallback } from 'react';
import type { BackupEntry } from '@shared/ipc';
import { TactileButton } from '../TactileButton';
import { useMounted } from '../../hooks/useMounted';

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
  const mounted = useMounted();

  const loadBackups = useCallback(async () => {
    if (!mounted.current) return;
    setLoading(true);
    try {
      const list = await api.listBackups();
      if (!mounted.current) return;
      setBackups(list);
      setError(null);
    } catch {
      if (mounted.current) setError('Failed to load backups');
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [mounted]);

  useEffect(() => {
    void loadBackups();
  }, [loadBackups]);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const result = await api.createBackup();
      if (result.success) {
        if (mounted.current) await loadBackups();
      } else {
        if (mounted.current) setError(result.error ?? 'Failed to create backup');
      }
    } catch {
      if (mounted.current) setError('Failed to create backup');
    } finally {
      if (mounted.current) setCreating(false);
    }
  };

  const handleRestore = async (backup: BackupEntry) => {
    setRestoring(true);
    setConfirmRestore(null);
    try {
      const result = await api.restoreBackup(backup.name);
      if (result.success) {
        globalThis.location.reload();
      } else {
        if (mounted.current) {
          setError(result.error ?? 'Restore failed');
          setRestoring(false);
        }
      }
    } catch {
      if (mounted.current) {
        setError('Restore failed unexpectedly');
        setRestoring(false);
      }
    }
  };

  return (
    <div className="data-manager-section">
      <div className="data-manager-section-heading">Backups</div>
      <div className="data-manager-section-description">
        Backups are created automatically on startup. You can also create one manually or restore
        from a previous backup.
      </div>

      <TactileButton
        variant="primary"
        onClick={handleCreate}
        disabled={creating || restoring}
        loading={creating}
        className="dm-big-btn"
      >
        Create Backup
      </TactileButton>

      {error && (
        <div className="data-manager-import-result data-manager-import-result--error">
          <div className="data-manager-import-result-header">
            <span>{error}</span>
            <button className="data-manager-import-close-btn" onClick={() => setError(null)}>
              Dismiss
            </button>
          </div>
        </div>
      )}

      {loading && <div className="dm-backup-empty">Loading backups...</div>}

      {!loading && backups.length === 0 && (
        <div className="dm-backup-empty">No backups available</div>
      )}

      {!loading && backups.length > 0 && (
        <div className="dm-backup-list">
          {backups.map((b) => (
            <div key={b.name} className="dm-backup-row">
              <div className="dm-backup-info">
                <span className="dm-backup-date">{formatDate(b.date)}</span>
                <span className="dm-backup-size">{formatSize(b.size)}</span>
              </div>
              <TactileButton
                variant="secondary"
                size="sm"
                onClick={() => setConfirmRestore(b)}
                disabled={restoring}
              >
                Restore
              </TactileButton>
            </div>
          ))}
        </div>
      )}

      {confirmRestore && (
        <div className="dm-backup-confirm">
          <p>
            This will replace all current data with the backup from{' '}
            <strong>{formatDate(confirmRestore.date)}</strong>. A safety backup of the current state
            will be created first. Continue?
          </p>
          <div className="dm-backup-confirm-actions">
            <TactileButton variant="secondary" onClick={() => setConfirmRestore(null)}>
              Cancel
            </TactileButton>
            <TactileButton
              variant="danger"
              onClick={() => handleRestore(confirmRestore)}
              loading={restoring}
            >
              Confirm Restore
            </TactileButton>
          </div>
        </div>
      )}
    </div>
  );
};
