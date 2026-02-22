import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AIChatTab } from '../AIChatTab';

const mockSetActiveService = vi.fn();
const mockHandleRefresh = vi.fn();
const mockWakeUp = vi.fn();

vi.mock('../../hooks/useAIChat', () => ({
  CHROME_USER_AGENT: 'Mozilla/5.0 (test)',
  useAIChat: () => ({
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
  }),
}));

describe('AIChatTab', () => {
  let savedApi: unknown;

  beforeEach(() => {
    savedApi = (globalThis as Record<string, unknown>).api;
    vi.clearAllMocks();
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
});
