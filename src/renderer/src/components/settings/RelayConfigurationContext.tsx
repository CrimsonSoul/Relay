import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { PublicRelayConfig } from '@shared/ipc';
import { hasRelayCapability } from '../../runtime/relayRuntime';

type RelayConfiguration = {
  config: PublicRelayConfig | null;
  loading: boolean;
  connectionSecret: string | null;
  canConfigureConnection: boolean;
  relayMode: PublicRelayConfig['mode'] | null;
};

const RelayConfigurationContext = createContext<RelayConfiguration | null>(null);

export function RelayConfigurationProvider({
  isOpen,
  children,
}: Readonly<{ isOpen: boolean; children: ReactNode }>) {
  const canConfigureConnection = hasRelayCapability('connectionConfiguration');
  const [config, setConfig] = useState<PublicRelayConfig | null>(null);
  const [connectionSecret, setConnectionSecret] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;
    setLoading(true);
    setConnectionSecret(null);
    globalThis.api
      ?.getConfig()
      .then((nextConfig) => {
        if (!cancelled) setConfig(nextConfig);
      })
      .catch(() => {
        if (!cancelled) setConfig(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    if (canConfigureConnection) {
      globalThis.api
        ?.getConnectionSecret?.()
        .then((secret) => {
          if (!cancelled) setConnectionSecret(secret);
        })
        .catch(() => {
          if (!cancelled) setConnectionSecret(null);
        });
    }

    return () => {
      cancelled = true;
    };
  }, [canConfigureConnection, isOpen]);

  const value = useMemo<RelayConfiguration>(
    () => ({
      config,
      loading,
      connectionSecret,
      canConfigureConnection,
      relayMode: config?.mode ?? null,
    }),
    [canConfigureConnection, config, connectionSecret, loading],
  );

  return (
    <RelayConfigurationContext.Provider value={value}>
      {children}
    </RelayConfigurationContext.Provider>
  );
}

export function useRelayConfiguration(): RelayConfiguration {
  const context = useContext(RelayConfigurationContext);
  if (!context) {
    throw new Error('useRelayConfiguration must be used within RelayConfigurationProvider');
  }
  return context;
}
