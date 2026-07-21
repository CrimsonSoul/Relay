import { describe, expect, it, vi } from 'vitest';
import type { PrivilegedSessionView } from '@shared/privilegedAccess';
import { ProductionPrivilegedHost } from '../ProductionPrivilegedHost';

const PRIVATE_ADDRESS_A = ['10', '0', '0', '8'].join('.');
const PRIVATE_ADDRESS_B = ['10', '0', '0', '9'].join('.');
const PRIVATE_ADDRESS_C = ['10', '0', '0', '10'].join('.');

const signedOut = (): PrivilegedSessionView => ({
  state: 'signed-out',
  accountId: null,
  username: null,
  displayName: null,
  role: null,
  capabilities: [],
  deviceId: null,
  expiresAt: null,
});

describe('ProductionPrivilegedHost', () => {
  it('creates one Electron child and isolated browser children over shared resources', async () => {
    const children: Array<{
      source: unknown;
      view: PrivilegedSessionView;
      dispose: ReturnType<typeof vi.fn>;
      handleAuthorityChanged: ReturnType<typeof vi.fn>;
    }> = [];
    const disposeShared = vi.fn(async () => undefined);
    const host = new ProductionPrivilegedHost({
      createRuntime: (source) => {
        const child = {
          source,
          view: signedOut(),
          dispose: vi.fn(async () => undefined),
          getView() {
            return this.view;
          },
          handleAuthorityChanged: vi.fn(),
        };
        children.push(child);
        return child as never;
      },
      disposeShared,
    });

    const electron = host.createElectronRuntime();
    expect(host.createElectronRuntime()).toBe(electron);
    const browserA = host.createWebRuntime({
      sessionId: 'session-a',
      source: { browserFamily: 'Chrome', addressLabel: PRIVATE_ADDRESS_A },
    });
    const browserB = host.createWebRuntime({
      sessionId: 'session-b',
      source: { browserFamily: 'Safari', addressLabel: PRIVATE_ADDRESS_B },
    });

    expect(browserA).not.toBe(browserB);
    expect(browserA).not.toBe(electron);
    expect(host.getWebRuntime('session-a')).toBe(browserA);
    expect(children.map(({ source }) => source)).toEqual([
      { kind: 'electron' },
      {
        kind: 'web',
        sessionId: 'session-a',
        browserFamily: 'Chrome',
        addressLabel: PRIVATE_ADDRESS_A,
      },
      {
        kind: 'web',
        sessionId: 'session-b',
        browserFamily: 'Safari',
        addressLabel: PRIVATE_ADDRESS_B,
      },
    ]);

    host.handleAuthorityChanged(['account-owner']);
    expect(
      children.every(
        ({ handleAuthorityChanged }) => handleAuthorityChanged.mock.calls.length === 1,
      ),
    ).toBe(true);

    await host.disposeWebRuntime('session-a');
    expect(children[1]?.dispose).toHaveBeenCalledOnce();
    expect(disposeShared).not.toHaveBeenCalled();
    expect(host.getWebRuntime('session-a')).toBeNull();

    await host.dispose();
    expect(children[0]?.dispose).toHaveBeenCalledOnce();
    expect(children[1]?.dispose).toHaveBeenCalledOnce();
    expect(children[2]?.dispose).toHaveBeenCalledOnce();
    expect(disposeShared).toHaveBeenCalledOnce();
    await host.dispose();
    expect(disposeShared).toHaveBeenCalledOnce();
  });

  it('rejects duplicate or unbounded browser session metadata', () => {
    const host = new ProductionPrivilegedHost({
      createRuntime: () =>
        ({
          dispose: vi.fn(),
          getView: signedOut,
          handleAuthorityChanged: vi.fn(),
        }) as never,
      disposeShared: vi.fn(),
    });
    host.createWebRuntime({
      sessionId: 'session-a',
      source: { browserFamily: 'Edge', addressLabel: PRIVATE_ADDRESS_C },
    });

    expect(() =>
      host.createWebRuntime({
        sessionId: 'session-a',
        source: { browserFamily: 'Edge', addressLabel: PRIVATE_ADDRESS_C },
      }),
    ).toThrow('already exists');
    expect(() =>
      host.createWebRuntime({
        sessionId: 'x'.repeat(200),
        source: { browserFamily: 'Other', addressLabel: PRIVATE_ADDRESS_C },
      }),
    ).toThrow('Invalid web session');
  });
});
