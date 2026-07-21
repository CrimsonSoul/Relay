import { ELECTRON_RUNTIME, WEB_RUNTIME, type RelayRuntimeCapabilities } from '@shared/runtime';

export function getRelayRuntime() {
  return globalThis.api?.runtime ?? (globalThis.api ? ELECTRON_RUNTIME : WEB_RUNTIME);
}

export function hasRelayCapability(capability: keyof RelayRuntimeCapabilities): boolean {
  return getRelayRuntime().capabilities[capability];
}
