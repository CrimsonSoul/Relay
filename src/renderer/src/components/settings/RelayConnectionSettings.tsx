import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { PublicRelayConfig } from '@shared/ipc';
import { ConfirmModal } from '../ConfirmModal';
import { TactileButton } from '../TactileButton';
import { RelayWebAccessSettings } from './RelayWebAccessSettings';
import { useRelayConfiguration } from './RelayConfigurationContext';
import { SettingsCopyButton } from './SettingsCopyButton';

const RECONFIGURE_WARNING =
  'Reconfiguring erases the saved Relay server URL and the shared connection passphrase from this workstation. You will need the passphrase again to reconnect.';

type RelayConnectionUiState = {
  showConnectionSecret: boolean;
  setShowConnectionSecret: React.Dispatch<React.SetStateAction<boolean>>;
  reconfigurePrompt: boolean;
  setReconfigurePrompt: React.Dispatch<React.SetStateAction<boolean>>;
  pendingOfflineCount: number;
  setPendingOfflineCount: React.Dispatch<React.SetStateAction<number>>;
};

const RelayConnectionUiContext = createContext<RelayConnectionUiState | null>(null);

export function RelayConnectionUiProvider({
  isOpen,
  children,
}: Readonly<{ isOpen: boolean; children: ReactNode }>) {
  const [showConnectionSecret, setShowConnectionSecret] = useState(false);
  const [reconfigurePrompt, setReconfigurePrompt] = useState(false);
  const [pendingOfflineCount, setPendingOfflineCount] = useState(0);

  useEffect(() => {
    if (isOpen) return;
    setShowConnectionSecret(false);
    setReconfigurePrompt(false);
    setPendingOfflineCount(0);
  }, [isOpen]);

  const value = useMemo<RelayConnectionUiState>(
    () => ({
      showConnectionSecret,
      setShowConnectionSecret,
      reconfigurePrompt,
      setReconfigurePrompt,
      pendingOfflineCount,
      setPendingOfflineCount,
    }),
    [pendingOfflineCount, reconfigurePrompt, showConnectionSecret],
  );

  return (
    <RelayConnectionUiContext.Provider value={value}>{children}</RelayConnectionUiContext.Provider>
  );
}

function useRelayConnectionUi(): RelayConnectionUiState {
  const context = useContext(RelayConnectionUiContext);
  if (!context) {
    throw new Error('useRelayConnectionUi must be used within RelayConnectionUiProvider');
  }
  return context;
}

function reconfigureWarning(pendingOfflineCount: number): string {
  if (pendingOfflineCount <= 0) return RECONFIGURE_WARNING;
  const plural = pendingOfflineCount === 1 ? '' : 's';
  return `${RECONFIGURE_WARNING} ${pendingOfflineCount} offline change${plural} queued on this workstation will be discarded if you point Relay at a different server.`;
}

/** Best-effort — the queued count only enriches the reconfigure warning. */
async function readPendingOfflineCount(): Promise<number> {
  try {
    return (await globalThis.api?.getPendingSyncStatus?.())?.pendingCount ?? 0;
  } catch {
    return 0;
  }
}

function getPocketBaseIp(config: PublicRelayConfig): string | null {
  if (config.mode === 'server') {
    if (config.bindHost === '127.0.0.1') return '127.0.0.1';
    return config.lanIp ?? null;
  }

  try {
    return new URL(config.serverUrl).hostname;
  } catch {
    return config.serverUrl || null;
  }
}

function getPocketBaseUrl(config: PublicRelayConfig): string | null {
  if (config.mode === 'client') return config.serverUrl;

  const ip = getPocketBaseIp(config);
  if (!ip) return null;
  return `http://${ip}:${config.port ?? 8090}`;
}

/** Fixed-length mask: never reveals the passphrase length and never wraps the readout. */
const CONCEALED_READOUT = '••••••••••••';

function ConnectionManagement({ enabled }: Readonly<{ enabled: boolean }>) {
  if (enabled) return null;
  return (
    <p className="settings-description">
      Connection settings are managed by Relay Desktop on the server.
    </p>
  );
}

function ReconfigureButton({ onReconfigure }: Readonly<{ onReconfigure: () => Promise<void> }>) {
  return (
    <TactileButton size="sm" onClick={() => void onReconfigure()}>
      Reconfigure…
    </TactileButton>
  );
}

type RelayConnectionSettingsProps = {
  active: boolean;
  onClose: () => void;
  onOpenDataManager?: () => void;
  onReconfigure?: () => void;
  presentation: 'modal' | 'page';
};

