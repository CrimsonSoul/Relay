export type RelayRecoveryBuildStatus =
  'ready' | 'runtime-missing' | 'snapshot-missing' | 'data-incompatible';

export type RelayRecoveryBuildView = {
  buildId: string;
  version: string;
  releaseTag: string;
  installedAt: string;
  status: RelayRecoveryBuildStatus;
  rollbackAvailable: boolean;
  repairAvailable: boolean;
  githubFallbackAvailable: boolean;
};

export type RelayRecoveryState = {
  supported: boolean;
  status: 'ready' | 'unavailable' | 'busy';
  mode: 'server' | 'client' | 'unconfigured';
  currentBuildId: string | null;
  currentVersion: string | null;
  runningBuildId: string | null;
  runningVersion: string | null;
  fallbackActive: boolean;
  retainedBuilds: RelayRecoveryBuildView[];
};

export type RelayRecoveryRollbackInput = {
  targetBuildId: string;
  password: string;
};

export type RelayRecoveryRepairInput = {
  targetBuildId: string;
  password: string;
};
