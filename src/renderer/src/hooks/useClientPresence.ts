import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PublicRelayConfig } from '@shared/ipc';
import {
  getPb,
  handleApiError,
  isOnline,
  onConnectionStateChange,
  onPocketBaseClientChange,
} from '../services/pocketbase';

export const CLIENT_PRESENCE_COLLECTION = 'client_presence';
export const CLIENT_PRESENCE_SESSION_STORAGE_KEY = 'relay:client-presence-session-id';
export const CLIENT_PRESENCE_TTL_MS = 45_000;
const CLIENT_PRESENCE_HEARTBEAT_MS = 15_000;
const CLIENT_PRESENCE_REFRESH_MS = 5_000;
let fallbackSessionCounter = 0;

export type ClientPresenceRecord = {
  id: string;
  sessionId: string;
  hostname: string;
  mode: 'client';
  lastSeen: string;
  created?: string;
  updated?: string;
};

export type ClientPresenceState = {
  count: number;
  hostnames: string[];
  clients: ClientPresenceRecord[];
  loading: boolean;
};

function isNotFoundError(error: unknown): boolean {
  return (
    !!error &&
    typeof error === 'object' &&
    'status' in error &&
    (error as { status?: unknown }).status === 404
  );
}

function getRecordTime(record: ClientPresenceRecord): number {
  const time = new Date(record.lastSeen).getTime();
  return Number.isFinite(time) ? time : 0;
}

function sortPresence(a: ClientPresenceRecord, b: ClientPresenceRecord): number {
  const host = a.hostname.localeCompare(b.hostname);
  if (host !== 0) return host;
  return b.sessionId.localeCompare(a.sessionId);
}

function sanitizeHostname(hostname: string | null | undefined): string {
  const trimmed = hostname?.trim();
  return trimmed || 'unknown-client';
}

function createSessionId(): string {
  const randomId = globalThis.crypto?.randomUUID?.();
  if (randomId) return randomId;

  fallbackSessionCounter += 1;
  return `client-${Date.now()}-${fallbackSessionCounter}`;
}

export function getClientPresenceSessionId(): string {
  try {
    const existing = globalThis.sessionStorage?.getItem(CLIENT_PRESENCE_SESSION_STORAGE_KEY);
    if (existing) return existing;

    const next = createSessionId();
    globalThis.sessionStorage?.setItem(CLIENT_PRESENCE_SESSION_STORAGE_KEY, next);
    return next;
  } catch {
    return createSessionId();
  }
}

export function getActiveClientPresence(
  records: ClientPresenceRecord[],
  nowMs = Date.now(),
): ClientPresenceRecord[] {
  const cutoff = nowMs - CLIENT_PRESENCE_TTL_MS;
  return [...records]
    .filter((record) => record.mode === 'client' && getRecordTime(record) >= cutoff)
    .sort(sortPresence);
}

function upsertPresenceRecord(
  records: ClientPresenceRecord[],
  record: ClientPresenceRecord,
): ClientPresenceRecord[] {
  const existingIndex = records.findIndex((candidate) => candidate.id === record.id);
  if (existingIndex === -1) return [...records, record];

  const next = [...records];
  next[existingIndex] = record;
  return next;
}

function applyPresenceEvent(
  records: ClientPresenceRecord[],
  action: string,
  record: ClientPresenceRecord,
): ClientPresenceRecord[] {
  if (action === 'delete') {
    return records.filter((candidate) => candidate.id !== record.id);
  }

  if (action === 'create' || action === 'update') {
    return upsertPresenceRecord(records, record);
  }

  return records;
}

async function getClientHostname(): Promise<string> {
  try {
    return sanitizeHostname(await globalThis.api?.getClientHostname?.());
  } catch {
    return 'unknown-client';
  }
}

async function fetchPresenceRecords(): Promise<ClientPresenceRecord[]> {
  return getPb().collection(CLIENT_PRESENCE_COLLECTION).getFullList<ClientPresenceRecord>({
    sort: 'hostname,-lastSeen',
    requestKey: null,
  });
}

async function writeClientHeartbeat(sessionId: string, hostname: string): Promise<void> {
  const payload = {
    sessionId,
    hostname,
    mode: 'client',
    lastSeen: new Date().toISOString(),
  };
  const collection = getPb().collection(CLIENT_PRESENCE_COLLECTION);

  try {
    const existing = await collection.getFirstListItem<ClientPresenceRecord>(
      `sessionId="${sessionId}"`,
      { requestKey: null },
    );
    await collection.update(existing.id, payload);
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
    await collection.create<ClientPresenceRecord>(payload);
  }
}

