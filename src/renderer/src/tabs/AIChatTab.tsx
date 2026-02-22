import React, { useEffect } from 'react';
import { TactileButton } from '../components/TactileButton';
import { Tooltip } from '../components/Tooltip';
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
  const supportsWebview = Boolean(globalThis.api);

  useEffect(() => {
    const applyWebviewAttributes = (webview: Electron.WebviewTag | null) => {
      if (!webview) return;
      webview.setAttribute('partition', 'ai-chat-session');
      webview.setAttribute('useragent', CHROME_USER_AGENT);
      webview.setAttribute('webpreferences', 'contextIsolation=yes, nodeIntegration=no');
    };

    applyWebviewAttributes(geminiRef.current);
    applyWebviewAttributes(chatgptRef.current);
  }, [geminiRef, chatgptRef, isSuspended.gemini, isSuspended.chatgpt]);

  if (!supportsWebview) {
    return (
      <div className="tab-layout tab-layout--flush">
        <div className="tab-fallback webview-unavailable">
          <div className="tab-fallback-error-icon">ℹ️</div>
          <div className="tab-fallback-message">AI Chat is available in the desktop app only</div>
        </div>
      </div>
    );
  }

  return (
    <div className="tab-layout tab-layout--flush">
      <div className="webview-container">
        <div className="webview-border-overlay" />
        <div className="ai-chat-toolbar">
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
            variant="ghost"
            onClick={handleRefresh}
            title={isLoading[activeService] ? 'Refreshing' : 'Refresh'}
            className="ai-chat-refresh-btn"
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
        </div>
        {isSuspended.gemini ? (
          activeService === 'gemini' && (
            <SuspendedPlaceholder service="Gemini" onWakeUp={() => wakeUp('gemini')} />
          )
        ) : (
          <webview
            ref={geminiRef}
            src={AI_SERVICES[0].url}
            title="Gemini AI Chat"
            className={`webview-frame webview-frame--absolute${activeService === 'gemini' ? '' : ' webview-frame--hidden'}`}
          />
        )}
        {isSuspended.chatgpt ? (
          activeService === 'chatgpt' && (
            <SuspendedPlaceholder service="ChatGPT" onWakeUp={() => wakeUp('chatgpt')} />
          )
        ) : (
          <webview
            ref={chatgptRef}
            src={AI_SERVICES[1].url}
            title="ChatGPT AI Chat"
            className={`webview-frame webview-frame--absolute${activeService === 'chatgpt' ? '' : ' webview-frame--hidden'}`}
          />
        )}
      </div>
    </div>
  );
};
