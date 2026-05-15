import React, { useState, useEffect } from 'react';
import { Modal } from './Modal';
import { TactileButton } from './TactileButton';
import type { PublicRelayConfig } from '@shared/ipc';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onOpenDataManager?: () => void;
  onReconfigure?: () => void;
};

type PbConfig = PublicRelayConfig | null;

export const SettingsModal: React.FC<Props> = ({
  isOpen,
  onClose,
  onOpenDataManager,
  onReconfigure,
}) => {
  const [pbConfig, setPbConfig] = useState<PbConfig>(null);
  const [pbConfigLoading, setPbConfigLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setPbConfigLoading(true);
      globalThis.api
        ?.getConfig()
        .then((config) => setPbConfig(config))
        .catch(() => setPbConfig(null))
        .finally(() => setPbConfigLoading(false));
    }
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

  const pbUrl =
    pbConfig?.mode === 'server'
      ? `http://localhost:${pbConfig.port ?? 8090}`
      : (pbConfig?.serverUrl ?? null);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Settings" width="420px">
      <div className="settings-body">
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
              {pbUrl && <div className="settings-data-path">URL: {pbUrl}</div>}
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
