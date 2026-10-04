import { afterEach, expect, it, vi } from 'vitest';
import type { BridgeAPI } from '@shared/ipc';
import { subscribeSdpStatus, type SdpStatusOutcome } from './sdpStatusPoller';

const original = globalThis.api;
afterEach(() => {
  globalThis.api = original;
  vi.useRealTimers();
});

it('sends one status request per interval for all views and skips busy subscribers', async () => {
  vi.useFakeTimers();
  const invoke = vi.fn().mockResolvedValue({ success: true, data: { status: 'connected' } });
  globalThis.api = { sdpAccount: invoke } as unknown as BridgeAPI;
  const seen: SdpStatusOutcome[] = [];
  let busy = false;
  const stopA = subscribeSdpStatus(() => (outcome) => seen.push(outcome));
  const stopB = subscribeSdpStatus(() => (busy ? undefined : (outcome) => seen.push(outcome)));
  const stopC = subscribeSdpStatus(() => (outcome) => seen.push(outcome));
  await vi.advanceTimersByTimeAsync(0);
  invoke.mockClear();
  seen.length = 0;
  await vi.advanceTimersByTimeAsync(5000);
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(seen).toHaveLength(3);
  busy = true;
  await vi.advanceTimersByTimeAsync(5000);
  expect(invoke).toHaveBeenCalledTimes(2);
  expect(seen).toHaveLength(5);
  stopA();
  stopB();
  stopC();
  await vi.advanceTimersByTimeAsync(15000);
  expect(invoke).toHaveBeenCalledTimes(2);
});