export function RelayConnectionSettings({
  active,
  onClose,
  onOpenDataManager,
  onReconfigure,
  presentation,
}: Readonly<RelayConnectionSettingsProps>) {
  const {
    config: pbConfig,
    loading: pbConfigLoading,
    connectionSecret,
    canConfigureConnection,
  } = useRelayConfiguration();
  const {
    showConnectionSecret,
    setShowConnectionSecret,
    reconfigurePrompt,
    setReconfigurePrompt,
    pendingOfflineCount,
    setPendingOfflineCount,
  } = useRelayConnectionUi();

  const handleReconfigureRequest = async () => {
    setPendingOfflineCount(await readPendingOfflineCount());
    setReconfigurePrompt(true);
  };

  const handleReconfigure = async () => {
    try {
      await globalThis.api?.clearConfig();
    } catch {
      // Best-effort — onReconfigure() transitions to setup regardless.
    }
    onClose();
    onReconfigure?.();
  };

  const pbUrl = pbConfig ? getPocketBaseUrl(pbConfig) : null;
  let connectionReadout: string | null = null;
  if (connectionSecret) {
    connectionReadout = showConnectionSecret ? connectionSecret : CONCEALED_READOUT;
  }

  // Relay Web holds an unsaved form, so it stays mounted (hidden) while another tab shows.
  const webAccess = canConfigureConnection && !pbConfigLoading && pbConfig?.mode === 'server' && (
    <RelayWebAccessSettings pocketBasePort={pbConfig.port} hidden={!active} />
  );

  const connectionContent = (
    <>
      {presentation === 'modal' && <div className="settings-divider" />}
      <section className="settings-section">
        <h2 className="settings-section-heading settings-section-heading--tab-echo">Relay data</h2>
        <p className="settings-description">
          Contacts, servers and on-call teams shared through the Relay server.
        </p>
        <h3 className="settings-section-heading">Relay connection</h3>
        <p className="settings-description">
          {canConfigureConnection
            ? "This workstation's role and the address Relay clients use to reach it."
            : 'The Relay server supplying shared data to this browser.'}
        </p>
        {pbConfigLoading && <p className="settings-data-path">Loading…</p>}
        {!pbConfigLoading && !pbConfig && <p className="settings-data-path">Not configured</p>}
        {!pbConfigLoading && pbConfig && (
          <>
            <dl className="settings-readout">
              <div className="settings-readout__row">
                <dt>Mode</dt>
                <dd>
                  <span className="settings-readout__value">
                    {pbConfig.mode === 'server' ? 'Embedded Server' : 'Relay Client'}
                  </span>
                </dd>
              </div>
              {pbUrl && (
                <div className="settings-readout__row">
                  <dt>URL</dt>
                  <dd>
                    <span className="settings-readout__value">{pbUrl}</span>
                    <SettingsCopyButton text={pbUrl} label="Copy Relay URL" />
                  </dd>
                </div>
              )}
              {canConfigureConnection && connectionSecret && connectionReadout && (
                <div className="settings-readout__row">
                  <dt>Passphrase</dt>
                  <dd>
                    <span className="settings-readout__value settings-readout__value--secret">
                      {connectionReadout}
                      <span className="sr-only">
                        {' '}
                        Shared secret Relay clients enter to connect. Keep it private.
                      </span>
                    </span>
                    <span className="settings-inline-actions">
                      <TactileButton
                        size="xs"
                        aria-label={showConnectionSecret ? 'Hide passphrase' : 'Show passphrase'}
                        onClick={() => setShowConnectionSecret((current) => !current)}
                      >
                        {showConnectionSecret ? 'Hide' : 'Show'}
                      </TactileButton>
                      <SettingsCopyButton text={connectionSecret} label="Copy passphrase" />
                    </span>
                  </dd>
                </div>
              )}
            </dl>
            <ConnectionManagement enabled={canConfigureConnection} />
            <ConfirmModal
              isOpen={reconfigurePrompt}
              onClose={() => setReconfigurePrompt(false)}
              onConfirm={handleReconfigure}
              title="Reconfigure Relay connection?"
              message={reconfigureWarning(pendingOfflineCount)}
              confirmLabel="Erase and Reconfigure"
              isDanger
            />
          </>
        )}
        <div className="settings-button-row">
          {onOpenDataManager && (
            <TactileButton
              size="sm"
              variant="primary"
              onClick={() => {
                if (presentation === 'modal') onClose();
                onOpenDataManager();
              }}
            >
              Open Data Manager…
            </TactileButton>
          )}
          {!pbConfigLoading && pbConfig && canConfigureConnection && (
            <ReconfigureButton onReconfigure={handleReconfigureRequest} />
          )}
        </div>
      </section>
    </>
  );

  return (
    <>
      {active && connectionContent}
      {webAccess}
    </>
  );
}
