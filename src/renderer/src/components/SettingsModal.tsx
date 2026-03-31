import React, { useState, useEffect } from 'react';
import { Modal } from './Modal';
import { TactileButton } from './TactileButton';
import { useToast } from './Toast';
import { getErrorMessage } from '@shared/types';
import { secureStorage } from '../utils/secureStorage';
import { RADAR_URL_KEY } from '../tabs/RadarTab';
import { useTheme, type ThemePreference } from '../hooks/useTheme';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onOpenDataManager?: () => void;
  onReconfigure?: () => void;
};

type PbConfig = {
  mode?: string;
  port?: number;
  serverUrl?: string;
  secret?: string;
} | null;

export const SettingsModal: React.FC<Props> = ({
  isOpen,
  onClose,
  onOpenDataManager,
  onReconfigure,
}) => {
  const { preference, setPreference } = useTheme();
  const [radarUrl, setRadarUrl] = useState('');
  const [pbConfig, setPbConfig] = useState<PbConfig>(null);
  const [pbConfigLoading, setPbConfigLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setRadarUrl(secureStorage.getItemSync<string>(RADAR_URL_KEY, '') ?? '');
      setPbConfigLoading(true);
      globalThis.api
        ?.getConfig()
        .then((config) => setPbConfig(config as PbConfig))
        .catch(() => setPbConfig(null))
        .finally(() => setPbConfigLoading(false));
    }
  }, [isOpen]);

  const { showToast } = useToast();

  const handleSaveRadarUrl = () => {
    const trimmed = radarUrl.trim();
    if (trimmed && !trimmed.startsWith('http')) {
      showToast('Radar URL must start with http:// or https://', 'error');
      return;
    }
    secureStorage.setItemSync(RADAR_URL_KEY, trimmed);
    globalThis.api?.registerRadarUrl(trimmed)?.catch((error_) => {
      showToast(`Failed to register radar URL: ${getErrorMessage(error_)}`, 'error');
    });
    showToast(trimmed ? 'Radar URL saved' : 'Radar URL cleared', 'success');
  };

  const handleReconfigure = async () => {
    // Clear config so the app shows the setup screen on reload
    try {
      await globalThis.api?.saveConfig({ mode: 'unconfigured' });
    } catch {
      // If save fails, clearing via reload will still show setup if PB can't connect
    }
    onClose();
    onReconfigure?.();
  };

  const pbUrl =
    pbConfig?.mode === 'server'
      ? `http://localhost:${pbConfig.port ?? 8090}`
      : (pbConfig?.serverUrl ?? null);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Settings" width="420px">
      <div className="settings-body">
        <div className="settings-section">
          <div className="settings-section-heading">Appearance</div>
          <div className="settings-button-row">
            {(['system', 'light', 'dark'] as ThemePreference[]).map((opt) => (
              <TactileButton
                key={opt}
                variant={preference === opt ? 'primary' : 'secondary'}
                onClick={() => setPreference(opt)}
                className="btn-flex-center"
              >
                {opt.charAt(0).toUpperCase() + opt.slice(1)}
              </TactileButton>
            ))}
          </div>
        </div>

        <div className="settings-divider" />

        {onOpenDataManager && (
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
        )}

        <div className="settings-divider" />

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
              {pbUrl && <div className="settings-data-path">URL: {pbUrl}</div>}
              <div className="settings-button-row">
                <TactileButton onClick={handleReconfigure} className="btn-flex-center">
                  Reconfigure...
                </TactileButton>
              </div>
            </>
          )}
        </div>

        <div className="settings-divider" />

        <div className="settings-section">
          <div className="settings-section-heading">Radar Tab URL</div>
          <div className="settings-description">
            Enter the URL for your internal radar / network dashboard.
          </div>
          <input
            id="radar-url-input"
            type="url"
            className="settings-text-input"
            placeholder="https://your-intranet/dashboard"
            value={radarUrl}
            onChange={(e) => setRadarUrl(e.target.value)}
          />
          <div className="settings-button-row">
            <TactileButton
              onClick={handleSaveRadarUrl}
              variant="primary"
              className="btn-flex-center"
            >
              Save
            </TactileButton>
            <TactileButton
              onClick={() => {
                setRadarUrl('');
                secureStorage.setItemSync(RADAR_URL_KEY, '');
                globalThis.api?.registerRadarUrl('')?.catch((error_) => {
                  showToast(`Failed to clear radar URL: ${getErrorMessage(error_)}`, 'error');
                });
                showToast('Radar URL cleared', 'success');
              }}
              className="btn-flex-center"
            >
              Clear
            </TactileButton>
          </div>
        </div>

        <div className="settings-divider" />
      </div>
    </Modal>
  );
};
