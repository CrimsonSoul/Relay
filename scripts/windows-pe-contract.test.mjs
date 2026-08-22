import { describe, expect, it } from 'vitest';
import {
  assertApplicationManifestResources,
  assertAsInvokerManifest,
} from './verify-windows-pe.mjs';

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

  it('ignores comment decoys and rejects ambiguous execution-level declarations', () => {
    expect(() =>
      assertAsInvokerManifest(
        '<!-- <requestedExecutionLevel level="asInvoker" uiAccess="false"/> -->' +
          '<requestedExecutionLevel level="requireAdministrator" uiAccess="false"/>',
        'Relay.exe',
      ),
    ).toThrow(/asInvoker/);
    expect(() =>
      assertAsInvokerManifest(
        '<requestedExecutionLevel level="asInvoker" uiAccess="false"/>' +
          '<requestedExecutionLevel level="asInvoker" uiAccess="false"/>',
        'Relay.exe',
      ),
    ).toThrow(/exactly one/i);
  });

  it('rejects secondary or non-primary manifest resources', () => {
    const asInvoker = '<requestedExecutionLevel level="asInvoker" uiAccess="false"/>';
    expect(() =>
      assertApplicationManifestResources(
        [
          { id: 1, manifest: asInvoker },
          { id: 2, manifest: asInvoker },
        ],
        'Relay.exe',
      ),
    ).toThrow(/exactly one primary/i);
    expect(() =>
      assertApplicationManifestResources([{ id: 2, manifest: asInvoker }], 'Relay.exe'),
    ).toThrow(/primary/i);
  });
});
