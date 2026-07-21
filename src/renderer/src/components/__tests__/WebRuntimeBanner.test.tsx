import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ELECTRON_RUNTIME, WEB_RUNTIME } from '@shared/runtime';
import { WebRuntimeBanner } from '../WebRuntimeBanner';

describe('WebRuntimeBanner', () => {
  afterEach(() => {
    globalThis.api = undefined;
  });

  it('keeps the Web label and exact HTTP warning visible in browser sessions', () => {
    globalThis.api = { runtime: WEB_RUNTIME } as never;
    render(<WebRuntimeBanner />);

    expect(screen.getByText('Web')).toBeInTheDocument();
    expect(
      screen.getByText('Trusted LAN/VPN only - browser traffic is not encrypted'),
    ).toBeInTheDocument();
  });

  it('does not add browser chrome to Electron', () => {
    globalThis.api = { runtime: ELECTRON_RUNTIME } as never;
    const { container } = render(<WebRuntimeBanner />);
    expect(container).toBeEmptyDOMElement();
  });
});
