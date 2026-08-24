import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAlertExport } from '../useAlertExport';

const { html2canvas } = vi.hoisted(() => ({
  html2canvas: vi.fn(),
}));

vi.mock('html2canvas', () => ({ default: html2canvas }));

describe('useAlertExport', () => {
  afterEach(() => {
    delete globalThis.api;
    document.body.replaceChildren();
  });

  it('captures an off-screen clone and records a successful image export', async () => {
    const card = document.createElement('div');
    card.style.setProperty('--email-banner', '#1b4f72');
    card.innerHTML = '<div class="alerts-email-severity-header"></div>';
    document.body.appendChild(card);
    const canvas = {
      width: 1280,
      height: 720,
      toDataURL: vi.fn(() => 'data:image/png;base64,alert'),
    };
    html2canvas.mockResolvedValue(canvas);
    const saveAlertImage = vi.fn(async () => ({ success: true }));
    globalThis.api = { saveAlertImage } as never;
    const addHistory = vi.fn(async () => null);
    const showToast = vi.fn();
    const { result } = renderHook(() =>
      useAlertExport({
        cardRef: { current: card },
        clickThroughUrl: '',
        displaySubject: 'Database outage',
        isWebRuntime: false,
        historyDraft: {
          severity: 'ISSUE',
          subject: 'Database outage',
          bodyHtml: '<p>Investigating</p>',
          sender: 'IT',
          recipient: 'All Employees',
        },
        addHistory,
        requestOptionalFieldAttention: vi.fn(),
        showToast,
      }),
    );

    await result.current.saveImage();

    expect(saveAlertImage).toHaveBeenCalledWith(
      'data:image/png;base64,alert',
      'alert_database_outage.png',
    );
    const capturedClone = html2canvas.mock.calls[0]?.[0] as HTMLElement;
    expect(capturedClone).not.toBe(card);
    expect(capturedClone.isConnected).toBe(false);
    expect(addHistory).toHaveBeenCalledOnce();
    expect(showToast).toHaveBeenCalledWith('Saved!', 'success');
  });
});
