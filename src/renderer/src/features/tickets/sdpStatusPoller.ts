import type { IpcResult } from '@shared/ipc';
import type { SdpAccountView } from '@shared/sdpAccount';

export type SdpStatusOutcome = { result: IpcResult<SdpAccountView> } | { error: Error };
/**
 * Called when a shared status check starts. Return a handler to receive that check's outcome,
 * or nothing to skip it (for example while the subscriber's own SDP action is in flight).
 */
export type SdpStatusSubscriber = () => ((outcome: SdpStatusOutcome) => void) | undefined;

const INTERVAL_MS = 5000;
const subscribers = new Set<SdpStatusSubscriber>();
let timer: ReturnType<typeof setInterval> | undefined;
let inFlight = false;
let queued = false;

/** One status request per interval for every SDP view, so client mode stays within the gateway rate limit. */
async function check(): Promise<void> {
  if (inFlight) {
    queued = true;
    return;
  }
  const invoke = globalThis.api?.sdpAccount;
  const handlers = [...subscribers].flatMap((subscriber) => subscriber() ?? []);
  if (!invoke || !handlers.length) return;
  inFlight = true;
  let outcome: SdpStatusOutcome;
  try {
    outcome = { result: await invoke({ action: 'status' }) };
  } catch (error) {
    outcome = { error: error instanceof Error ? error : new Error('SDP status check failed.') };
  } finally {
    inFlight = false;
  }
  for (const handler of handlers) handler(outcome);
  if (queued && subscribers.size) {
    queued = false;
    void check();
  }
}

export function subscribeSdpStatus(subscriber: SdpStatusSubscriber): () => void {
  subscribers.add(subscriber);
  timer ??= setInterval(() => void check(), INTERVAL_MS);
  void check();
  return () => {
    subscribers.delete(subscriber);
    if (subscribers.size || !timer) return;
    clearInterval(timer);
    timer = undefined;
    queued = false;
  };
}
