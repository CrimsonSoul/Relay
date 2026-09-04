import { useState } from 'react';
import { getRelayRuntime } from '../runtime/relayRuntime';
import { webSessionClient } from '../runtime/WebSessionClient';
import { TactileButton } from './TactileButton';
import { WebAlarmStatus } from './WebAlarmStatus';

export const WEB_HTTP_WARNING = 'Trusted LAN/VPN only - browser traffic is not encrypted';

export function WebRuntimeBanner() {
  const [signingOut, setSigningOut] = useState(false);
  const isWeb = getRelayRuntime().kind === 'web';

  const signOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      // Clearing the relay_web_session cookie server-side is the only thing that stops the next
      // person on a shared browser from reloading straight into this session.
      await webSessionClient.logout();
    } finally {
      globalThis.location?.reload();
    }
  };

  if (!isWeb) return null;
  return (
    <aside className="web-runtime-banner" aria-label="Relay Web connection notice">
      <span className="web-runtime-banner__label">Web</span>
      <span className="web-runtime-banner__warning">{WEB_HTTP_WARNING}</span>
      <WebAlarmStatus />
      <TactileButton
        type="button"
        variant="ghost"
        size="sm"
        disabled={signingOut}
        onClick={() => void signOut()}
      >
        {signingOut ? 'Signing out…' : 'Sign out'}
      </TactileButton>
    </aside>
  );
}
