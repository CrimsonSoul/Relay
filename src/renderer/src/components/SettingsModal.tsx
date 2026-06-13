import React, { useState, useEffect } from 'react';
import { Modal } from './Modal';
import { TactileButton } from './TactileButton';
import type { PublicRelayConfig } from '@shared/ipc';
import { ACCENT_SCHEMES, getStoredAccent, setAccent, type AccentId } from '../theme/accent';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onOpenDataManager?: () => void;
  onReconfigure?: () => void;
};

type PbConfig = PublicRelayConfig | null;

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

export const SettingsModal: React.FC<Props> = ({
  isOpen,
  onClose,
  onOpenDataManager,
  onReconfigure,
}) => {
  const [pbConfig, setPbConfig] = useState<PbConfig>(null);
  const [connectionSecret, setConnectionSecret] = useState<string | null>(null);
  const [pbConfigLoading, setPbConfigLoading] = useState(false);
  const [showConnectionSecret, setShowConnectionSecret] = useState(false);
  const [accent, setAccentState] = useState<AccentId>(() => getStoredAccent());

  const handleAccentSelect = (id: AccentId) => {
    setAccent(id);
    setAccentState(id);
  };

  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;
    setPbConfigLoading(true);
    setConnectionSecret(null);
    setShowConnectionSecret(false);
    globalThis.api
      ?.getConfig()
      .then((config) => {
        if (!cancelled) setPbConfig(config);
      })
      .catch(() => {
        if (!cancelled) setPbConfig(null);
      })
      .finally(() => {
        if (!cancelled) setPbConfigLoading(false);
      });
    globalThis.api
      ?.getConnectionSecret?.()
      .then((secret) => {
        if (!cancelled) setConnectionSecret(secret);
      })
      .catch(() => {
        if (!cancelled) setConnectionSecret(null);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const handleReconfigure = async () => {
    // Delete config on disk so the app returns to the setup screen on restart.
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

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Settings" width="420px">
      <div className="settings-body">
        <div className="settings-section">
          <div className="settings-section-heading">Accent Color</div>
          <div className="accent-picker" role="radiogroup" aria-label="Accent color">
            {ACCENT_SCHEMES.map((scheme) => (
              <button
                key={scheme.id}
                type="button"
                role="radio"
                aria-checked={accent === scheme.id}
                title={scheme.label}
                className={`accent-picker-swatch${accent === scheme.id ? ' accent-picker-swatch--active' : ''}`}
                style={{ ['--swatch' as string]: scheme.swatch }}
                onClick={() => handleAccentSelect(scheme.id)}
              >
                <span className="accent-picker-swatch-label">{scheme.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="settings-divider" />

        {onOpenDataManager && (
          <>
            <div className="settings-section">
              <div className="settings-section-heading">Data Management</div>
              <TactileButton
                onClick={() => {
                  onClose();
                  onOpenDataManager();
                }}
                variant="primary"
                className="btn-center"
              >
                Open Data Manager...
              </TactileButton>
            </div>

            <div className="settings-divider" />
          </>
        )}

        <div className="settings-section">
          <div className="settings-section-heading">PocketBase</div>
          {pbConfigLoading && <div className="settings-data-path">Loading...</div>}
          {!pbConfigLoading && !pbConfig && (
            <div className="settings-data-path">Not configured</div>
          )}
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
              {displayedConnectionSecret && (
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
              <div className="settings-button-row">
                <TactileButton onClick={handleReconfigure} className="btn-flex-center">
                  Reconfigure...
                </TactileButton>
              </div>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
};
