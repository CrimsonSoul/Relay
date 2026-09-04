import { readFileSync } from 'node:fs';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ELECTRON_RUNTIME, WEB_RUNTIME } from '@shared/runtime';
import { WebRuntimeBanner } from '../WebRuntimeBanner';

vi.mock('../WebAlarmStatus', () => ({
  WebAlarmStatus: () => <span data-testid="web-alarm-status">Alarm status</span>,
}));

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
    expect(screen.getByTestId('web-alarm-status')).toBeInTheDocument();
  });

  it('does not add browser chrome to Electron', () => {
    globalThis.api = { runtime: ELECTRON_RUNTIME } as never;
    const { container } = render(<WebRuntimeBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('stays in document flow and wraps its complete warning at narrow desktop widths', () => {
    const css = readFileSync('src/renderer/src/styles/components/components-controls.css', 'utf8');
    const banner = /\.web-runtime-banner\s*\{([^}]*)\}/m.exec(css)?.[1] ?? '';
    const warning = /\.web-runtime-banner__warning\s*\{([^}]*)\}/m.exec(css)?.[1] ?? '';

    expect(banner).toMatch(/position:\s*static/u);
    expect(banner).toMatch(/flex-wrap:\s*wrap/u);
    expect(warning).toMatch(/white-space:\s*normal/u);
    expect(warning).not.toMatch(/text-overflow:\s*ellipsis/u);
  });
});
