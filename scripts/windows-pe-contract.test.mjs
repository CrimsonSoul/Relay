import { describe, expect, it } from 'vitest';
import { assertAsInvokerManifest } from './verify-windows-pe.mjs';

describe('Windows PE contract', () => {
  it('accepts only a non-elevating asInvoker manifest', () => {
    expect(() =>
      assertAsInvokerManifest(
        '<requestedExecutionLevel level="asInvoker" uiAccess="false"/>',
        'Relay.exe',
      ),
    ).not.toThrow();
    expect(() =>
      assertAsInvokerManifest(
        '<requestedExecutionLevel level="requireAdministrator" uiAccess="false"/>',
        'Relay.exe',
      ),
    ).toThrow(/asInvoker/);
  });

  it('rejects a manifest that requests UI access', () => {
    expect(() =>
      assertAsInvokerManifest(
        '<requestedExecutionLevel level="asInvoker" uiAccess="true"/>',
        'Relay.exe',
      ),
    ).toThrow(/uiAccess/i);
  });
});
