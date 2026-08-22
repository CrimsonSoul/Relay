import { describe, expect, it } from 'vitest';
import { ELECTRON_RUNTIME, WEB_RUNTIME, type RelayRuntimeCapabilities } from './runtime';

describe('Relay runtime descriptors', () => {
  it('keeps every existing desktop capability enabled', () => {
    expect(ELECTRON_RUNTIME).toEqual({
      kind: 'electron',
      label: 'Desktop',
      capabilities: {
        connectionConfiguration: true,
        pocketBaseRecovery: true,
        offlineCache: true,
        offlineMutations: true,
        nativeWindowControls: true,
        customReminderSound: true,
        imageClipboard: true,
        privilegedAccess: true,
        knowledgePublishing: true,
      } satisfies RelayRuntimeCapabilities,
    });
  });

  it('disables only desktop-bound behavior in the web runtime', () => {
    expect(WEB_RUNTIME).toEqual({
      kind: 'web',
      label: 'Web',
      capabilities: {
        connectionConfiguration: false,
        pocketBaseRecovery: false,
        offlineCache: false,
        offlineMutations: false,
        nativeWindowControls: false,
        customReminderSound: false,
        imageClipboard: false,
        privilegedAccess: true,
        knowledgePublishing: true,
      } satisfies RelayRuntimeCapabilities,
    });
  });

  it('exports immutable descriptors so runtime policy cannot drift after bootstrap', () => {
    expect(Object.isFrozen(ELECTRON_RUNTIME)).toBe(true);
    expect(Object.isFrozen(ELECTRON_RUNTIME.capabilities)).toBe(true);
    expect(Object.isFrozen(WEB_RUNTIME)).toBe(true);
    expect(Object.isFrozen(WEB_RUNTIME.capabilities)).toBe(true);
  });
});
