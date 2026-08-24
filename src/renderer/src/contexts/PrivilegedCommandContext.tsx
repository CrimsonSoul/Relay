import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { PublicPrivilegedCommandRequest } from '@shared/ipc';
import type { PrivilegedCommandResult } from '@shared/privilegedCommands';

export type PrivilegedCommandContextValue = {
  busy: boolean;
  error: string | null;
  clearError: () => void;
  submitCommand: (input: PublicPrivilegedCommandRequest) => Promise<PrivilegedCommandResult>;
};

const PrivilegedCommandContext = createContext<PrivilegedCommandContextValue | null>(null);

type PrivilegedCommandState = {
  sessionEpoch: number;
  activeCommandCount: number;
  error: string | null;
};

const COMMAND_ERROR_MESSAGES = {
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
  'rate-limited': 'Too many attempts. Wait a few minutes and try again.',
  'server-error': 'Privileged access could not be completed.',
} as const;

export function PrivilegedCommandProvider({
  children,
  sessionEpoch,
}: Readonly<{ children: ReactNode; sessionEpoch: number }>) {
  const [commandState, setCommandState] = useState<PrivilegedCommandState>(() => ({
    sessionEpoch,
    activeCommandCount: 0,
    error: null,
  }));
  const sessionEpochRef = useRef(sessionEpoch);
  sessionEpochRef.current = sessionEpoch;
  const clearError = useCallback(() => {
    const currentEpoch = sessionEpochRef.current;
    setCommandState((current) =>
      current.sessionEpoch === currentEpoch
        ? { ...current, error: null }
        : { sessionEpoch: currentEpoch, activeCommandCount: 0, error: null },
    );
  }, []);
  const submitCommand = useCallback(
    async (input: PublicPrivilegedCommandRequest): Promise<PrivilegedCommandResult> => {
      const api = globalThis.api;
      if (!api) return { ok: false, error: 'offline' };
      const expectedEpoch = sessionEpochRef.current;
      setCommandState((current) => ({
        sessionEpoch: expectedEpoch,
        activeCommandCount:
          current.sessionEpoch === expectedEpoch ? current.activeCommandCount + 1 : 1,
        error: null,
      }));
      try {
        const result = await api.submitPrivilegedCommand(input);
        if (!result.ok && sessionEpochRef.current === expectedEpoch) {
          setCommandState((current) =>
            current.sessionEpoch === expectedEpoch
              ? {
                  ...current,
                  error: result.message || COMMAND_ERROR_MESSAGES[result.error],
                }
              : current,
          );
        }
        return result;
      } catch {
        if (sessionEpochRef.current === expectedEpoch) {
          setCommandState((current) =>
            current.sessionEpoch === expectedEpoch
              ? { ...current, error: COMMAND_ERROR_MESSAGES['server-error'] }
              : current,
          );
        }
        return { ok: false, error: 'server-error' };
      } finally {
        if (sessionEpochRef.current === expectedEpoch) {
          setCommandState((current) =>
            current.sessionEpoch === expectedEpoch
              ? {
                  ...current,
                  activeCommandCount: Math.max(0, current.activeCommandCount - 1),
                }
              : current,
          );
        }
      }
    },
    [],
  );

  const activeCommandCount =
    commandState.sessionEpoch === sessionEpoch ? commandState.activeCommandCount : 0;
  const error = commandState.sessionEpoch === sessionEpoch ? commandState.error : null;

  const value = useMemo<PrivilegedCommandContextValue>(
    () => ({ busy: activeCommandCount > 0, error, clearError, submitCommand }),
    [activeCommandCount, clearError, error, submitCommand],
  );

  return (
    <PrivilegedCommandContext.Provider value={value}>{children}</PrivilegedCommandContext.Provider>
  );
}

export function usePrivilegedCommands(): PrivilegedCommandContextValue {
  const context = useContext(PrivilegedCommandContext);
  if (!context) {
    throw new Error('usePrivilegedCommands must be used within PrivilegedCommandProvider');
  }
  return context;
}
