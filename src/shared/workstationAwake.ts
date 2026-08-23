export type WorkstationAwakeError = 'display-blocker-failed' | 'input-pulse-failed';

export type WorkstationAwakeState = {
  supported: boolean;
  enabled: boolean;
  status: 'active' | 'degraded' | 'disabled' | 'unsupported';
  error?: WorkstationAwakeError;
};
