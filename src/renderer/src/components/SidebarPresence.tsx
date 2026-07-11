import type { PublicRelayConfig } from '@shared/ipc';
import { useClientPresence } from '../hooks/useClientPresence';
import { SidebarClientStatus } from './sidebar/SidebarClientStatus';

export function SidebarPresence({
  relayConfig,
  onClientConnected,
}: Readonly<{
  relayConfig?: PublicRelayConfig | null;
  onClientConnected?: (hostname: string) => void;
}>) {
  const presence = useClientPresence(relayConfig, onClientConnected);
  if (relayConfig?.mode === 'client') return null;
  return <SidebarClientStatus count={presence.count} hostnames={presence.hostnames} />;
}
