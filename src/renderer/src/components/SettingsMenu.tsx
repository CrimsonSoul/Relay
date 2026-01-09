import React from 'react';
import { TactileButton } from './TactileButton';
import { Modal } from './Modal';

const menuItemStyle = { borderRadius: '4px', textTransform: 'none' as const, justifyContent: 'flex-start' as const, fontSize: '13px', fontWeight: 500, color: 'var(--text-secondary)' };
const sectionHeaderStyle = { padding: '8px 12px 4px', fontSize: '10px', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase' as const, letterSpacing: '0.05em' };

interface MenuItemProps { label: string; onClick: () => void }
const MenuItem: React.FC<MenuItemProps> = ({ label, onClick }) => <TactileButton onClick={onClick} variant="ghost" block style={menuItemStyle}>{label}</TactileButton>;

const SectionHeader: React.FC<{ title: string }> = ({ title }) => <div style={sectionHeaderStyle}>{title}</div>;
const Divider = () => <div style={{ height: '1px', background: 'var(--color-border)', margin: '4px 8px' }} />;

interface SettingsMenuProps { onOpenGroups: () => void; onOpenContacts: () => void; onImportGroups: () => void; onImportContacts: () => void }

export const SettingsMenu: React.FC<SettingsMenuProps> = ({ onOpenGroups, onOpenContacts, onImportGroups, onImportContacts }) => {
  const [isOpen, setIsOpen] = React.useState(false);
  const [dataPath, setDataPath] = React.useState('');
  const [showDummyConfirm, setShowDummyConfirm] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setIsOpen(false); };
    if (isOpen) { document.addEventListener('mousedown', handleClickOutside); window.api?.getDataPath().then(setDataPath); }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const handleAction = (action: () => void) => { action(); setIsOpen(false); };
  const handleChangeFolder = async () => { await window.api?.changeDataFolder(); window.api?.getDataPath().then(setDataPath); };
  const handleReset = async () => { await window.api?.resetDataFolder(); window.api?.getDataPath().then(setDataPath); };
  
  const handleGenerateDummyData = async () => { 
    setShowDummyConfirm(true);
    setIsOpen(false);
  };
  
  const confirmGenerateDummyData = async () => {
    await window.api?.generateDummyData();
    setShowDummyConfirm(false);
  };

  return (
    <div ref={menuRef} style={{ position: 'relative' }}>
      <TactileButton onClick={() => setIsOpen(!isOpen)} variant="secondary" active={isOpen}>Settings</TactileButton>
      {isOpen && (
        <div style={{ position: 'absolute', top: 'calc(100% + 8px)', right: 0, width: '200px', background: '#0b0d12', border: '1px solid var(--color-border)', borderRadius: '8px', boxShadow: '0 10px 40px rgba(0,0,0,0.5)', zIndex: 100, backdropFilter: 'blur(20px)', padding: '8px' }}>
          <SectionHeader title="Data Storage" />
          <div style={{ padding: '4px 12px 8px', fontSize: '11px', color: 'var(--text-secondary)', wordBreak: 'break-all', opacity: 0.7 }}>{dataPath || 'Loading...'}</div>
          <MenuItem label="Change Folder..." onClick={handleChangeFolder} />
          <MenuItem label="Reset to Default" onClick={handleReset} />
          <MenuItem label="Generate Dummy Data" onClick={handleGenerateDummyData} />
          <Divider />
          <SectionHeader title="Groups" />
          <MenuItem label="Open File" onClick={() => handleAction(onOpenGroups)} />
          <MenuItem label="Import File..." onClick={() => handleAction(onImportGroups)} />
          <Divider />
          <SectionHeader title="Contacts" />
          <MenuItem label="Open File" onClick={() => handleAction(onOpenContacts)} />
          <MenuItem label="Import File..." onClick={() => handleAction(onImportContacts)} />
        </div>
      )}
      
      <Modal isOpen={showDummyConfirm} onClose={() => setShowDummyConfirm(false)} title="Generate Dummy Data" width="400px">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ fontSize: '14px', color: 'var(--color-text-secondary)', lineHeight: '1.5' }}>
            This will <strong style={{ color: 'var(--color-danger)' }}>overwrite</strong> all your current contacts and groups with random test data. This action cannot be undone.
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
            <TactileButton onClick={() => setShowDummyConfirm(false)}>Cancel</TactileButton>
            <TactileButton onClick={confirmGenerateDummyData} variant="secondary" style={{ color: 'var(--color-danger)', borderColor: 'var(--color-danger)' }}>Overwrite Data</TactileButton>
          </div>
        </div>
      </Modal>
    </div>
  );
};
