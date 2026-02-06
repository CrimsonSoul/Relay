import React, { useState, useEffect } from 'react';
import { Modal } from './Modal';
import { TactileButton } from './TactileButton';
import { useToast } from './Toast';
import { getErrorMessage } from '@shared/types';

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
    void window.api?.getDataPath().then(setPath);
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

  useEffect(() => {
    if (isOpen) setPathKey((p) => p + 1);
  }, [isOpen]);

  const { showToast } = useToast();

  const handleChangeFolder = async () => {
    try {
      const result = await window.api?.changeDataFolder();
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
      const result = await window.api?.resetDataFolder();
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
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div
            style={{
              fontSize: '13px',
              fontWeight: 700,
              color: 'var(--color-text-tertiary)',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}
          >
            Data Synchronization
          </div>
          <TactileButton
            onClick={onSync}
            variant="primary"
            style={{
              width: '100%',
              justifyContent: 'center',
            }}
          >
            {isSyncing ? (
              <>
                <span
                  className="animate-spin"
                  style={{
                    width: '12px',
                    height: '12px',
                    border: '2px solid currentColor',
                    borderTopColor: 'transparent',
                    borderRadius: '50%',
                  }}
                />
                Syncing...
              </>
            ) : (
              'Sync Data Now'
            )}
          </TactileButton>
        </div>

        <div style={{ height: '1px', background: 'var(--border-subtle)' }} />

        {onOpenDataManager && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div
              style={{
                fontSize: '13px',
                fontWeight: 700,
                color: 'var(--color-text-tertiary)',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
              }}
            >
              Data Management
            </div>
            <TactileButton
              onClick={() => {
                onClose();
                onOpenDataManager();
              }}
              variant="primary"
              style={{ justifyContent: 'center' }}
            >
              Open Data Manager...
            </TactileButton>
          </div>
        )}

        <div style={{ height: '1px', background: 'var(--border-subtle)' }} />

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div
            style={{
              fontSize: '13px',
              fontWeight: 700,
              color: 'var(--color-text-tertiary)',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}
          >
            Storage Location
          </div>
          <div
            style={{
              fontSize: '12px',
              color: 'var(--color-text-secondary)',
              padding: '10px 14px',
              background: 'var(--color-bg-surface-elevated)',
              border: 'var(--border-medium)',
              borderRadius: '8px',
              wordBreak: 'break-word',
              overflowWrap: 'anywhere',
              lineHeight: '1.5',
              fontFamily: 'var(--font-family-mono)',
            }}
          >
            <DataPathDisplay key={pathKey} />
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <TactileButton
              onClick={handleChangeFolder}
              style={{ flex: 1, justifyContent: 'center' }}
            >
              Change...
            </TactileButton>
            <TactileButton
              onClick={handleResetFolder}
              style={{ flex: 1, justifyContent: 'center' }}
            >
              Reset to Default
            </TactileButton>
          </div>
        </div>

        <div style={{ height: '1px', background: 'var(--border-subtle)' }} />

        {import.meta.env.DEV && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div
              style={{
                fontSize: '13px',
                fontWeight: 700,
                color: 'var(--color-text-tertiary)',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
              }}
            >
              Diagnostics & Demo
            </div>
            <TactileButton
              onClick={async () => {
                const result = await window.api?.generateDummyData();
                if (result) {
                  showToast('Dummy data loaded successfully', 'success');
                  onClose();
                } else {
                  showToast('Failed to load dummy data', 'error');
                }
              }}
              style={{ justifyContent: 'center' }}
            >
              Load Dummy Data
            </TactileButton>
          </div>
        )}
      </div>
    </Modal>
  );
};
