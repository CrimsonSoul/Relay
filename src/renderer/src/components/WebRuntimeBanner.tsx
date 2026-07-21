import { getRelayRuntime } from '../runtime/relayRuntime';

export const WEB_HTTP_WARNING = 'Trusted LAN/VPN only - browser traffic is not encrypted';

export function WebRuntimeBanner() {
  if (getRelayRuntime().kind !== 'web') return null;
  return (
    <aside className="web-runtime-banner" aria-label="Relay Web connection notice">
      <span className="web-runtime-banner__label">Web</span>
      <span className="web-runtime-banner__warning">{WEB_HTTP_WARNING}</span>
    </aside>
  );
}
