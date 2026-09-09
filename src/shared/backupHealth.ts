export type BackupAttempt = {
  startedAt: string;
  completedAt?: string;
  outcome: 'started' | 'success' | 'failed';
};
export type BackupRestorePoint = {
  name: string;
  completedAt: string;
  fingerprint: string;
};
export type BackupHealth = {
  attempts: BackupAttempt[];
  lastSuccess?: BackupRestorePoint;
  lastVerified?: BackupRestorePoint;
  lastVerification?: { name: string; completedAt: string; outcome: 'success' | 'failed' };
  lastFailure?: string;
  retryDue?: string;
  failures: number;
  retentionAllowed: boolean;
  restorePointAgeMs: number | null;
  busy: boolean;
};