export function useClientPresence(
  relayConfig: PublicRelayConfig | null | undefined,
  onClientConnected?: (hostname: string) => void,
  options: { enabled?: boolean } = {},
): ClientPresenceState {
  const enabled = options.enabled !== false;
  const [records, setRecords] = useState<ClientPresenceRecord[]>([]);
  const [loading, setLoading] = useState(enabled && isOnline());
  const [snapshotReady, setSnapshotReady] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const recordsRef = useRef<ClientPresenceRecord[]>([]);
  const initializedRef = useRef(false);
  const previousActiveSessionsRef = useRef<Set<string>>(new Set());
  const onClientConnectedRef = useRef(onClientConnected);
  const ownSessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    onClientConnectedRef.current = onClientConnected;
  }, [onClientConnected]);

  const commitRecords = useCallback((next: ClientPresenceRecord[]) => {
    recordsRef.current = next;
    setRecords(next);
  }, []);

  const loadPresence = useCallback(async () => {
    if (!enabled || !isOnline()) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      commitRecords(await fetchPresenceRecords());
    } catch (error) {
      handleApiError(error);
      commitRecords([]);
    } finally {
      setLoading(false);
      setSnapshotReady(true);
    }
  }, [commitRecords, enabled]);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      setSnapshotReady(false);
      initializedRef.current = false;
      previousActiveSessionsRef.current = new Set();
      commitRecords([]);
      return;
    }

    let cancelled = false;
    let unsubscribeRealtime: (() => void | Promise<void>) | null = null;

    async function subscribe(): Promise<void> {
      if (!isOnline()) return;
      const unsubscribe = await getPb()
        .collection(CLIENT_PRESENCE_COLLECTION)
        .subscribe('*', (event) => {
          if (cancelled) return;
          const next = applyPresenceEvent(
            recordsRef.current,
            event.action,
            event.record as ClientPresenceRecord,
          );
          commitRecords(next);
        });

      if (cancelled) {
        void unsubscribe();
        return;
      }

      unsubscribeRealtime = unsubscribe;
    }

    function unsubscribe(): void {
      void unsubscribeRealtime?.();
      unsubscribeRealtime = null;
    }

    void loadPresence();
    if (isOnline()) {
      void subscribe().catch(handleApiError);
    }

    const unsubscribeConnection = onConnectionStateChange((state) => {
      if (state === 'online') {
        void loadPresence();
        unsubscribe();
        void subscribe().catch(handleApiError);
      } else {
        unsubscribe();
        setLoading(false);
        setSnapshotReady(false);
        initializedRef.current = false;
        previousActiveSessionsRef.current = new Set();
      }
    });

    const unsubscribeClientChange = onPocketBaseClientChange(() => {
      void loadPresence();
      unsubscribe();
      void subscribe().catch(handleApiError);
    });

    return () => {
      cancelled = true;
      unsubscribe();
      unsubscribeConnection();
      unsubscribeClientChange();
    };
  }, [commitRecords, enabled, loadPresence]);

  useEffect(() => {
    if (!enabled || relayConfig?.mode !== 'client') return;

    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | null = null;
    const sessionId = getClientPresenceSessionId();
    ownSessionIdRef.current = sessionId;

    async function heartbeat(): Promise<void> {
      if (cancelled || !isOnline()) return;
      try {
        await writeClientHeartbeat(sessionId, await getClientHostname());
      } catch (error) {
        handleApiError(error);
      }
    }

    void heartbeat();
    interval = setInterval(() => void heartbeat(), CLIENT_PRESENCE_HEARTBEAT_MS);

    const unsubscribeConnection = onConnectionStateChange((state) => {
      if (state === 'online') void heartbeat();
    });

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
      unsubscribeConnection();
    };
  }, [enabled, relayConfig?.mode]);

  useEffect(() => {
    const interval = setInterval(() => setNowMs(Date.now()), CLIENT_PRESENCE_REFRESH_MS);
    return () => clearInterval(interval);
  }, []);

  const activeClients = useMemo(() => getActiveClientPresence(records, nowMs), [records, nowMs]);

  useEffect(() => {
    if (!snapshotReady) return;

    const activeSessions = new Set(activeClients.map((client) => client.sessionId));

    if (!initializedRef.current) {
      initializedRef.current = true;
      previousActiveSessionsRef.current = activeSessions;
      return;
    }

    const previousSessions = previousActiveSessionsRef.current;
    for (const client of activeClients) {
      if (client.sessionId === ownSessionIdRef.current) continue;
      if (!previousSessions.has(client.sessionId)) {
        onClientConnectedRef.current?.(client.hostname);
      }
    }

    previousActiveSessionsRef.current = activeSessions;
  }, [activeClients, snapshotReady]);

  const hostnames = useMemo(
    () => [...new Set(activeClients.map((client) => client.hostname))],
    [activeClients],
  );

  return {
    count: activeClients.length,
    hostnames,
    clients: activeClients,
    loading,
  };
}
