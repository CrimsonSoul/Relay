import React, { useState, useEffect, useRef } from 'react';
import { TactileButton } from './components/TactileButton';
import { AssemblerTab } from './tabs/AssemblerTab';
import { DirectoryTab } from './tabs/DirectoryTab';
import { RadarTab } from './tabs/RadarTab';
import { AuthModal } from './components/AuthModal';
import { AppData, Contact, GroupMap, AuthRequest } from '@shared/ipc';

const RotatingCode = () => {
  const [currentCode, setCurrentCode] = useState('000000');
  const [prevCode, setPrevCode] = useState('------');
  const [progressKey, setProgressKey] = useState(0);

  const generateCode = () => {
    const array = new Uint32Array(1);
    window.crypto.getRandomValues(array);
    return (array[0] % 1000000).toString().padStart(6, '0');
  };

  useEffect(() => {
    setCurrentCode(generateCode());
    const interval = setInterval(() => {
      setPrevCode(currentCode);
      setCurrentCode(generateCode());
      setProgressKey(k => k + 1);
    }, 300000);
    return () => clearInterval(interval);
  }, [currentCode]);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <div style={{ width: '100px', height: '4px', background: '#333', borderRadius: '2px', overflow: 'hidden' }}>
        <div key={progressKey} style={{ height: '100%', background: 'var(--accent-primary)', width: '0%', animation: 'progress 300s linear' }} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', lineHeight: '1' }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-secondary)', marginBottom: '2px' }}>
          PREV: {prevCode}
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '24px', color: 'var(--accent-primary)', letterSpacing: '0.1em', textShadow: '0 0 10px rgba(255, 215, 0, 0.3)' }}>
          {currentCode}
        </div>
      </div>
    </div>
  );
};

const WorldClock = () => {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const formatTime = (tz: string) => {
    return time.toLocaleTimeString('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: true });
  };

  return (
    <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
      <div style={{ display: 'flex', gap: '12px', textAlign: 'right' }}>
        {[
          { label: 'PT', tz: 'America/Los_Angeles' },
          { label: 'MT', tz: 'America/Denver' },
          { label: 'ET', tz: 'America/New_York' }
        ].map(({ label, tz }) => (
          <div key={label}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '14px', color: 'var(--text-secondary)' }}>{formatTime(tz)}</div>
            <div style={{ fontFamily: 'var(--font-serif)', fontSize: '10px', color: 'var(--text-secondary)', opacity: 0.7 }}>{label}</div>
          </div>
        ))}
      </div>
      <div style={{ textAlign: 'right', paddingLeft: '16px', borderLeft: '1px solid rgba(255,255,255,0.1)' }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '24px', color: 'var(--text-primary)', lineHeight: 1 }}>{formatTime('America/Chicago')}</div>
        <div style={{ fontFamily: 'var(--font-serif)', fontSize: '12px', color: 'var(--accent-primary)', marginTop: '4px' }}>CENTRAL</div>
        <div style={{ fontFamily: 'var(--font-serif)', fontSize: '10px', color: 'var(--text-secondary)', marginTop: '2px' }}>
          {time.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        </div>
      </div>
    </div>
  );
};

