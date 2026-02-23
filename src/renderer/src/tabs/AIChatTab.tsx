import React from 'react';
import { TactileButton } from '../components/TactileButton';
import { Tooltip } from '../components/Tooltip';
import { useAIChat, CHROME_USER_AGENT } from '../hooks/useAIChat';
import { SuspendedPlaceholder } from '../components/SuspendedPlaceholder';

type AIServiceId = 'gemini' | 'chatgpt';

interface AIService {
  id: AIServiceId;
  label: string;
  url: string;
}

interface AIChatToolbarProps {
  isCollapsed: boolean;
  onToggleCollapsed: () => void;
  services: AIService[];
  activeService: AIServiceId;
  isLoading: Record<AIServiceId, boolean>;
  onSelectService: (id: AIServiceId) => void;
  onRefresh: () => void;
}

const AIChatToolbar: React.FC<AIChatToolbarProps> = ({
  isCollapsed,
  onToggleCollapsed,
  services,
  activeService,
  isLoading,
  onSelectService,
  onRefresh,
}) => {
  const toggleLabel = isCollapsed ? 'Expand chat controls' : 'Collapse chat controls';

  return (
    <div className={`ai-chat-toolbar${isCollapsed ? ' ai-chat-toolbar--collapsed' : ''}`}>
      <Tooltip content={toggleLabel}>
        <TactileButton
          variant="ghost"
          onClick={onToggleCollapsed}
          title={toggleLabel}
          aria-label={toggleLabel}
          aria-expanded={!isCollapsed}
          className="ai-chat-toolbar-toggle"
          icon={
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {isCollapsed ? <path d="M15 6l-6 6 6 6" /> : <path d="M9 6l6 6-6 6" />}
            </svg>
          }
        />
      </Tooltip>
      {isCollapsed ? null : (
        <>
          <div className="ai-service-switcher">
            {services.map((service) => (
              <Tooltip key={service.id} content={`Switch to ${service.label}`}>
                <TactileButton
                  onClick={() => onSelectService(service.id)}
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
            onClick={onRefresh}
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
        </>
      )}
    </div>
  );
};

interface AIServicePanelProps {
  service: AIService;
  activeService: AIServiceId;
  isSuspended: boolean;
  onWakeUp: (service: AIServiceId) => void;
  webviewRef: React.RefObject<Electron.WebviewTag | null>;
}

const AIServicePanel: React.FC<AIServicePanelProps> = ({
  service,
  activeService,
  isSuspended,
  onWakeUp,
  webviewRef,
}) => {
  const isActive = activeService === service.id;
  const webviewAttributes: Record<string, string> = {
    partition: 'ai-chat-session',
    useragent: CHROME_USER_AGENT,
    webpreferences: 'contextIsolation=yes, nodeIntegration=no',
  };

  if (isSuspended) {
    return isActive ? (
      <SuspendedPlaceholder service={service.label} onWakeUp={() => onWakeUp(service.id)} />
    ) : null;
  }

  return (
    <webview
      ref={webviewRef}
      src={service.url}
      title={`${service.label} AI Chat`}
      {...webviewAttributes}
      className={
        isActive
          ? 'webview-frame webview-frame--absolute'
          : 'webview-frame webview-frame--absolute webview-frame--hidden'
      }
    />
  );
};

export const AIChatTab: React.FC = () => {
  const [isToolbarCollapsed, setIsToolbarCollapsed] = React.useState(false);
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
        <AIChatToolbar
          isCollapsed={isToolbarCollapsed}
          onToggleCollapsed={() => setIsToolbarCollapsed((collapsed) => !collapsed)}
          services={AI_SERVICES}
          activeService={activeService}
          isLoading={isLoading}
          onSelectService={setActiveService}
          onRefresh={handleRefresh}
        />
        <AIServicePanel
          service={AI_SERVICES[0]}
          activeService={activeService}
          isSuspended={isSuspended.gemini}
          onWakeUp={wakeUp}
          webviewRef={geminiRef}
        />
        <AIServicePanel
          service={AI_SERVICES[1]}
          activeService={activeService}
          isSuspended={isSuspended.chatgpt}
          onWakeUp={wakeUp}
          webviewRef={chatgptRef}
        />
      </div>
    </div>
  );
};
