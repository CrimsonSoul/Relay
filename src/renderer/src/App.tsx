import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Sidebar } from './components/Sidebar';
// import { SettingsMenu } from './components/SettingsMenu'; // Unused
import { WorldClock } from './components/WorldClock';
import { AssemblerTab } from './tabs/AssemblerTab';
import { DirectoryTab } from './tabs/DirectoryTab';
import { RadarTab } from './tabs/RadarTab';
import { MetricsTab } from './tabs/MetricsTab';
import { AppData, Contact } from '@shared/ipc';

// Renamed tabs
type Tab = 'Compose' | 'People' | 'Reports' | 'Live';

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('Compose');
  const [data, setData] = useState<AppData>({ groups: {}, contacts: [], lastUpdated: 0 });
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [manualAdds, setManualAdds] = useState<string[]>([]);
  const [manualRemoves, setManualRemoves] = useState<string[]>([]);
  const [isReloading, setIsReloading] = useState(false);
  const reloadStartRef = useRef<number | null>(null);
  const reloadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isReloadingRef = useRef(isReloading);

  // Sync ref
  useEffect(() => { isReloadingRef.current = isReloading; }, [isReloading]);

  const settleReloadIndicator = useCallback(() => {
    if (!reloadStartRef.current) {
      setIsReloading(false);
      return;
    }
    const elapsed = performance.now() - reloadStartRef.current;
    const delay = Math.max(900 - elapsed, 0);
    if (reloadTimeoutRef.current) clearTimeout(reloadTimeoutRef.current);
    reloadTimeoutRef.current = setTimeout(() => {
      setIsReloading(false);
      reloadStartRef.current = null;
      reloadTimeoutRef.current = null;
    }, delay);
  }, []);

  const handleOpenGroupsFile = () => window.api?.openGroupsFile();
  const handleOpenContactsFile = () => window.api?.openContactsFile();
  const handleImportGroups = async () => await window.api?.importGroupsFile();
  const handleImportContacts = async () => await window.api?.importContactsFile();

  useEffect(() => {
    if (!window.api) return;
    window.api.subscribeToData((newData) => {
      setData(newData);
      if (isReloadingRef.current) settleReloadIndicator();
    });
    window.api.onReloadStart(() => {
      reloadStartRef.current = performance.now();
      setIsReloading(true);
    });
    window.api.onReloadComplete(() => {
      if (isReloadingRef.current) settleReloadIndicator();
    });
    return () => { if (reloadTimeoutRef.current) clearTimeout(reloadTimeoutRef.current); };
  }, [settleReloadIndicator]);

  const handleAddToAssembler = (contact: Contact) => {
    setManualRemoves(prev => prev.filter(e => e !== contact.email));
    setManualAdds(prev => prev.includes(contact.email) ? prev : [...prev, contact.email]);
  };

  const handleUndoRemove = () => {
    setManualRemoves(prev => {
      const newRemoves = [...prev];
      newRemoves.pop();
      return newRemoves;
    });
  };

  const handleReset = () => {
    setSelectedGroups([]);
    setManualAdds([]);
    setManualRemoves([]);
  };

  const handleSync = async () => {
    if (isReloading) return;
    await window.api?.reloadData();
  };

  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <div style={{
      display: 'flex',
      width: '100vw',
      height: '100vh',
      background: 'var(--color-bg-app)',
      color: 'var(--color-text-primary)',
      overflow: 'hidden'
    }}>
      <Sidebar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      {/* Main Content Area */}
      <main style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        position: 'relative'
      }}>
        {/* Breadcrumb / Header Area */}
        <header style={{
          height: '64px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 32px',
          borderBottom: 'var(--border-subtle)',
          flexShrink: 0
        }}>
           <div style={{ display: 'flex', flexDirection: 'column' }}>
             <span style={{ fontSize: '12px', color: 'var(--color-text-tertiary)', fontWeight: 500 }}>
               Relay / {activeTab}
             </span>
             <span style={{ fontSize: '18px', fontWeight: 600, color: 'var(--color-text-primary)' }}>
               {activeTab === 'Compose' && 'Data Composition'}
               {activeTab === 'People' && 'Contact Directory'}
               {activeTab === 'Reports' && 'Vault Metrics'}
               {activeTab === 'Live' && 'Dispatcher Radar'}
             </span>
           </div>

           {/* Actions Area - Sync moved to Settings, only Clock here now */}
           <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
              <WorldClock />
           </div>
        </header>

        {/* Content View */}
        <div style={{
          flex: 1,
          padding: '24px 32px',
          overflowY: 'auto',
          overflowX: 'hidden'
        }}>
          {activeTab === 'Compose' && (
            <div className="animate-fade-in">
              <AssemblerTab
                groups={data.groups}
                selectedGroups={selectedGroups}
                manualAdds={manualAdds}
                manualRemoves={manualRemoves}
                onToggleGroup={(g, active) => { if (active) setSelectedGroups(p => [...p, g]); else setSelectedGroups(p => p.filter(x => x !== g)); }}
                onAddManual={(email) => setManualAdds(p => [...p, email])}
                onRemoveManual={(email) => setManualRemoves(p => [...p, email])}
                onUndoRemove={handleUndoRemove}
                onResetManual={handleReset}
              />
            </div>
          )}
          {activeTab === 'People' && (
             <div className="animate-fade-in" style={{ height: '100%' }}>
              <DirectoryTab
                contacts={data.contacts}
                onAddToAssembler={handleAddToAssembler}
              />
            </div>
          )}
          {activeTab === 'Reports' && (
             <div className="animate-fade-in">
               <MetricsTab />
             </div>
          )}
          {activeTab === 'Live' && (
            <div className="animate-fade-in" style={{ height: '100%' }}>
              <RadarTab />
            </div>
          )}
        </div>
      </main>

      {/* Settings Modal */}
      {settingsOpen && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.6)',
          backdropFilter: 'blur(4px)',
          zIndex: 100,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }} onClick={() => setSettingsOpen(false)}>
          <div onClick={e => e.stopPropagation()} style={{
            background: 'var(--color-bg-card)',
            border: 'var(--border-subtle)',
            borderRadius: '12px',
            padding: '24px',
            minWidth: '320px',
            boxShadow: '0 20px 40px rgba(0,0,0,0.6)'
          }}>
            <h3 style={{ marginTop: 0, marginBottom: '20px', fontSize: '18px' }}>Settings</h3>

            {/* Sync Button (Moved here) */}
            <div style={{ marginBottom: '16px' }}>
                <button
                    onClick={handleSync}
                    className="tactile-button"
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '8px',
                      height: '40px',
                      background: isReloading ? 'rgba(59, 130, 246, 0.1)' : 'transparent',
                      borderColor: isReloading ? 'var(--color-accent-blue)' : 'var(--border-subtle)',
                      color: isReloading ? 'var(--color-accent-blue)' : 'var(--color-text-primary)'
                    }}
                  >
                    {isReloading ? (
                        <>
                         <svg className="spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                         <span>Syncing Data...</span>
                        </>
                    ) : (
                        <>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.3"/></svg>
                        <span>Sync Now</span>
                        </>
                    )}
                  </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <button className="tactile-button" onClick={handleOpenGroupsFile}>Open Groups CSV</button>
              <button className="tactile-button" onClick={handleOpenContactsFile}>Open Contacts CSV</button>
              <div style={{ height: '1px', background: 'var(--border-subtle)', margin: '8px 0' }} />
              <button className="tactile-button" onClick={handleImportGroups}>Import Groups...</button>
              <button className="tactile-button" onClick={handleImportContacts}>Import Contacts...</button>
            </div>

            <div style={{ marginTop: '20px', textAlign: 'right' }}>
                 <button
                    onClick={() => setSettingsOpen(false)}
                    style={{ background: 'none', border: 'none', color: 'var(--color-text-tertiary)', fontSize: '12px', cursor: 'pointer' }}
                 >
                     Close
                 </button>
            </div>
          </div>
        </div>
      )}
      <style>{`
        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { 100% { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
