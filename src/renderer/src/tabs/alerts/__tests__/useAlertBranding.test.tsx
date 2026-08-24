import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAlertBranding } from '../useAlertBranding';

describe('useAlertBranding', () => {
  afterEach(() => {
    delete globalThis.api;
  });

  it('loads and updates persistent header and footer logos', async () => {
    globalThis.api = {
      getCompanyLogo: vi.fn(async () => 'data:image/png;base64,header'),
      getFooterLogo: vi.fn(async () => 'data:image/png;base64,footer'),
      saveCompanyLogo: vi.fn(async () => ({
        success: true,
        data: 'data:image/png;base64,new-header',
      })),
      removeFooterLogo: vi.fn(async () => ({ success: true })),
    } as never;
    const showToast = vi.fn();
    const { result } = renderHook(() => useAlertBranding(showToast));
    await waitFor(() => expect(result.current.logoDataUrl).toContain('header'));
    await waitFor(() => expect(result.current.footerLogoDataUrl).toContain('footer'));

    await act(() => result.current.setLogo());
    await act(() => result.current.removeFooterLogo());

    expect(result.current.logoDataUrl).toContain('new-header');
    expect(result.current.footerLogoDataUrl).toBeNull();
    expect(showToast).toHaveBeenCalledWith('Logo saved', 'success');
  });
});
