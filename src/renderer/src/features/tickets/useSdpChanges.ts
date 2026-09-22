import type { BridgeAPI } from '@shared/ipc';
import { useEffect, useState } from 'react';
import type { SdpChangeRecord } from '@shared/sdpChanges';
import { SDP_NOTIFICATIONS_RESET } from './SdpAlerts';

type ChangeReadState = {
  changes: SdpChangeRecord[];
  message: string;
  partial: boolean;
  checkedAt?: number;
  session?: number;
};
const empty: ChangeReadState = {
  changes: [],
  message: 'Checking SDP change controls…',
  partial: false,
};
async function readPages(
  invoke: NonNullable<BridgeAPI['sdpAccount']>,
  problemStart: number,
  isActive: () => boolean,
) {
  const changes = new Map<string, SdpChangeRecord>();
  let partial = false;
  let incompleteDetails = false;
  for (let page = 0; page < 10; page++) {
    const result = await invoke({ action: 'readChanges', problemStart, page });
    if (!isActive()) return null;
    if (!result.success || !result.data?.changesPage)
      throw new Error(
        result.data?.message ||
          'Changes could not be read. Check your connection and Changes read permission; reconnect your work account if needed.',
      );
    const data = result.data.changesPage;
    data.changes.forEach((change) => changes.set(change.id, change));
    partial = data.hasMore;
    incompleteDetails ||= data.detailsComplete === false;
    if (!partial) break;
  }
  return { changes: [...changes.values()], partial: partial || incompleteDetails };
}
/** No disk cache or shared projections; check sign-in every five seconds and changes every minute. */
export function useSdpChanges(problemStart: number) {
  const [state, setState] = useState<ChangeReadState>(empty);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const reset = () => {
      setState(empty);
      setRevision((value) => value + 1);
    };
    window.addEventListener(SDP_NOTIFICATIONS_RESET, reset);
    return () => window.removeEventListener(SDP_NOTIFICATIONS_RESET, reset);
  }, []);
  useEffect(() => {
    let active = true;
    let pending = false;
    let lastRead = 0;
    let session: number | undefined;
    let failures = 0;
    setState(empty);
    const invoke = globalThis.api?.sdpAccount;
    if (!invoke) {
      setState({
        ...empty,
        message: 'Connect your SDP work account in Relay desktop to find related changes.',
      });
      return;
    }
    const poll = async () => {
      if (pending) return;
      pending = true;
      try {
        const status = await invoke({ action: 'status' });
        if (!active) return;
        if (!status.success || status.data?.status !== 'connected') {
          lastRead = 0;
          session = undefined;
          setState({
            ...empty,
            message: 'Connect your SDP work account in Tickets to find related changes.',
          });
          return;
        }
        if (session !== status.data.expiresAt) {
          session = status.data.expiresAt;
          lastRead = 0;
          failures = 0;
          setState(empty);
        }
        if (Date.now() - lastRead < Math.min(300000, 60000 * 2 ** failures)) return;
        lastRead = Date.now();
        const records = await readPages(invoke, problemStart, () => active);
        if (!records) return;
        // Recheck ownership/expiry after pagination before exposing any records.
        const current = await invoke({ action: 'status' });
        if (!active) return;
        if (
          !current.success ||
          current.data?.status !== 'connected' ||
          current.data.expiresAt !== session
        ) {
          lastRead = 0;
          setState(empty);
          return;
        }
        failures = 0;
        setState({
          changes: records.changes,
          message: '',
          partial: records.partial,
          checkedAt: Date.now(),
          session,
        });
      } catch (error) {
        if (active) {
          failures = Math.min(3, failures + 1);
          setState({
            ...empty,
            message: error instanceof Error ? error.message : 'Changes could not be read.',
          });
        }
      } finally {
        pending = false;
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [problemStart, revision]);
  return { ...state, refresh: () => setRevision((value) => value + 1) };
}
