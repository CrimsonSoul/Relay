import React from 'react';
import { TactileButton } from '../components/TactileButton';
import { Tooltip } from '../components/Tooltip';
import { CollapsibleHeader } from '../components/CollapsibleHeader';
import { useAIChat, CHROME_USER_AGENT } from '../hooks/useAIChat';
import { SuspendedPlaceholder } from '../components/SuspendedPlaceholder';

export const AIChatTab: React.FC = () => {
  const { activeService, setActiveService, isLoading, isSuspended, geminiRef, chatgptRef, handleRefresh, wakeUp, AI_SERVICES } = useAIChat();

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: '24px 32px', background: 'transparent', overflow: 'hidden' }}>
      <CollapsibleHeader title="AI Chat" subtitle="Private session • Data clears when you leave" isCollapsed={true}>
        <div style={{ display: 'flex', gap: '8px', marginRight: '16px' }}>
          {AI_SERVICES.map((service) => (
            <Tooltip key={service.id} content={`Switch to ${service.label}`}>
              <TactileButton onClick={() => setActiveService(service.id)} variant={activeService === service.id ? 'primary' : 'secondary'} style={{ transition: 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)', minWidth: '100px' }}>{service.label}</TactileButton>
            </Tooltip>
          ))}
        </div>
        <TactileButton onClick={handleRefresh} title={isLoading[activeService] ? 'Refreshing' : 'Refresh'} icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ animation: isLoading[activeService] ? 'spin 1s linear infinite' : 'none' }}><path d="M23 4v6h-6" /><path d="M1 20v-6h6" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></svg>} />
      </CollapsibleHeader>

      <div style={{ flex: 1, position: 'relative', background: 'black', overflow: 'hidden', borderRadius: '16px', WebkitMaskImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100%25' height='100%25'%3E%3Crect x='0' y='0' width='100%25' height='100%25' rx='16' ry='16' fill='white' /%3E%3C/svg%3E")`, maskImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100%25' height='100%25'%3E%3Crect x='0' y='0' width='100%25' height='100%25' rx='16' ry='16' fill='white' /%3E%3C/svg%3E")`, transform: 'translateZ(0)' }}>
        <div style={{ position: 'absolute', inset: 0, borderRadius: '16px', border: '1px solid rgba(255,255,255,0.06)', boxShadow: '0 0 0 1px rgba(0,0,0,0.5)', pointerEvents: 'none', zIndex: 10 }} />
        {!isSuspended.gemini ? (
          <webview ref={geminiRef} src={AI_SERVICES[0].url} partition="ai-chat-session" useragent={CHROME_USER_AGENT} title="Gemini AI Chat" webpreferences="contextIsolation=yes, nodeIntegration=no" style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 'none', background: 'transparent', visibility: activeService === 'gemini' ? 'visible' : 'hidden' }} />
        ) : activeService === 'gemini' && <SuspendedPlaceholder service="Gemini" onWakeUp={() => wakeUp('gemini')} />}
        {!isSuspended.chatgpt ? (
          <webview ref={chatgptRef} src={AI_SERVICES[1].url} partition="ai-chat-session" useragent={CHROME_USER_AGENT} title="ChatGPT AI Chat" webpreferences="contextIsolation=yes, nodeIntegration=no" style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 'none', background: 'transparent', visibility: activeService === 'chatgpt' ? 'visible' : 'hidden' }} />
        ) : activeService === 'chatgpt' && <SuspendedPlaceholder service="ChatGPT" onWakeUp={() => wakeUp('chatgpt')} />}
      </div>
    </div>
  );
};
