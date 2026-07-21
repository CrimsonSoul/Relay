import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type {
  PrivilegedPairingCompletionInput,
  PrivilegedReauthenticationProof,
  PublicPrivilegedCommandRequest,
} from '@shared/ipc';
import {
  normalizePrivilegedSessionView,
  type PrivilegedPairingChallengeView,
  type PrivilegedSessionView,
} from '@shared/privilegedAccess';
import type { PrivilegedCommandResult } from '@shared/privilegedCommands';

const SIGNED_OUT_SESSION: PrivilegedSessionView = {
  state: 'signed-out',
  accountId: null,
  username: null,
  displayName: null,
  role: null,
  capabilities: [],
  deviceId: null,
  expiresAt: null,
};

const OFFLINE_SESSION: PrivilegedSessionView = {
  ...SIGNED_OUT_SESSION,
  state: 'offline',
};

type BusyAction = 'login' | 'logout' | 'reauthenticate' | 'pair' | 'challenge' | 'command';

export type PrivilegedAccessContextValue = {
  session: PrivilegedSessionView;
  loading: boolean;
  busy: BusyAction | null;
  error: string | null;
  pairingChallenge: PrivilegedPairingChallengeView | null;
  clearError: () => void;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  reauthenticate: (password: string) => Promise<PrivilegedReauthenticationProof | null>;
  createPairingChallenge: (
    targetAccountId: string,
  ) => Promise<PrivilegedPairingChallengeView | null>;
  completePairing: (input: PrivilegedPairingCompletionInput) => Promise<boolean>;
  submitCommand: (input: PublicPrivilegedCommandRequest) => Promise<PrivilegedCommandResult>;
};

const PrivilegedAccessContext = createContext<PrivilegedAccessContextValue | null>(null);

const ERROR_MESSAGES = {
  'invalid-input': 'Check the information and try again.',
  'invalid-credentials': 'The username or password was not accepted.',
  unauthorized: 'This account is not authorized for that action.',
  locked: 'Privileged access is signed out. Sign in again.',
  offline: 'Privileged access is unavailable offline.',
  'pairing-required': 'This workstation must be paired before privileged access can continue.',
  'invalid-request': 'Relay rejected the protected request.',
  'insufficient-storage': 'Relay does not have enough storage to complete that action.',
  'duplicate-file-name':
    'A published document with this PDF filename already exists. Replace it or rename the PDF.',
  expired: 'The protected request expired. Try again.',
  replayed: 'Relay could not safely repeat that protected request.',
  conflict: 'The server state changed. Refresh and try again.',
  'server-error': 'Privileged access could not be completed.',
} as const;

const normalizeOr = (value: unknown, fallback: PrivilegedSessionView) =>
  normalizePrivilegedSessionView(value) ?? fallback;

