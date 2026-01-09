import { useRef, useState, useEffect } from 'react';
import type { WebviewTag } from 'electron';

type AIService = 'gemini' | 'chatgpt';

const AI_SERVICES: { id: AIService; label: string; url: string }[] = [
  { id: 'gemini', label: 'Gemini', url: 'https://gemini.google.com/app' },
  { id: 'chatgpt', label: 'ChatGPT', url: 'https://chatgpt.com' },
];

const SUSPENSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

export const CHROME_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export function useAIChat() {
  const [activeService, setActiveService] = useState<AIService>('gemini');
  const [isLoading, setIsLoading] = useState<Record<AIService, boolean>>({ gemini: false, chatgpt: false });
  const [lastActive, setLastActive] = useState<Record<AIService, number>>({ gemini: Date.now(), chatgpt: Date.now() });
  const [isSuspended, setIsSuspended] = useState<Record<AIService, boolean>>({ gemini: false, chatgpt: false });

  const geminiRef = useRef<WebviewTag>(null);
  const chatgptRef = useRef<WebviewTag>(null);

  const getWebviewRef = (service: AIService) => service === 'gemini' ? geminiRef : chatgptRef;

  // Attach webview event listeners
  useEffect(() => {
    const gemini = geminiRef.current, chatgpt = chatgptRef.current;
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
  }, [isSuspended]);

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
        const next = { ...prev }; let changed = false;
        for (const service of AI_SERVICES) {
          if (service.id !== activeService && !prev[service.id] && now - lastActive[service.id] > SUSPENSION_TIMEOUT_MS) {
            next[service.id] = true; changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 60000);
    return () => clearInterval(interval);
  }, [activeService, lastActive]);

  const handleRefresh = () => { const webview = getWebviewRef(activeService).current; webview?.reloadIgnoringCache(); };
  const wakeUp = (service: AIService) => setIsSuspended(prev => ({ ...prev, [service]: false }));

  return { activeService, setActiveService, isLoading, isSuspended, geminiRef, chatgptRef, handleRefresh, wakeUp, AI_SERVICES };
}

export type { AIService };
