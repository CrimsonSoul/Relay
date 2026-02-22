import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useAIChat } from '../../hooks/useAIChat';

describe('useAIChat', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('initializes with gemini as active service', () => {
    const { result } = renderHook(() => useAIChat());
    expect(result.current.activeService).toBe('gemini');
  });

  it('initializes with both services not loading', () => {
    const { result } = renderHook(() => useAIChat());
    expect(result.current.isLoading.gemini).toBe(false);
    expect(result.current.isLoading.chatgpt).toBe(false);
  });

  it('initializes with both services not suspended', () => {
    const { result } = renderHook(() => useAIChat());
    expect(result.current.isSuspended.gemini).toBe(false);
    expect(result.current.isSuspended.chatgpt).toBe(false);
  });

  it('exposes AI_SERVICES list with gemini and chatgpt', () => {
    const { result } = renderHook(() => useAIChat());
    const ids = result.current.AI_SERVICES.map((s) => s.id);
    expect(ids).toContain('gemini');
    expect(ids).toContain('chatgpt');
  });

  it('setActiveService switches to chatgpt', () => {
    const { result } = renderHook(() => useAIChat());
    act(() => {
      result.current.setActiveService('chatgpt');
    });
    expect(result.current.activeService).toBe('chatgpt');
  });

  it('wakeUp unsuspends a service', () => {
    const { result } = renderHook(() => useAIChat());
    // Manually trigger suspension by advancing time far enough
    act(() => {
      // Switch away from gemini so chatgpt becomes inactive
      result.current.setActiveService('chatgpt');
    });
    // Advance past suspension timeout (30 minutes)
    act(() => {
      vi.advanceTimersByTime(31 * 60 * 1000);
    });
    act(() => {
      result.current.wakeUp('gemini');
    });
    expect(result.current.isSuspended.gemini).toBe(false);
  });

  it('exposes geminiRef and chatgptRef as refs', () => {
    const { result } = renderHook(() => useAIChat());
    expect(result.current.geminiRef).toBeDefined();
    expect(result.current.chatgptRef).toBeDefined();
  });

  it('handleRefresh does not throw when webview not mounted', () => {
    const { result } = renderHook(() => useAIChat());
    expect(() => result.current.handleRefresh()).not.toThrow();
  });

  it('suspends inactive service after 30 minutes', () => {
    const { result } = renderHook(() => useAIChat());
    act(() => {
      result.current.setActiveService('chatgpt');
    });
    // Advance > 30 min
    act(() => {
      vi.advanceTimersByTime(31 * 60 * 1000);
    });
    expect(result.current.isSuspended.gemini).toBe(true);
  });

  it('does not suspend the currently active service', () => {
    const { result } = renderHook(() => useAIChat());
    act(() => {
      result.current.setActiveService('chatgpt');
    });
    act(() => {
      vi.advanceTimersByTime(31 * 60 * 1000);
    });
    expect(result.current.isSuspended.chatgpt).toBe(false);
  });
});
