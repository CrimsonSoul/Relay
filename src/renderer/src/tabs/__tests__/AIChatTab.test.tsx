import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AIChatTab } from '../AIChatTab';

const mockSetActiveService = vi.fn();
const mockHandleRefresh = vi.fn();
const mockWakeUp = vi.fn();

let aiChatState = {
  activeService: 'gemini' as 'gemini' | 'chatgpt',
  setActiveService: mockSetActiveService,
  isLoading: { gemini: false, chatgpt: false },
  isSuspended: { gemini: false, chatgpt: false },
  geminiRef: { current: null },
  chatgptRef: { current: null },
  handleRefresh: mockHandleRefresh,
  wakeUp: mockWakeUp,
  AI_SERVICES: [
    { id: 'gemini', label: 'Gemini', url: 'https://gemini.google.com' },
    { id: 'chatgpt', label: 'ChatGPT', url: 'https://chat.openai.com' },
  ],
};

vi.mock('../../hooks/useAIChat', () => ({
  CHROME_USER_AGENT: 'Mozilla/5.0 (test)',
  useAIChat: () => aiChatState,
}));

vi.mock('../../components/SuspendedPlaceholder', () => ({
  SuspendedPlaceholder: ({ service, onWakeUp }: { service: string; onWakeUp: () => void }) => (
    <div data-testid={`suspended-${service.toLowerCase()}`}>
      <button onClick={onWakeUp}>wake-{service}</button>
    </div>
  ),
}));

describe('AIChatTab', () => {
  let savedApi: unknown;

  beforeEach(() => {
    savedApi = (globalThis as Record<string, unknown>).api;
    vi.clearAllMocks();
    aiChatState = {
      activeService: 'gemini',
      setActiveService: mockSetActiveService,
      isLoading: { gemini: false, chatgpt: false },
      isSuspended: { gemini: false, chatgpt: false },
      geminiRef: { current: null },
      chatgptRef: { current: null },
      handleRefresh: mockHandleRefresh,
      wakeUp: mockWakeUp,
      AI_SERVICES: [
        { id: 'gemini', label: 'Gemini', url: 'https://gemini.google.com' },
        { id: 'chatgpt', label: 'ChatGPT', url: 'https://chat.openai.com' },
      ],
    };
  });

  afterEach(() => {
    if (savedApi === undefined) {
      delete (globalThis as Record<string, unknown>).api;
    } else {
      (globalThis as Record<string, unknown>).api = savedApi;
    }
  });

  it('renders fallback message when api is not available', () => {
    delete (globalThis as Record<string, unknown>).api;
    render(<AIChatTab />);
    expect(screen.getByText('AI Chat is available in the desktop app only')).toBeInTheDocument();
  });

  it('renders service switcher buttons when api is available', () => {
    (globalThis as Record<string, unknown>).api = {};
    render(<AIChatTab />);
    expect(screen.getByText('Gemini')).toBeInTheDocument();
    expect(screen.getByText('ChatGPT')).toBeInTheDocument();
  });

  it('renders refresh button when api is available', () => {
    (globalThis as Record<string, unknown>).api = {};
    render(<AIChatTab />);
    expect(screen.getByTitle('Refresh')).toBeInTheDocument();
  });

  it('calls setActiveService when a service button is clicked', () => {
    (globalThis as Record<string, unknown>).api = {};
    render(<AIChatTab />);
    fireEvent.click(screen.getByText('ChatGPT'));
    expect(mockSetActiveService).toHaveBeenCalledWith('chatgpt');
  });

  it('calls handleRefresh when refresh button is clicked', () => {
    (globalThis as Record<string, unknown>).api = {};
    render(<AIChatTab />);
    const refreshBtn = screen.getByTitle('Refresh');
    fireEvent.click(refreshBtn);
    expect(mockHandleRefresh).toHaveBeenCalled();
  });

  it('collapses and expands the overlay controls', () => {
    (globalThis as Record<string, unknown>).api = {};
    render(<AIChatTab />);

    expect(screen.getByText('Gemini')).toBeInTheDocument();
    expect(screen.getByTitle('Refresh')).toBeInTheDocument();

    fireEvent.click(screen.getByTitle('Collapse chat controls'));

    expect(screen.queryByText('Gemini')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Refresh')).not.toBeInTheDocument();
    expect(screen.getByTitle('Expand chat controls')).toBeInTheDocument();

    fireEvent.click(screen.getByTitle('Expand chat controls'));

    expect(screen.getByText('Gemini')).toBeInTheDocument();
    expect(screen.getByTitle('Refresh')).toBeInTheDocument();
  });

  it('renders Gemini suspended placeholder and wakes it', () => {
    (globalThis as Record<string, unknown>).api = {};
    aiChatState = {
      ...aiChatState,
      activeService: 'gemini',
      isSuspended: { gemini: true, chatgpt: false },
    };

    render(<AIChatTab />);
    expect(screen.getByTestId('suspended-gemini')).toBeInTheDocument();
    fireEvent.click(screen.getByText('wake-Gemini'));
    expect(mockWakeUp).toHaveBeenCalledWith('gemini');
  });

  it('renders ChatGPT suspended placeholder and wakes it', () => {
    (globalThis as Record<string, unknown>).api = {};
    aiChatState = {
      ...aiChatState,
      activeService: 'chatgpt',
      isSuspended: { gemini: false, chatgpt: true },
    };

    render(<AIChatTab />);
    expect(screen.getByTestId('suspended-chatgpt')).toBeInTheDocument();
    fireEvent.click(screen.getByText('wake-ChatGPT'));
    expect(mockWakeUp).toHaveBeenCalledWith('chatgpt');
  });
});
