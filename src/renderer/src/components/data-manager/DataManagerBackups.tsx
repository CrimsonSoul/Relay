import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { BackupEntry } from '@shared/ipc';
import type { BackupHealth } from '@shared/backupHealth';
import { TactileButton } from '../TactileButton';
import { ConfirmModal } from '../ConfirmModal';
import { useMounted } from '../../hooks/useMounted';

declare const api: {
  getBackupHealth?: () => Promise<{ success: boolean; data?: BackupHealth; error?: string }>;
  verifyBackup?: (name: string) => Promise<{ success: boolean; error?: string }>;
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
  const [health, setHealth] = useState<BackupHealth | null>(null);
  const [verifying, setVerifying] = useState<string | null>(null);
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState<BackupEntry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mounted = useMounted();

  const request = useRef<Promise<void> | null>(null);
  const refresh = useCallback((): Promise<void> => {
    if (request.current) return request.current;
    const pending = (async () => {
      try {
        const [list, status] = await Promise.all([api.listBackups(), api.getBackupHealth?.()]);
        if (!mounted.current) return;
        setBackups(list);
        if (status?.success && status.data) setHealth(status.data);
      } catch {
        if (mounted.current) setError((current) => current ?? 'Failed to load backups');
      } finally {
        if (mounted.current) setLoading(false);
      }
    })();
    request.current = pending;
    void pending.finally(() => {
      if (request.current === pending) request.current = null;
    });
    return pending;
  }, [mounted]);

  // Manual completion needs a response requested after the action, not an
  // older background request that happened to be in flight at completion.
  const loadBackups = useCallback(async () => {
    if (request.current) await request.current;
    if (mounted.current) await refresh();
  }, [mounted, refresh]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async (): Promise<void> => {
      await refresh();
      if (!cancelled)
        timer = setTimeout(() => {
          void poll();
        }, 5000);
    };
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [refresh]);

  const handleCreate = async () => {
    setError(null);
    setCreating(true);
    try {
      const result = await api.createBackup();
      if (mounted.current) {
        await loadBackups();
        if (!result.success) setError(result.error ?? 'Failed to create backup');
      }
    } catch {
      if (mounted.current) setError('Failed to create backup');
    } finally {
      if (mounted.current) setCreating(false);
    }
  };

  const handleVerify = async (name: string) => {
    if (!api.verifyBackup) return;
    setVerifying(name);
    setError(null);
    try {
      const result = await api.verifyBackup(name);
      if (mounted.current) {
        await loadBackups();
        if (!result.success) setError(result.error ?? 'Disposable verification failed');
      }
    } catch {
      if (mounted.current) setError('Could not verify backup. Try again.');
    } finally {
      if (mounted.current) setVerifying(null);
    }
  };

  // Deliberately leaves confirmRestore set: ConfirmModal closes itself once
  // this promise settles, so the dialog stays up — with a loading confirm
  // button — for the whole restore instead of vanishing on the first click.
  const handleRestore = async (backup: BackupEntry) => {
    setRestoring(true);
    try {
      const result = await api.restoreBackup(backup.name);
      if (result.success) {
        globalThis.location.reload();
      } else if (mounted.current) {
        setError(result.error ?? 'Restore failed');
        setRestoring(false);
      }
    } catch {
      if (mounted.current) {
        setError('Restore failed unexpectedly');
        setRestoring(false);
      }
    }
  };

  const verificationOutcome = health?.lastVerification?.outcome === 'success' ? 'Passed' : 'Failed';
  return (
    <div className="data-manager-section">
      <div className="data-manager-section-heading">Backups</div>
      <div className="data-manager-section-description">
        Daily backups are checked in a disposable folder before history cleanup. Verification checks
        database and file readability; it does not replace testing a full server restore.
      </div>

      {health && (
        <div className="data-manager-section-description" role="status" aria-live="polite">
          <strong>{health.retentionAllowed ? 'Retention protected' : 'Retention paused'}</strong>
          <div>
            Latest completed backup:{' '}
            {health.restorePointAgeMs === null
              ? 'No confirmed archive'
              : `${Math.floor(health.restorePointAgeMs / 3_600_000)} hours old`}
          </div>
          <div>
            Last disposable verification:{' '}
            {health.lastVerification
              ? `${verificationOutcome} — ${formatDate(health.lastVerification.completedAt)}`
              : 'Not yet checked'}
          </div>
          {health.lastVerified && (
            <div>
              Last verified backup: {formatDate(health.lastVerified.completedAt)} (
              {Math.floor((Date.now() - Date.parse(health.lastVerified.completedAt)) / 3_600_000)}{' '}
              hours since verification)
            </div>
          )}
          {health.lastFailure && <div>{health.lastFailure}</div>}
          {health.retryDue && <div>Next backup attempt: {formatDate(health.retryDue)}</div>}
          {verifying && <div>Verifying backup in a disposable folder…</div>}
        </div>
      )}

      <TactileButton
        variant="primary"
        onClick={handleCreate}
        disabled={creating || restoring || verifying !== null || health?.busy}
        loading={creating}
        className="dm-big-btn"
      >
        {health?.lastFailure ? 'Retry backup' : 'Create Backup'}
      </TactileButton>

      {error && (
        <div className="data-manager-import-result data-manager-import-result--error" role="alert">
          <div className="data-manager-import-result-header">
            <span>{error}</span>
            <button
              type="button"
              className="data-manager-import-close-btn"
              onClick={() => setError(null)}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {loading && <div className="dm-backup-empty">Loading backups...</div>}

      {!loading && backups.length === 0 && (
        <div className="dm-backup-empty">
          No backups available. Create a backup to establish a recovery point.
        </div>
      )}

      {!loading && backups.length > 0 && (
        <div className="dm-backup-list">
          {backups.map((b) => (
            <div key={b.name} className="dm-backup-row">
              <div className="dm-backup-info">
                <span className="dm-backup-date">{formatDate(b.date)}</span>
                <span className="dm-backup-size">{formatSize(b.size)}</span>
              </div>
              {api.verifyBackup && (
                <TactileButton
                  variant="secondary"
                  size="sm"
                  onClick={() => handleVerify(b.name)}
                  disabled={creating || restoring || verifying !== null || health?.busy}
                  loading={verifying === b.name}
                  aria-label={`Verify backup ${b.name}`}
                >
                  Verify backup
                </TactileButton>
              )}
              <TactileButton
                variant="secondary"
                size="sm"
                onClick={() => setConfirmRestore(b)}
                disabled={creating || restoring || verifying !== null || health?.busy}
              >
                Restore
              </TactileButton>
            </div>
          ))}
        </div>
      )}

      <ConfirmModal
        isOpen={confirmRestore !== null}
        onClose={() => setConfirmRestore(null)}
        onConfirm={() => (confirmRestore ? handleRestore(confirmRestore) : undefined)}
        title="Restore Backup"
        message={
          confirmRestore
            ? `This will replace all current data with the backup from ${formatDate(
                confirmRestore.date,
              )}. A safety backup of the current state will be created first. Continue?`
            : ''
        }
        confirmLabel={restoring ? 'Restoring...' : 'Confirm Restore'}
        isDanger
      />
    </div>
  );
};
