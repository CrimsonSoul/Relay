import { useCallback, useRef } from 'react';
import type { BridgeHistoryEntry } from '@shared/ipc';
import { createBridgeHistoryFingerprint } from '../tabs/assembler/bridgeHandoff';

type AddHistory = (entry: Omit<BridgeHistoryEntry, 'id' | 'timestamp'>) => Promise<unknown>;

type HandoffSnapshot = {
  contacts: string[];
  groups: string[];
};

export function useBridgeHandoffHistory(addHistory: AddHistory) {
  const lastSavedFingerprintRef = useRef<string | null>(null);
  const inFlightRef = useRef<{
    fingerprint: string;
    promise: Promise<'saved'>;
  } | null>(null);

  const saveSuccessfulHandoff = useCallback(
    (snapshot: HandoffSnapshot): Promise<'saved' | 'duplicate'> => {
      const fingerprint = createBridgeHistoryFingerprint(snapshot.contacts, snapshot.groups);
      if (lastSavedFingerprintRef.current === fingerprint) return Promise.resolve('duplicate');
      if (inFlightRef.current?.fingerprint === fingerprint) return inFlightRef.current.promise;

      const promise = addHistory({
        note: '',
        groups: snapshot.groups,
        contacts: snapshot.contacts,
        recipientCount: snapshot.contacts.length,
      })
        .then((result) => {
          if (result === null) throw new Error('History write failed');
          lastSavedFingerprintRef.current = fingerprint;
          return 'saved' as const;
        })
        .finally(() => {
          if (inFlightRef.current?.fingerprint === fingerprint) inFlightRef.current = null;
        });
      inFlightRef.current = { fingerprint, promise };
      return promise;
    },
    [addHistory],
  );

  const forgetSuccessfulHandoff = useCallback((snapshot?: HandoffSnapshot) => {
    if (!snapshot) {
      lastSavedFingerprintRef.current = null;
      return;
    }

    const fingerprint = createBridgeHistoryFingerprint(snapshot.contacts, snapshot.groups);
    if (lastSavedFingerprintRef.current === fingerprint) {
      lastSavedFingerprintRef.current = null;
    }
  }, []);

  return { saveSuccessfulHandoff, forgetSuccessfulHandoff };
}
