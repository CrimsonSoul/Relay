import { useCallback, useEffect, useState } from 'react';
import type { PublicPrivilegedCommandRequest } from '@shared/ipc';
import {
  normalizeRelayAdministrationSnapshot,
  type RelayAdministrationSnapshot,
} from '@shared/privilegedAccess';
import type { PrivilegedCommandResult } from '@shared/privilegedCommands';
import { usePrivilegedAccess } from '../contexts/PrivilegedAccessContext';

const SAFE_ERRORS = {
  unauthorized: 'Owner or Administrator access is required.',
  locked: 'Privileged access is signed out. Sign in again.',
  offline: 'Administration is unavailable while Relay is offline.',
  'pairing-required': 'Pair this workstation before using administration.',
  'invalid-request': 'Relay rejected the administration request.',
  'insufficient-storage': 'Relay does not have enough storage to complete that action.',
  expired: 'The request expired. Try again.',
  replayed: 'Relay could not safely repeat that request.',
  conflict: 'The server state changed. Review the refreshed information and try again.',
  'server-error': 'Relay could not complete the administration request.',
} as const;

function safeMessage(result: Extract<PrivilegedCommandResult, { ok: false }>): string {
  return result.error === 'conflict' ? SAFE_ERRORS.conflict : SAFE_ERRORS[result.error];
}

export function useRelayAdministration() {
  const { session, submitCommand } = usePrivilegedAccess();
  const [snapshot, setSnapshot] = useState<RelayAdministrationSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canAdminister =
    session.state === 'active' && (session.role === 'owner' || session.role === 'admin');
  const clearError = useCallback(() => setError(null), []);

  const refresh = useCallback(async (): Promise<PrivilegedCommandResult> => {
    if (!canAdminister) {
      setSnapshot(null);
      return { ok: false, error: session.state === 'offline' ? 'offline' : 'locked' };
    }
    setLoading(true);
    setError(null);
    try {
      const result = await submitCommand({
        command: 'administration.snapshot.read',
        payload: {},
        expectedRevision: null,
      });
      if (!result.ok) {
        setError(safeMessage(result));
        return result;
      }
      const normalized = normalizeRelayAdministrationSnapshot(result.value);
      if (!normalized) {
        setError('Relay returned an invalid administration snapshot.');
        return { ok: false, requestId: result.requestId, error: 'server-error' };
      }
      setSnapshot(normalized);
      return { ...result, value: normalized };
    } finally {
      setLoading(false);
    }
  }, [canAdminister, session.state, submitCommand]);

  useEffect(() => {
    if (!canAdminister) {
      setSnapshot(null);
      setError(null);
      setLoading(false);
      return;
    }
    void refresh();
  }, [canAdminister, refresh, session.accountId]);

  const execute = useCallback(
    async (request: PublicPrivilegedCommandRequest): Promise<PrivilegedCommandResult> => {
      if (!canAdminister) {
        const errorCode = session.state === 'offline' ? 'offline' : 'locked';
        setError(SAFE_ERRORS[errorCode]);
        return { ok: false, error: errorCode };
      }
      setError(null);
      const result = await submitCommand(request);
      if (!result.ok) {
        const message = safeMessage(result);
        if (result.error === 'conflict' && result.refresh) await refresh();
        setError(message);
        return result;
      }
      await refresh();
      return result;
    },
    [canAdminister, refresh, session.state, submitCommand],
  );

  return {
    snapshot,
    loading,
    error,
    canAdminister,
    refresh,
    execute,
    clearError,
  };
}
