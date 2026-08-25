// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createBrowserActions, sanitizeDownloadName } from './browserActions';

describe('browser actions', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('opens only normalized HTTP(S) URLs without an opener', () => {
    const opened = { opener: {} as unknown };
    const openWindow = vi.fn(() => opened as Window);
    const actions = createBrowserActions({ openWindow });

    expect(actions.openExternal(' HTTPS://Example.com/path ')).toBe(true);
    expect(openWindow).toHaveBeenCalledWith(
      'https://example.com/path',
      '_blank',
      'noopener,noreferrer',
    );
    expect(opened.opener).toBeNull();
    expect(actions.openExternal('javascript:alert(1)')).toBe(false);
    expect(actions.openExternal('https://user:pass@example.com')).toBe(false);
    expect(openWindow).toHaveBeenCalledTimes(1);
  });

  it('copies with synchronous selection and removes the temporary field on success', () => {
    const executeCopy = vi.fn(() => true);
    const actions = createBrowserActions({ executeCopy });

    expect(actions.writeClipboard('Exact bridge details')).toBe(true);
    expect(executeCopy).toHaveBeenCalledWith('copy');
    expect(document.querySelector('[data-relay-copy-fallback]')).toBeNull();
  });

  it('leaves exact selected text visible with instructions when browser copy is blocked', () => {
    const actions = createBrowserActions({ executeCopy: () => false });

    expect(actions.writeClipboard('Exact bridge details')).toBe(false);
    const fallback = document.querySelector<HTMLTextAreaElement>('[data-relay-copy-fallback]');
    expect(fallback?.value).toBe('Exact bridge details');
    expect(document.activeElement).toBe(fallback);
    expect(fallback?.getAttribute('aria-label')).toContain('Ctrl');
  });

  it('downloads generated artifacts with bounded sanitized filenames', () => {
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    const actions = createBrowserActions();

    expect(
      actions.downloadText('BEGIN:VCALENDAR', '../../Shift / bridge?.ics', 'text/calendar'),
    ).toBe(true);
    const anchor = document.querySelector<HTMLAnchorElement>('a[download]');
    expect(anchor?.download).toBe('Shift_bridge_.ics');
    expect(anchor?.href).toContain('data:text/calendar');
    expect(click).toHaveBeenCalledOnce();
  });

  it('downloads verified bytes while preserving a safe authored filename', () => {
    vi.useFakeTimers();
    try {
      const click = vi
        .spyOn(HTMLAnchorElement.prototype, 'click')
        .mockImplementation(() => undefined);
      const createObjectUrl = vi.fn((_blob: Blob) => 'blob:relay-knowledge-pdf');
      const revokeObjectUrl = vi.fn();
      const actions = createBrowserActions({ createObjectUrl, revokeObjectUrl });
      const data = new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer;

      expect(actions.downloadBytes(data, 'Authored Operator Guide.pdf', 'application/pdf')).toBe(
        true,
      );

      const anchor = document.querySelector<HTMLAnchorElement>('a[download]');
      expect(anchor?.download).toBe('Authored Operator Guide.pdf');
      expect(anchor?.href).toBe('blob:relay-knowledge-pdf');
      expect(createObjectUrl).toHaveBeenCalledWith(expect.any(Blob));
      const blob = createObjectUrl.mock.calls[0]?.[0];
      expect(blob).toMatchObject({ size: 4, type: 'application/pdf' });
      expect(click).toHaveBeenCalledOnce();

      vi.runAllTimers();
      expect(revokeObjectUrl).toHaveBeenCalledWith('blob:relay-knowledge-pdf');
      expect(document.querySelector('a[download]')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('cleans up a verified-byte download when the browser click throws', () => {
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
      throw new Error('download blocked');
    });
    const createObjectUrl = vi.fn((_blob: Blob) => 'blob:relay-failed-pdf');
    const revokeObjectUrl = vi.fn();
    const actions = createBrowserActions({ createObjectUrl, revokeObjectUrl });

    expect(actions.downloadBytes(new ArrayBuffer(4), 'Guide.pdf', 'application/pdf')).toBe(false);
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:relay-failed-pdf');
    expect(document.querySelector('a[download]')).toBeNull();
  });

  it('keeps an accepted leading-dot PDF name and its extension', () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
      const actions = createBrowserActions({
        createObjectUrl: () => 'blob:relay-leading-dot-pdf',
        revokeObjectUrl: vi.fn(),
      });

      expect(actions.downloadBytes(new ArrayBuffer(4), '....pdf', 'application/pdf')).toBe(true);
      expect(document.querySelector<HTMLAnchorElement>('a[download]')?.download).toBe('....pdf');
      vi.runAllTimers();
    } finally {
      vi.useRealTimers();
    }
  });

  it('sanitizes controls without splitting a non-BMP character at the download-name limit', () => {
    const maximumCodePointName = `${'a'.repeat(119)}😀`;

    expect(sanitizeDownloadName(maximumCodePointName)).toBe(maximumCodePointName);
    expect(sanitizeDownloadName('alert\u0007name.txt')).toBe('alert_name.txt');
  });

  it('uses only built-in audio', async () => {
    const play = vi.fn(async () => undefined);
    class TestAudio {
      preload = '';
      currentTime = 4;
      play = play;
    }
    const actions = createBrowserActions({
      AudioConstructor: TestAudio as unknown as typeof Audio,
    });

    await expect(actions.playBuiltInAlert()).resolves.toBe(true);
    expect(play).toHaveBeenCalledOnce();
  });

  it('selects browser images without exposing a filesystem path', async () => {
    const pickImage = vi.fn(async () => 'data:image/png;base64,cG5n');
    const actions = createBrowserActions({ pickImage });

    await expect(actions.selectImage(5 * 1024 * 1024)).resolves.toBe('data:image/png;base64,cG5n');
    expect(pickImage).toHaveBeenCalledWith(5 * 1024 * 1024);
  });

  it('selects browser PDF objects without exposing local paths', async () => {
    const files = [new File(['%PDF-first!!'], 'Runbook.pdf', { type: 'application/pdf' })];
    const pickPdfFiles = vi.fn(async () => files);
    const actions = createBrowserActions({ pickPdfFiles });

    await expect(actions.selectPdfs()).resolves.toEqual(files);
    expect(pickPdfFiles).toHaveBeenCalledOnce();
  });
});
