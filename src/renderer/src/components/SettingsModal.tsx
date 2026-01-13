import React, { useState, useEffect } from 'react';
import { Modal } from './Modal';
import { TactileButton } from './TactileButton';
import { useToast } from './Toast';

type Props = {
    isOpen: boolean;
    onClose: () => void;
    isSyncing: boolean;
    onSync: () => void;
    onImportGroups: () => Promise<boolean>;
    onImportContacts: () => Promise<boolean>;
    onImportServers: () => Promise<{ success: boolean; message?: string } | boolean>;
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
    onImportGroups,
    onImportContacts,
    onImportServers,
    onOpenDataManager
}) => {
    // Force re-render of path when modal opens or folder changes
    const [pathKey, setPathKey] = useState(0);

    useEffect(() => {
        if (isOpen) setPathKey(p => p + 1);
    }, [isOpen]);

    const { showToast } = useToast();

    const handleImportGroupsClick = async () => {
        const success = await onImportGroups();
        if (success) {
            showToast('Groups imported successfully', 'success');
        } else {
            // It might be cancelled, but generic error is safer than silence if it failed
            // Ideally backend returns specific error, but generic for now.
            // If purely cancelled, maybe silent is better?
            // The user agreed to "generic ones are fine".
            // If I return false on cancel, I shouldn't error.
            // But I can't distinguish.
            // I will skip error toast here to avoid "Error" on "Cancel".
        }
    };

    const handleImportContactsClick = async () => {
        const success = await onImportContacts();
        if (success) {
            showToast('Contacts imported successfully', 'success');
        }
    };

    const handleImportServersClick = async () => {
        const result = await onImportServers();
        if (result === true) {
            showToast('Servers imported successfully', 'success');
        } else if (result && typeof result === 'object' && 'message' in result && result.message && result.message !== 'Cancelled') {
            showToast(`Import failed: ${result.message}`, 'error');
        }
    };

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
            const message = e instanceof Error ? e.message : String(e);
            showToast(`Error: ${message}`, 'error');
        }
        setPathKey(p => p + 1);
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
            const message = e instanceof Error ? e.message : String(e);
            showToast(message, 'error');
        }
        setPathKey(p => p + 1);
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Settings" width="420px">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        Data Synchronization
                    </div>
                    <TactileButton
                        onClick={onSync}
                        variant="primary"
                        style={{
                            width: '100%',
                            justifyContent: 'center'
                        }}
                    >
                        {isSyncing ? (
                            <>
                                <span className="spin" style={{ width: '12px', height: '12px', border: '2px solid currentColor', borderTopColor: 'transparent', borderRadius: '50%' }} />
                                Syncing...
                            </>
                        ) : 'Sync Data Now'}
                    </TactileButton>
                </div>

                <div style={{ height: '1px', background: 'var(--border-subtle)' }} />

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        Data Management
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {onOpenDataManager && (
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
                        )}
                        <TactileButton onClick={handleImportGroupsClick} style={{ justifyContent: 'center' }}>Import Groups...</TactileButton>
                        <TactileButton onClick={handleImportContactsClick} style={{ justifyContent: 'center' }}>Import Contacts...</TactileButton>
                        <TactileButton onClick={handleImportServersClick} style={{ justifyContent: 'center' }}>Import Servers...</TactileButton>
                    </div>
                </div>

                <div style={{ height: '1px', background: 'var(--border-subtle)' }} />

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        Storage Location
                    </div>
                    <div style={{
                        fontSize: '12px',
                        color: 'var(--color-text-secondary)',
                        padding: '10px 14px',
                        background: 'rgba(0,0,0,0.2)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: '8px',
                        wordBreak: 'break-word',
                        overflowWrap: 'anywhere',
                        lineHeight: '1.5',
                        fontFamily: 'var(--font-family-mono)'
                    }}>
                        <DataPathDisplay key={pathKey} />
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                        <TactileButton onClick={handleChangeFolder} style={{ flex: 1, justifyContent: 'center' }}>Change...</TactileButton>
                        <TactileButton onClick={handleResetFolder} style={{ flex: 1, justifyContent: 'center' }}>Reset to Default</TactileButton>
                    </div>
                </div>

                <div style={{ height: '1px', background: 'var(--border-subtle)' }} />

                {import.meta.env.DEV && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
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
            <style>{`
            .spin { animation: spin 1s linear infinite; }
            @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        `}</style>
        </Modal>
    );
};