export function PrivilegedAccessProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [session, setSession] = useState<PrivilegedSessionView>(SIGNED_OUT_SESSION);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<BusyAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pairingChallenge, setPairingChallenge] = useState<PrivilegedPairingChallengeView | null>(
    null,
  );

  const clearError = useCallback(() => setError(null), []);
  const showFailure = useCallback((code: keyof typeof ERROR_MESSAGES) => {
    setError(ERROR_MESSAGES[code]);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const api = globalThis.api;
    if (!api) {
      setSession(OFFLINE_SESSION);
      setLoading(false);
      return;
    }

    const unsubscribe = api.onPrivilegedSessionChanged((nextView) => {
      if (cancelled) return;
      const normalized = normalizePrivilegedSessionView(nextView);
      if (normalized) setSession(normalized);
    });

    void api
      .getPrivilegedSession()
      .then((nextView) => {
        if (!cancelled) setSession(normalizeOr(nextView, SIGNED_OUT_SESSION));
      })
      .catch(() => {
        if (!cancelled) setSession(OFFLINE_SESSION);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const login = useCallback(
    async (username: string, password: string) => {
      const api = globalThis.api;
      if (!api) {
        setSession(OFFLINE_SESSION);
        showFailure('offline');
        return false;
      }

      setBusy('login');
      setError(null);
      try {
        const result = await api.loginPrivileged({
          username,
          password,
        });
        if (!result.ok) {
          showFailure(result.error);
          return false;
        }
        setSession(normalizeOr(result.value, SIGNED_OUT_SESSION));
        return true;
      } catch {
        showFailure('server-error');
        return false;
      } finally {
        setBusy(null);
      }
    },
    [showFailure],
  );

  const logout = useCallback(async () => {
    setBusy('logout');
    setError(null);
    setPairingChallenge(null);
    try {
      const nextView = await globalThis.api?.logoutPrivileged();
      setSession(normalizeOr(nextView, SIGNED_OUT_SESSION));
    } catch {
      setSession(SIGNED_OUT_SESSION);
    } finally {
      setBusy(null);
    }
  }, []);

  const reauthenticate = useCallback(
    async (password: string) => {
      const api = globalThis.api;
      if (!api) {
        showFailure('offline');
        return null;
      }
      setBusy('reauthenticate');
      setError(null);
      try {
        const result = await api.reauthenticatePrivileged({ password });
        if (!result.ok) {
          showFailure(result.error);
          return null;
        }
        return result.value;
      } catch {
        showFailure('server-error');
        return null;
      } finally {
        setBusy(null);
      }
    },
    [showFailure],
  );

  const createPairingChallenge = useCallback(
    async (targetAccountId: string) => {
      const api = globalThis.api;
      if (!api) {
        showFailure('offline');
        return null;
      }
      setBusy('challenge');
      setError(null);
      try {
        const result = await api.createPrivilegedPairingChallenge(targetAccountId);
        if (!result.ok) {
          showFailure(result.error);
          return null;
        }
        setPairingChallenge(result.value);
        return result.value;
      } catch {
        showFailure('server-error');
        return null;
      } finally {
        setBusy(null);
      }
    },
    [showFailure],
  );

  const completePairing = useCallback(
    async (input: PrivilegedPairingCompletionInput) => {
      const api = globalThis.api;
      if (!api) {
        showFailure('offline');
        return false;
      }
      setBusy('pair');
      setError(null);
      try {
        const result = await api.completePrivilegedPairing(input);
        if (!result.ok) {
          showFailure(result.error);
          return false;
        }
        const nextView = await api.getPrivilegedSession();
        setSession(normalizeOr(nextView, session));
        return true;
      } catch {
        showFailure('server-error');
        return false;
      } finally {
        setBusy(null);
      }
    },
    [session, showFailure],
  );

  const submitCommand = useCallback(
    async (input: PublicPrivilegedCommandRequest): Promise<PrivilegedCommandResult> => {
      const api = globalThis.api;
      if (!api) return { ok: false, error: 'offline' };
      setBusy('command');
      setError(null);
      try {
        const result = await api.submitPrivilegedCommand(input);
        if (!result.ok) setError(result.message || ERROR_MESSAGES[result.error]);
        return result;
      } catch {
        showFailure('server-error');
        return { ok: false, error: 'server-error' };
      } finally {
        setBusy(null);
      }
    },
    [showFailure],
  );

  const value = useMemo<PrivilegedAccessContextValue>(
    () => ({
      session,
      loading,
      busy,
      error,
      pairingChallenge,
      clearError,
      login,
      logout,
      reauthenticate,
      createPairingChallenge,
      completePairing,
      submitCommand,
    }),
    [
      busy,
      clearError,
      completePairing,
      createPairingChallenge,
      error,
      loading,
      login,
      logout,
      pairingChallenge,
      reauthenticate,
      session,
      submitCommand,
    ],
  );

  return (
    <PrivilegedAccessContext.Provider value={value}>{children}</PrivilegedAccessContext.Provider>
  );
}

export function usePrivilegedAccess(): PrivilegedAccessContextValue {
  const context = useContext(PrivilegedAccessContext);
  if (!context) throw new Error('usePrivilegedAccess must be used within PrivilegedAccessProvider');
  return context;
}
