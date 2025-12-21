import React, { useState, useRef, useEffect } from 'react';
import { TactileButton } from './TactileButton';

type SettingsMenuProps = {
  onOpenGroups: () => void;
  onOpenContacts: () => void;
  onImportGroups: () => void;
  onImportContacts: () => void;
};

export const SettingsMenu = ({
  onOpenGroups,
  onOpenContacts,
  onImportGroups,
  onImportContacts
}: SettingsMenuProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [dataPath, setDataPath] = useState<string>('');
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      // Fetch path
      window.api?.getDataPath().then(setDataPath);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const handleAction = (action: () => void) => {
    action();
    setIsOpen(false);
  };

  const handleChangeFolder = async () => {
    await window.api?.changeDataFolder();
    window.api?.getDataPath().then(setDataPath);
    // App handles hot swap, no restart needed
  };

  return (
    <div className="settings-menu-container" ref={menuRef} style={{ position: 'relative' }}>
      <TactileButton
        onClick={() => setIsOpen(!isOpen)}
        variant="secondary"
        active={isOpen}
      >
        Settings
      </TactileButton>

      {isOpen && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 8px)',
          right: 0,
          width: '200px',
          background: '#0b0d12',
          border: '1px solid var(--color-border)',
          borderRadius: '8px',
          boxShadow: '0 10px 40px rgba(0,0,0,0.5)',
          zIndex: 100,
          // overflow: 'hidden', // Removing to prevent clipping of button hover effects (shadow/scale)
          backdropFilter: 'blur(20px)'
        }}>
          <div style={{ padding: '8px' }}> {/* Increased padding to separate content slightly */}
            {/* Data Location */}
            <div style={{
              padding: '8px 12px 4px',
              fontSize: '10px',
              fontWeight: 600,
              color: 'var(--text-tertiary)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em'
            }}>
              Data Storage
            </div>
            <div style={{ padding: '4px 12px 8px', fontSize: '11px', color: 'var(--text-secondary)', wordBreak: 'break-all', opacity: 0.7 }}>
              {dataPath || 'Loading...'}
            </div>
            <TactileButton
              onClick={handleChangeFolder}
              variant="ghost"
              block
              style={{
                borderRadius: '4px',
                textTransform: 'none',
                justifyContent: 'flex-start',
                fontSize: '13px',
                fontWeight: 500,
                color: 'var(--text-secondary)'
              }}
            >
              Change Folder...
            </TactileButton>
            <TactileButton
              onClick={async () => {
                await window.api?.resetDataFolder();
                window.api?.getDataPath().then(setDataPath);
              }}
              variant="ghost"
              block
              style={{
                borderRadius: '4px',
                textTransform: 'none',
                justifyContent: 'flex-start',
                fontSize: '13px',
                fontWeight: 500,
                color: 'var(--text-secondary)'
              }}
            >
              Reset to Default
            </TactileButton>

            <div style={{ height: '1px', background: 'var(--color-border)', margin: '4px 8px' }} />

            <div style={{
              padding: '8px 12px 4px',
              fontSize: '10px',
              fontWeight: 600,
              color: 'var(--text-tertiary)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em'
            }}>
              Groups
            </div>
            <TactileButton
              onClick={() => handleAction(onOpenGroups)}
              variant="ghost"
              block
              style={{
                borderRadius: '4px',
                textTransform: 'none',
                justifyContent: 'flex-start',
                fontSize: '13px',
                fontWeight: 500,
                color: 'var(--text-secondary)'
              }}
            >
              Open File
            </TactileButton>
            <TactileButton
              onClick={() => handleAction(onImportGroups)}
              variant="ghost"
              block
              style={{
                borderRadius: '4px',
                textTransform: 'none',
                justifyContent: 'flex-start',
                fontSize: '13px',
                fontWeight: 500,
                color: 'var(--text-secondary)'
              }}
            >
              Import File...
            </TactileButton>

            <div style={{ height: '1px', background: 'var(--color-border)', margin: '4px 8px' }} />

            <div style={{
              padding: '4px 12px 4px',
              fontSize: '10px',
              fontWeight: 600,
              color: 'var(--text-tertiary)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em'
            }}>
              Contacts
            </div>
            <TactileButton
              onClick={() => handleAction(onOpenContacts)}
              variant="ghost"
              block
              style={{
                borderRadius: '4px',
                textTransform: 'none',
                justifyContent: 'flex-start',
                fontSize: '13px',
                fontWeight: 500,
                color: 'var(--text-secondary)'
              }}
            >
              Open File
            </TactileButton>
            <TactileButton
              onClick={() => handleAction(onImportContacts)}
              variant="ghost"
              block
              style={{
                borderRadius: '4px',
                textTransform: 'none',
                justifyContent: 'flex-start',
                fontSize: '13px',
                fontWeight: 500,
                color: 'var(--text-secondary)'
              }}
            >
              Import File...
            </TactileButton>
          </div>
        </div>
      )}
    </div>
  );
};
