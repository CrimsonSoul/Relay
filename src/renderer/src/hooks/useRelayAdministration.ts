import { useCallback, useEffect, useRef, useState } from 'react';
import type { PublicPrivilegedCommandRequest } from '@shared/ipc';
import {
  normalizeRelayAdministrationSnapshot,
  type RelayAdministrationSnapshot,
} from '@shared/privilegedAccess';
import type { PrivilegedCommandResult } from '@shared/privilegedCommands';
import { usePrivilegedAccess } from '../contexts/PrivilegedAccessContext';
import { usePrivilegedCommands } from '../contexts/PrivilegedCommandContext';

const SAFE_ERRORS = {
  unauthorized: 'Owner or Administrator access is required.',
  locked: 'Privileged access is signed out. Sign in again.',
  offline: 'Administration is unavailable while Relay is offline.',
  'pairing-required': 'Pair this workstation before using administration.',
  'invalid-request': 'Relay rejected the administration request.',
  'insufficient-storage': 'Relay does not have enough storage to complete that action.',
  'duplicate-file-name': 'A protected document with that PDF filename already exists.',
  expired: 'The request expired. Try again.',
  replayed: 'Relay could not safely repeat that request.',
  conflict: 'The server state changed. Review the refreshed information and try again.',
  'rate-limited': 'Too many administration requests. Wait a moment and try again.',
  'server-error': 'Relay could not complete the administration request.',
} as const;

function safeMessage(result: Extract<PrivilegedCommandResult, { ok: false }>): string {
  return result.error === 'conflict' ? SAFE_ERRORS.conflict : SAFE_ERRORS[result.error];
}

export function useRelayAdministration() {
  const { session } = usePrivilegedAccess();
  const { submitCommand } = usePrivilegedCommands();
  const [snapshot, setSnapshot] = useState<RelayAdministrationSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canAdminister =
    session.state === 'active' && (session.role === 'owner' || session.role === 'admin');
  const administrationIdentity = canAdminister
    ? `${session.accountId}\u0000${session.deviceId ?? 'server-local'}`
    : null;
  const administrationIdentityRef = useRef(administrationIdentity);
  const refreshGenerationRef = useRef(0);
  administrationIdentityRef.current = administrationIdentity;
  const clearError = useCallback(() => setError(null), []);

  const refresh = useCallback(async (): Promise<PrivilegedCommandResult> => {
    if (!canAdminister) {
      setSnapshot(null);
      return { ok: false, error: session.state === 'offline' ? 'offline' : 'locked' };
    }
    const expectedIdentity = administrationIdentity;
    const generation = refreshGenerationRef.current + 1;
    refreshGenerationRef.current = generation;
    setLoading(true);
    setError(null);
    try {
      const result = await submitCommand({
        command: 'administration.snapshot.read',
        payload: {},
        expectedRevision: null,
      });
      if (!result.ok) {
        if (
          administrationIdentityRef.current === expectedIdentity &&
          refreshGenerationRef.current === generation
        ) {
          setError(safeMessage(result));
        }
        return result;
      }
      const normalized = normalizeRelayAdministrationSnapshot(result.value);
      if (!normalized) {
        if (
          administrationIdentityRef.current === expectedIdentity &&
          refreshGenerationRef.current === generation
        ) {
          setError('Relay returned an invalid administration snapshot.');
        }
        return { ok: false, requestId: result.requestId, error: 'server-error' };
      }
      if (
        administrationIdentityRef.current === expectedIdentity &&
        refreshGenerationRef.current === generation
      ) {
        setSnapshot(normalized);
      }
      return { ...result, value: normalized };
    } finally {
      if (
        administrationIdentityRef.current === expectedIdentity &&
        refreshGenerationRef.current === generation
      ) {
        setLoading(false);
      }
    }
  }, [administrationIdentity, canAdminister, session.state, submitCommand]);

  useEffect(() => {
    refreshGenerationRef.current += 1;
    if (!canAdminister) {
      setSnapshot(null);
      setError(null);
      setLoading(false);
      return;
    }
    void refresh();
  }, [administrationIdentity, canAdminister, refresh]);

  const execute = useCallback(
    async (request: PublicPrivilegedCommandRequest): Promise<PrivilegedCommandResult> => {
      if (!canAdminister) {
        const errorCode = session.state === 'offline' ? 'offline' : 'locked';
        setError(SAFE_ERRORS[errorCode]);
        return { ok: false, error: errorCode };
      }
      const expectedIdentity = administrationIdentity;
      setError(null);
      const result = await submitCommand(request);
      if (administrationIdentityRef.current !== expectedIdentity) return result;
      if (!result.ok) {
        const message = safeMessage(result);
        if (result.error === 'conflict' && result.refresh) await refresh();
        if (administrationIdentityRef.current === expectedIdentity) setError(message);
        return result;
      }
      await refresh();
      return result;
    },
    [administrationIdentity, canAdminister, refresh, session.state, submitCommand],
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
