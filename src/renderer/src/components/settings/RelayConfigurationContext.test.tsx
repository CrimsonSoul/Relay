import { act, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { PublicRelayConfig } from '@shared/ipc';
import { RelayConfigurationProvider, useRelayConfiguration } from './RelayConfigurationContext';

const original = globalThis.api;
afterEach(() => {
  globalThis.api = original;
});

it('never reports a missing configuration before the first load settles', async () => {
  let resolveConfig!: (config: PublicRelayConfig | null) => void;
  const getConfig = vi.fn(
    () =>
      new Promise<PublicRelayConfig | null>((resolve) => {
        resolveConfig = resolve;
      }),
  );
  globalThis.api = { getConfig } as never;
  const unconfiguredRenders: boolean[] = [];
  function Probe() {
    const { loading, config } = useRelayConfiguration();
    unconfiguredRenders.push(!loading && config === null);
    return null;
  }

  const view = render(
    <RelayConfigurationProvider isOpen={false}>
      <Probe />
    </RelayConfigurationProvider>,
  );
  unconfiguredRenders.length = 0;
  view.rerender(
    <RelayConfigurationProvider isOpen>
      <Probe />
    </RelayConfigurationProvider>,
  );
  expect(getConfig).toHaveBeenCalledOnce();
  expect(unconfiguredRenders).not.toContain(true);

  await act(async () => resolveConfig(null));
  expect(unconfiguredRenders.at(-1)).toBe(true);
});

it('is loading on the first render when mounted open', () => {
  globalThis.api = { getConfig: () => new Promise(() => undefined) } as never;
  const firstRender: boolean[] = [];
  function Probe() {
    firstRender.push(useRelayConfiguration().loading);
    return null;
  }
  render(
    <RelayConfigurationProvider isOpen>
      <Probe />
    </RelayConfigurationProvider>,
  );
  expect(firstRender[0]).toBe(true);
});