export default function App() {
  const [activeTab, setActiveTab] = useState<'Assembler' | 'Directory' | 'Radar'>('Assembler');
  const [data, setData] = useState<AppData>({ groups: {}, contacts: [], lastUpdated: 0 });
  const [authRequest, setAuthRequest] = useState<AuthRequest | null>(null);
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [manualAdds, setManualAdds] = useState<string[]>([]);
  const [manualRemoves, setManualRemoves] = useState<string[]>([]);
  const [isReloading, setIsReloading] = useState(false);

  const handleOpenGroupsFile = () => {
    window.api?.openGroupsFile();
  };

  const handleOpenContactsFile = () => {
    window.api?.openContactsFile();
  };

  useEffect(() => {
    window.api.subscribeToData((newData) => {
      setData(newData);
      setIsReloading(false);
    });
    window.api.onAuthRequested((req) => {
      setAuthRequest(req);
    });
    return () => {
      if (glowTimeout.current) {
        clearTimeout(glowTimeout.current);
      }
    };
  }, []);

  const formatLastUpdated = () => {
    if (!lastUpdated) return 'Awaiting sync';
    const date = new Date(lastUpdated);
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

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

  const handleRefresh = async () => {
    if (!window.api) return;
    try {
      setIsReloading(true);
      await window.api.reloadData();
    } catch (error) {
      console.error('Failed to refresh data', error);
      setIsReloading(false);
    }
  };

  return (
    <div className="app-shell" style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header style={{ height: '80px', background: 'var(--bg-app)', borderBottom: '1px solid rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px', position: 'relative', zIndex: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ fontFamily: 'var(--font-serif)', fontSize: '24px', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
            NOC<br />WORKSHOP
          </div>
        </div>
        <RotatingCode />
        <WorldClock />
      </header>

      <div style={{ background: '#1a1d24', borderBottom: '1px solid rgba(255,255,255,0.1)', display: 'flex', padding: '0 24px', alignItems: 'center', justifyContent: 'space-between', gap: '16px' }}>
        <div style={{ display: 'flex' }}>
          {(['Assembler', 'Directory', 'Radar'] as const).map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)} style={{ padding: '16px 24px', background: activeTab === tab ? 'var(--bg-panel)' : 'transparent', border: 'none', borderRight: '1px solid rgba(255,255,255,0.05)', borderLeft: tab === 'Assembler' ? '1px solid rgba(255,255,255,0.05)' : 'none', color: activeTab === tab ? 'var(--accent-primary)' : 'var(--text-secondary)', fontFamily: 'var(--font-serif)', fontSize: '14px', fontWeight: activeTab === tab ? 600 : 400, letterSpacing: '0.05em', textTransform: 'uppercase', cursor: 'pointer', transition: 'all 0.2s ease', position: 'relative' }}>
              {tab}
              {activeTab === tab && <div style={{ position: 'absolute', bottom: 0, left: 0, width: '100%', height: '2px', background: 'var(--accent-primary)', boxShadow: '0 -2px 8px rgba(255, 215, 0, 0.5)' }} />}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <TactileButton
            className="file-button"
            variant="secondary"
            onClick={handleOpenGroupsFile}
            style={{ padding: '10px 14px', fontSize: '12px' }}
          >
            Open groups file
          </TactileButton>
          <TactileButton
            className="file-button"
            variant="secondary"
            onClick={handleOpenContactsFile}
            style={{ padding: '10px 14px', fontSize: '12px' }}
          >
            Open contacts file
          </TactileButton>
          <TactileButton
            onClick={handleRefresh}
            variant="secondary"
            active={isReloading}
            disabled={isReloading}
            className={`refresh-button ${isReloading ? 'is-reloading' : ''}`}
            style={{ padding: '10px 14px', fontSize: '12px', minWidth: '140px', display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'center' }}
          >
            {isReloading && (
              <span
                style={{
                  width: '14px',
                  height: '14px',
                  borderRadius: '50%',
                  border: '2px solid rgba(255,255,255,0.2)',
                  borderTopColor: 'var(--accent-primary)',
                  boxShadow: '0 0 0 1px rgba(255,215,0,0.08)',
                  animation: 'spin 0.85s linear infinite, pulse 2s ease-in-out infinite',
                  display: 'inline-block'
                }}
              />
            )}
            {isReloading ? 'Refreshing...' : 'Refresh data'}
          </TactileButton>
        </div>
      </div>

      <main style={{ flex: 1, overflow: 'hidden', padding: '24px', position: 'relative' }}>
        {activeTab === 'Assembler' && (
          <AssemblerTab groups={data.groups} selectedGroups={selectedGroups} manualAdds={manualAdds} manualRemoves={manualRemoves}
            onToggleGroup={(g, active) => { if (active) setSelectedGroups(p => [...p, g]); else setSelectedGroups(p => p.filter(x => x !== g)); }}
            onAddManual={(email) => setManualAdds(p => [...p, email])}
            onRemoveManual={(email) => setManualRemoves(p => [...p, email])}
            onUndoRemove={handleUndoRemove}
            onResetManual={handleReset}
          />
        )}
        {activeTab === 'Directory' && <DirectoryTab contacts={data.contacts} onAddToAssembler={handleAddToAssembler} />}
        {activeTab === 'Radar' && <RadarTab />}
      </main>

      {authRequest && (
        <AuthModal request={authRequest}
          onClose={() => { window.api.cancelAuth(); setAuthRequest(null); }}
          onSubmit={(u, p) => { window.api.submitAuth(u, p); setAuthRequest(null); }}
        />
      )}

      <style>{`
        @keyframes progress { 0% { width: 0%; } 100% { width: 100%; } }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes pulse { 0%, 100% { opacity: 0.65; transform: scale(1); } 50% { opacity: 1; transform: scale(1.08); } }
        @keyframes sweep {
          0% { transform: translateX(-120%); opacity: 0; }
          10% { opacity: 0.35; }
          60% { opacity: 0.15; }
          100% { transform: translateX(140%); opacity: 0; }
        }

        .file-button {
          position: relative;
          overflow: hidden;
          isolation: isolate;
        }

        .file-button::after {
          content: '';
          position: absolute;
          inset: 1px;
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 1px;
          transform: translateY(6px);
          opacity: 0;
          transition: transform 160ms ease, opacity 160ms ease, border-color 160ms ease;
          pointer-events: none;
        }

        .file-button:hover::after,
        .file-button:focus-visible::after {
          transform: translateY(0);
          opacity: 1;
          border-color: rgba(255,215,0,0.25);
        }

        .file-button:focus-visible {
          outline: 1px solid rgba(255,215,0,0.4);
          outline-offset: 2px;
        }

        .refresh-button {
          position: relative;
          overflow: hidden;
          isolation: isolate;
        }

        .refresh-button::after {
          content: '';
          position: absolute;
          inset: -2px;
          background: linear-gradient(120deg, transparent 35%, rgba(255,215,0,0.15) 50%, transparent 65%);
          opacity: 0;
          transform: translateX(-120%);
          transition: opacity 180ms ease;
          pointer-events: none;
        }

        .refresh-button:hover::after {
          opacity: 1;
          animation: sweep 1.3s linear infinite;
        }

        .refresh-button.is-reloading::after {
          opacity: 1;
          animation: sweep 1s linear infinite;
        }
      `}</style>
    </div>
  );
}
