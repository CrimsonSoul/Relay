import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAlertExport } from '../useAlertExport';

const { html2canvas } = vi.hoisted(() => ({
  html2canvas: vi.fn(),
}));

vi.mock('html2canvas', () => ({ default: html2canvas }));

describe('useAlertExport', () => {
  afterEach(() => {
    html2canvas.mockReset();
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
        severityConfirmed: true,
        addHistory,
        requestFieldAttention: vi.fn(),
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
    expect(showToast).toHaveBeenCalledWith('Saved the alert image', 'success');
  });

  it.each([false, true])(
    'passes the complete alert draft into the %s runtime EML export',
    async (isWebRuntime) => {
      const card = document.createElement('div');
      document.body.appendChild(card);
      html2canvas.mockResolvedValue({
        width: 1280,
        height: 720,
        toDataURL: () => 'data:image/png;base64,QUJD',
      });
      const saveAndOpenAlertDraft = vi.fn(async (_content: string) => true);
      globalThis.api = { saveAndOpenAlertDraft } as never;
      const { result } = renderHook(() =>
        useAlertExport({
          cardRef: { current: card },
          clickThroughUrl: 'https://status.example.com/incident',
          displaySubject: 'UPDATE #3 — Checkout outage',
          isWebRuntime,
          historyDraft: {
            severity: 'ISSUE',
            subject: 'Checkout outage',
            bodyHtml: '<p>Payments are unavailable.</p>',
            sender: 'Operations',
            recipient: 'Store leaders',
          },
          severityConfirmed: true,
          updateNumber: 3,
          eventTimeStart: '2026-07-02T12:00:00.000Z',
          eventTimeEnd: '2026-07-02T13:00:00.000Z',
          addHistory: vi.fn(),
          requestFieldAttention: vi.fn(),
          showToast: vi.fn(),
        }),
      );

      await act(() => result.current.openOutlookDraft());

      const eml = saveAndOpenAlertDraft.mock.calls[0]?.[0] ?? '';
      const encodedText = eml
        .split(
          'Content-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n',
        )[1]
        ?.split('\r\n--relay_alert_')[0]
        ?.replaceAll('\r\n', '');
      const text = Buffer.from(encodedText ?? '', 'base64').toString('utf8');
      const encodedHtml = eml
        .split(
          'Content-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n',
        )[1]
        ?.split('\r\n--relay_alert_')[0]
        ?.replaceAll('\r\n', '');
      const html = Buffer.from(encodedHtml ?? '', 'base64').toString('utf8');
      for (const expected of [
        'Payments are unavailable.',
        'Operations',
        'Store leaders',
        'UPDATE #3',
        'July 2, 2026',
      ]) {
        expect(text).toContain(expected);
        expect(html).toContain(expected);
      }
    },
  );

  it.each([
    [true, '', '<p>Body</p>', 'subject', 'Add a subject before exporting'],
    [true, 'Outage', '<p><br></p>', 'body', 'Add a message body before exporting'],
    [true, '  ', '', 'subject', 'Add a subject and message body before exporting'],
    [false, 'Outage', '<p>Body</p>', 'severity', 'Choose a severity before exporting'],
    [
      false,
      '',
      '',
      'severity',
      'Choose a severity and add a subject and message body before exporting',
    ],
  ])(
    'refuses both exports when severity confirmed is %j, the subject is %j and the body is %j',
    async (severityConfirmed, subject, bodyHtml, firstMissing, message) => {
      const saveAlertImage = vi.fn();
      const saveAndOpenAlertDraft = vi.fn();
      globalThis.api = { saveAlertImage, saveAndOpenAlertDraft } as never;
      const requestFieldAttention = vi.fn();
      const showToast = vi.fn();
      const addHistory = vi.fn();
      const { result } = renderHook(() =>
        useAlertExport({
          cardRef: { current: document.createElement('div') },
          clickThroughUrl: '',
          displaySubject: subject.trim() || 'Alert Subject',
          isWebRuntime: false,
          historyDraft: { severity: 'INFO', subject, bodyHtml, sender: '', recipient: '' },
          severityConfirmed,
          addHistory,
          requestFieldAttention,
          showToast,
        }),
      );

      await act(() => result.current.saveImage());
      let opened: boolean | undefined;
      await act(async () => {
        opened = await result.current.openOutlookDraft();
      });

      expect(opened).toBe(false);
      expect(html2canvas).not.toHaveBeenCalled();
      expect(saveAlertImage).not.toHaveBeenCalled();
      expect(saveAndOpenAlertDraft).not.toHaveBeenCalled();
      expect(addHistory).not.toHaveBeenCalled();
      expect(requestFieldAttention).toHaveBeenCalledTimes(2);
      expect(requestFieldAttention).toHaveBeenLastCalledWith(firstMissing);
      expect(showToast).toHaveBeenLastCalledWith(message, 'error');
    },
  );
});
