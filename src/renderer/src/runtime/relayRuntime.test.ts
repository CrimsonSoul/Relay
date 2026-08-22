import { afterEach, describe, expect, it } from 'vitest';
import type { BridgeAPI } from '@shared/ipc';
import { ELECTRON_RUNTIME, WEB_RUNTIME } from '@shared/runtime';
import { getRelayRuntime, hasRelayCapability } from './relayRuntime';

describe('renderer runtime access', () => {
  const originalApi = globalThis.api;

  afterEach(() => {
    globalThis.api = originalApi;
  });

  it('uses the web descriptor before the browser bridge is installed', () => {
    globalThis.api = undefined;

    expect(getRelayRuntime()).toBe(WEB_RUNTIME);
    expect(hasRelayCapability('offlineMutations')).toBe(false);
  });

  it('reads the descriptor installed by the active bridge', () => {
    globalThis.api = { runtime: ELECTRON_RUNTIME } as BridgeAPI;

    expect(getRelayRuntime()).toBe(ELECTRON_RUNTIME);
    expect(hasRelayCapability('offlineMutations')).toBe(true);
  });

  it('treats an existing legacy preload as desktop during the transition', () => {
    globalThis.api = {} as BridgeAPI;

    expect(getRelayRuntime()).toBe(ELECTRON_RUNTIME);
  });
});
