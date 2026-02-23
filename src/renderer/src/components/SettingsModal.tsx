import React, { useState, useEffect } from 'react';
import { Modal } from './Modal';
import { TactileButton } from './TactileButton';
import { useToast } from './Toast';
import { getErrorMessage } from '@shared/types';
import { secureStorage } from '../utils/secureStorage';
import { RADAR_URL_KEY } from '../tabs/RadarTab';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  isSyncing: boolean;
  onSync: () => void;
  onOpenDataManager?: () => void;
};

const DataPathDisplay = () => {
  const [path, setPath] = useState('');
  useEffect(() => {
    globalThis.api
      ?.getDataPath()
      .then(setPath)
      .catch(() => setPath(''));
  }, []);
  return <>{path || 'Loading...'}</>;
};

export const SettingsModal: React.FC<Props> = ({
  isOpen,
  onClose,
  isSyncing,
  onSync,
  onOpenDataManager,
}) => {
  // Force re-render of path when modal opens or folder changes
  const [pathKey, setPathKey] = useState(0);
  const [radarUrl, setRadarUrl] = useState('');

  useEffect(() => {
    if (isOpen) {
      setPathKey((p) => p + 1);
      setRadarUrl(secureStorage.getItemSync<string>(RADAR_URL_KEY, '') ?? '');
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

  const handleChangeFolder = async () => {
    try {
      const result = await globalThis.api?.changeDataFolder();
      if (!result || typeof result !== 'object') return;

      const resultObj = result as { success?: boolean; error?: string };
      if (resultObj.success) {
        showToast('Data folder updated successfully', 'success');
      } else if (resultObj.error && resultObj.error !== 'Cancelled') {
        showToast(`Failed to update data folder: ${resultObj.error}`, 'error');
      }
    } catch (e: unknown) {
      showToast(`Error: ${getErrorMessage(e)}`, 'error');
    }
    setPathKey((p) => p + 1);
  };

  const handleResetFolder = async () => {
    try {
      const result = await globalThis.api?.resetDataFolder();
      if (result === true) {
        showToast('Data folder reset to default', 'success');
      } else if (result && typeof result === 'object') {
        const resultObj = result as { error?: string };
        if (resultObj.error) {
          showToast(String(resultObj.error), 'error');
        }
      }
    } catch (e: unknown) {
      showToast(getErrorMessage(e), 'error');
    }
    setPathKey((p) => p + 1);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Settings" width="420px">
      <div className="settings-body">
        <div className="settings-section">
          <div className="settings-section-heading">Data Synchronization</div>
          <TactileButton onClick={onSync} variant="primary" block className="btn-center">
            {isSyncing ? (
              <>
                <span className="animate-spin settings-spinner" />
                <span>Syncing...</span>
              </>
            ) : (
              'Sync Data Now'
            )}
          </TactileButton>
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
          <div className="settings-section-heading">Storage Location</div>
          <div className="settings-data-path">
            <DataPathDisplay key={pathKey} />
          </div>
          <div className="settings-button-row">
            <TactileButton onClick={handleChangeFolder} className="btn-flex-center">
              Change...
            </TactileButton>
            <TactileButton onClick={handleResetFolder} className="btn-flex-center">
              Reset to Default
            </TactileButton>
          </div>
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

        {import.meta.env.DEV && (
          <div className="settings-section">
            <div className="settings-section-heading">Diagnostics & Demo</div>
            <TactileButton
              onClick={async () => {
                const result = await globalThis.api?.generateDummyData();
                if (result) {
                  showToast('Dummy data loaded successfully', 'success');
                  onClose();
                } else {
                  showToast('Failed to load dummy data', 'error');
                }
              }}
              className="btn-center"
            >
              Load Dummy Data
            </TactileButton>
          </div>
        )}
      </div>
    </Modal>
  );
};
