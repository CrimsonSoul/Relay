import React, { useRef, useState, useEffect } from 'react';
import type { WebviewTag } from 'electron';
import { ToolbarButton } from '../components/ToolbarButton';
import { Tooltip } from '../components/Tooltip';
import { CollapsibleHeader } from '../components/CollapsibleHeader';

type AIService = 'gemini' | 'chatgpt';

const AI_SERVICES: { id: AIService; label: string; url: string }[] = [
    { id: 'gemini', label: 'Gemini', url: 'https://gemini.google.com/app' },
    { id: 'chatgpt', label: 'ChatGPT', url: 'https://chatgpt.com' },
];

const SUSPENSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

// Chrome user agent to ensure sites treat webview as a regular browser
const CHROME_USER_AGENT =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export const AIChatTab: React.FC = () => {
    const [activeService, setActiveService] = useState<AIService>('gemini');
    const [isLoading, setIsLoading] = useState<Record<AIService, boolean>>({
        gemini: false,
        chatgpt: false,
    });

    const geminiRef = useRef<WebviewTag>(null);
    const chatgptRef = useRef<WebviewTag>(null);

    // Suspension tracking
    const [lastActive, setLastActive] = useState<Record<AIService, number>>({
        gemini: Date.now(),
        chatgpt: Date.now(),
    });
    const [isSuspended, setIsSuspended] = useState<Record<AIService, boolean>>({
        gemini: false,
        chatgpt: false,
    });

    const getWebviewRef = (service: AIService) => {
        return service === 'gemini' ? geminiRef : chatgptRef;
    };

    // Attach webview event listeners
    useEffect(() => {
        const gemini = geminiRef.current;
        const chatgpt = chatgptRef.current;

        const handleGeminiLoadStart = () => setIsLoading(prev => ({ ...prev, gemini: true }));
        const handleGeminiLoadStop = () => setIsLoading(prev => ({ ...prev, gemini: false }));
        const handleChatgptLoadStart = () => setIsLoading(prev => ({ ...prev, chatgpt: true }));
        const handleChatgptLoadStop = () => setIsLoading(prev => ({ ...prev, chatgpt: false }));

        gemini?.addEventListener('did-start-loading', handleGeminiLoadStart);
        gemini?.addEventListener('did-stop-loading', handleGeminiLoadStop);
        chatgpt?.addEventListener('did-start-loading', handleChatgptLoadStart);
        chatgpt?.addEventListener('did-stop-loading', handleChatgptLoadStop);

        return () => {
            gemini?.removeEventListener('did-start-loading', handleGeminiLoadStart);
            gemini?.removeEventListener('did-stop-loading', handleGeminiLoadStop);
            chatgpt?.removeEventListener('did-start-loading', handleChatgptLoadStart);
            chatgpt?.removeEventListener('did-stop-loading', handleChatgptLoadStop);
        };
    }, [isSuspended]); // Re-attach when webviews mount/unmount

    // Update last active time when switching service
    useEffect(() => {
        setLastActive(prev => ({ ...prev, [activeService]: Date.now() }));
        setIsSuspended(prev => ({ ...prev, [activeService]: false }));
    }, [activeService]);

    // Check for suspension candidate every minute
    useEffect(() => {
        const interval = setInterval(() => {
            const now = Date.now();
            setIsSuspended(prev => {
                const next = { ...prev };
                let changed = false;
                for (const service of AI_SERVICES) {
                    if (service.id !== activeService && !prev[service.id]) {
                        if (now - lastActive[service.id] > SUSPENSION_TIMEOUT_MS) {
                            next[service.id] = true;
                            changed = true;
                        }
                    }
                }
                return changed ? next : prev;
            });
        }, 60000);
        return () => clearInterval(interval);
    }, [activeService, lastActive]);

    const handleRefresh = () => {
        const webview = getWebviewRef(activeService).current;
        if (webview) {
            webview.reloadIgnoringCache();
        }
    };

    return (
        <div
            style={{
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                padding: '20px 24px 24px 24px',
                background: 'var(--color-bg-app)',
                overflow: 'hidden',
            }}
        >
            {/* Header with integrated tab switcher */}
            <CollapsibleHeader
                title="AI Chat"
                subtitle="Private session • Data clears when you leave"
                isCollapsed={true}
            >
                {/* Service Tabs */}
                <div style={{ display: 'flex', gap: '4px', marginRight: '12px' }}>
                    {AI_SERVICES.map((service) => (
                        <Tooltip key={service.id} content={`Switch to ${service.label}`}>
                            <button
                                onClick={() => setActiveService(service.id)}
                                style={{
                                    padding: '6px 14px',
                                    fontSize: '11px',
                                    fontWeight: 700,
                                    textTransform: 'uppercase',
                                    letterSpacing: '0.05em',
                                    background:
                                        activeService === service.id
                                            ? 'var(--color-accent-blue)'
                                            : 'rgba(255, 255, 255, 0.05)',
                                    color:
                                        activeService === service.id
                                            ? 'white'
                                            : 'var(--color-text-tertiary)',
                                    border: 'none',
                                    borderRadius: '6px',
                                    cursor: 'pointer',
                                    transition: 'all 0.2s ease',
                                }}
                                onMouseEnter={(e) => {
                                    if (activeService !== service.id) {
                                        e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
                                        e.currentTarget.style.color = 'var(--color-text-secondary)';
                                    }
                                }}
                                onMouseLeave={(e) => {
                                    if (activeService !== service.id) {
                                        e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                                        e.currentTarget.style.color = 'var(--color-text-tertiary)';
                                    }
                                }}
                            >
                                {service.label}
                            </button>
                        </Tooltip>
                    ))}
                </div>

                <ToolbarButton
                    onClick={handleRefresh}
                    label={isLoading[activeService] ? 'LOADING' : 'REFRESH'}
                    tooltip="Reload current AI service"
                    style={{ padding: '8px 16px', fontSize: '11px' }}
                    icon={
                        <svg
                            width="12"
                            height="12"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            style={{
                                animation: isLoading[activeService]
                                    ? 'spin 1s linear infinite'
                                    : 'none',
                            }}
                        >
                            <path d="M23 4v6h-6" />
                            <path d="M1 20v-6h6" />
                            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                        </svg>
                    }
                />
            </CollapsibleHeader>

            {/* Webview Container */}
            <div
                style={{
                    flex: 1,
                    position: 'relative',
                    background: 'black',
                    overflow: 'hidden',
                    borderRadius: '12px',
                    // Force the GPU to clip the webview using a mask-image hack
                    WebkitMaskImage: '-webkit-radial-gradient(white, black)',
                    maskImage: 'radial-gradient(white, black)',
                    transform: 'translateZ(0)',
                }}
            >
                {/* 
                   CRITICAL: Border Overlay (The "Choke")
                   We use a border + a tiny box-shadow to "thicken" the mask 
                   and ensure it perfectly covers the aliased edges of the webview.
                */}
                <div style={{
                    position: 'absolute',
                    inset: 0,
                    borderRadius: '12px',
                    border: '1px solid var(--border-subtle)',
                    boxShadow: '0 0 0 0.5px var(--border-subtle)', // Choke the edge
                    pointerEvents: 'none',
                    zIndex: 10,
                }} />

                {/* Gemini Webview - Suspended if inactive long enough */}
                {!isSuspended.gemini ? (
                    <webview
                        ref={geminiRef}
                        src={AI_SERVICES[0].url}
                        partition="ai-chat-session"
                        useragent={CHROME_USER_AGENT}
                        style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            width: '100%',
                            height: '100%',
                            border: 'none',
                            background: 'transparent', // Prevent white bleed
                            visibility: activeService === 'gemini' ? 'visible' : 'hidden',
                        }}
                    />
                ) : (
                    <div style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: '100%',
                        display: activeService === 'gemini' ? 'flex' : 'none',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: '#0B0D12',
                        color: 'var(--color-text-secondary)',
                    }}>
                        <div style={{ fontSize: '24px', marginBottom: '16px' }}>💤</div>
                        <div style={{ fontSize: '14px', marginBottom: '24px' }}>Gemini is sleeping to save power</div>
                        <ToolbarButton
                            label="WAKE UP"
                            variant="primary"
                            onClick={() => setIsSuspended(prev => ({ ...prev, gemini: false }))}
                        />
                    </div>
                )}

                {/* ChatGPT Webview - Suspended if inactive long enough */}
                {!isSuspended.chatgpt ? (
                    <webview
                        ref={chatgptRef}
                        src={AI_SERVICES[1].url}
                        partition="ai-chat-session"
                        useragent={CHROME_USER_AGENT}
                        style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            width: '100%',
                            height: '100%',
                            border: 'none',
                            background: 'transparent', // Prevent white bleed
                            visibility: activeService === 'chatgpt' ? 'visible' : 'hidden',
                        }}
                    />
                ) : (
                    <div style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: '100%',
                        display: activeService === 'chatgpt' ? 'flex' : 'none',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: '#0B0D12',
                        color: 'var(--color-text-secondary)',
                    }}>
                        <div style={{ fontSize: '24px', marginBottom: '16px' }}>💤</div>
                        <div style={{ fontSize: '14px', marginBottom: '24px' }}>ChatGPT is sleeping to save power</div>
                        <ToolbarButton
                            label="WAKE UP"
                            variant="primary"
                            onClick={() => setIsSuspended(prev => ({ ...prev, chatgpt: false }))}
                        />
                    </div>
                )}
            </div>

            <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
        </div>
    );
};
