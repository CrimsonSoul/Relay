import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { PublicRelayConfig } from '@shared/ipc';
import { ConfirmModal } from '../ConfirmModal';
import { TactileButton } from '../TactileButton';
import { RelayWebAccessSettings } from './RelayWebAccessSettings';
import { useRelayConfiguration } from './RelayConfigurationContext';

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

function getMaskedSecret(secret: string): string {
  return '•'.repeat(secret.length);
}

function ConnectionManagement({
  enabled,
  onReconfigure,
}: Readonly<{ enabled: boolean; onReconfigure: () => Promise<void> }>) {
  if (!enabled) {
    return (
      <div className="settings-data-path">
        Connection settings are managed by Relay Desktop on the server.
      </div>
    );
  }
  return (
    <div className="settings-button-row">
      <TactileButton onClick={() => void onReconfigure()} className="btn-flex-center">
        Reconfigure...
      </TactileButton>
    </div>
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
  let displayedConnectionSecret: string | null = null;
  if (connectionSecret) {
    displayedConnectionSecret = showConnectionSecret
      ? connectionSecret
      : getMaskedSecret(connectionSecret);
  }

  const copyText = async (text: string) => {
    await globalThis.api?.writeClipboard(text);
  };

  if (!active) return null;

  return (
    <>
      {presentation === 'modal' && <div className="settings-divider" />}
      {onOpenDataManager && (
        <div className="settings-section">
          <div className="settings-section-heading">Relay data</div>
          <div className="settings-description">
            Review, import, or maintain the shared operational records used by Relay.
          </div>
          <TactileButton
            onClick={() => {
              if (presentation === 'modal') onClose();
              onOpenDataManager();
            }}
            variant="primary"
            className="btn-center"
          >
            Open Data Manager...
          </TactileButton>
        </div>
      )}

      {presentation === 'modal' && onOpenDataManager && <div className="settings-divider" />}

      <div className="settings-section">
        <div className="settings-section-heading">Relay connection</div>
        <div className="settings-description">
          {canConfigureConnection
            ? "This workstation's role and the address other Relay stations use."
            : 'The Relay server supplying shared data to this browser.'}
        </div>
        {pbConfigLoading && <div className="settings-data-path">Loading...</div>}
        {!pbConfigLoading && !pbConfig && <div className="settings-data-path">Not configured</div>}
        {!pbConfigLoading && pbConfig && (
          <>
            <div className="settings-data-path">
              Mode: {pbConfig.mode === 'server' ? 'Embedded Server' : 'Remote Client'}
            </div>
            {pbUrl && (
              <div className="settings-data-path settings-copy-row">
                <span>URL: {pbUrl}</span>
                <button
                  type="button"
                  className="settings-inline-action"
                  onClick={() => void copyText(pbUrl)}
                >
                  Copy
                </button>
              </div>
            )}
            {canConfigureConnection && connectionSecret && displayedConnectionSecret && (
              <div className="settings-data-path settings-copy-row">
                <span>Passphrase: {displayedConnectionSecret}</span>
                <span className="settings-inline-actions">
                  <button
                    type="button"
                    className="settings-inline-action"
                    aria-label={showConnectionSecret ? 'Hide passphrase' : 'Show passphrase'}
                    onClick={() => setShowConnectionSecret((current) => !current)}
                  >
                    {showConnectionSecret ? 'Hide' : 'Show'}
                  </button>
                  <button
                    type="button"
                    className="settings-inline-action"
                    onClick={() => void copyText(connectionSecret)}
                  >
                    Copy
                  </button>
                </span>
              </div>
            )}
            <ConnectionManagement
              enabled={canConfigureConnection}
              onReconfigure={handleReconfigureRequest}
            />
            <ConfirmModal
              isOpen={reconfigurePrompt}
              onClose={() => setReconfigurePrompt(false)}
              onConfirm={handleReconfigure}
              title="Reconfigure Relay connection?"
              message={reconfigureWarning(pendingOfflineCount)}
              confirmLabel="Erase and reconfigure"
              isDanger
            />
          </>
        )}
      </div>

      {canConfigureConnection && !pbConfigLoading && pbConfig?.mode === 'server' && (
        <RelayWebAccessSettings pocketBasePort={pbConfig.port} />
      )}
    </>
  );
}
