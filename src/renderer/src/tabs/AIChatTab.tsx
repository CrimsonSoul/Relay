import React from 'react';
import { TactileButton } from '../components/TactileButton';
import { Tooltip } from '../components/Tooltip';
import { CollapsibleHeader } from '../components/CollapsibleHeader';
import { useAIChat, CHROME_USER_AGENT } from '../hooks/useAIChat';
import { SuspendedPlaceholder } from '../components/SuspendedPlaceholder';

export const AIChatTab: React.FC = () => {
  const {
    activeService,
    setActiveService,
    isLoading,
    isSuspended,
    geminiRef,
    chatgptRef,
    handleRefresh,
    wakeUp,
    AI_SERVICES,
  } = useAIChat();

  return (
    <div className="tab-layout">
      <CollapsibleHeader
        title="AI Chat"
        subtitle="Private session • Data clears when you leave"
        isCollapsed={true}
      >
        <div className="ai-service-switcher">
          {AI_SERVICES.map((service) => (
            <Tooltip key={service.id} content={`Switch to ${service.label}`}>
              <TactileButton
                onClick={() => setActiveService(service.id)}
                variant={activeService === service.id ? 'primary' : 'secondary'}
                className="ai-service-btn"
              >
                {service.label}
              </TactileButton>
            </Tooltip>
          ))}
        </div>
        <TactileButton
          onClick={handleRefresh}
          title={isLoading[activeService] ? 'Refreshing' : 'Refresh'}
          icon={
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={isLoading[activeService] ? 'animate-spin' : ''}
            >
              <path d="M23 4v6h-6" />
              <path d="M1 20v-6h6" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
          }
        />
      </CollapsibleHeader>

      <div className="webview-container">
        <div className="webview-border-overlay" />
        {!isSuspended.gemini ? (
          <webview
            ref={geminiRef}
            src={AI_SERVICES[0].url}
            partition="ai-chat-session"
            useragent={CHROME_USER_AGENT}
            title="Gemini AI Chat"
            webpreferences="contextIsolation=yes, nodeIntegration=no"
            className="webview-frame webview-frame--absolute"
            style={{ visibility: activeService === 'gemini' ? 'visible' : 'hidden' }}
          />
        ) : (
          activeService === 'gemini' && (
            <SuspendedPlaceholder service="Gemini" onWakeUp={() => wakeUp('gemini')} />
          )
        )}
        {!isSuspended.chatgpt ? (
          <webview
            ref={chatgptRef}
            src={AI_SERVICES[1].url}
            partition="ai-chat-session"
            useragent={CHROME_USER_AGENT}
            title="ChatGPT AI Chat"
            webpreferences="contextIsolation=yes, nodeIntegration=no"
            className="webview-frame webview-frame--absolute"
            style={{ visibility: activeService === 'chatgpt' ? 'visible' : 'hidden' }}
          />
        ) : (
          activeService === 'chatgpt' && (
            <SuspendedPlaceholder service="ChatGPT" onWakeUp={() => wakeUp('chatgpt')} />
          )
        )}
      </div>
    </div>
  );
};
