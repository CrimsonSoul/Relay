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

  it('sanitizes controls without splitting a non-BMP character at the download-name limit', () => {
    const maximumCodePointName = `${'a'.repeat(119)}😀`;

    expect(sanitizeDownloadName(maximumCodePointName)).toBe(maximumCodePointName);
    expect(sanitizeDownloadName('alert\u0007name.txt')).toBe('alert_name.txt');
  });

  it('uses only built-in audio and browser tabs', async () => {
    const play = vi.fn(async () => undefined);
    class TestAudio {
      preload = '';
      currentTime = 4;
      play = play;
    }
    const openWindow = vi.fn(() => ({ opener: null }) as Window);
    const actions = createBrowserActions({
      AudioConstructor: TestAudio as unknown as typeof Audio,
      openWindow,
    });

    await expect(actions.playBuiltInAlert()).resolves.toBe(true);
    expect(play).toHaveBeenCalledOnce();
    expect(actions.openAuxWindow('popout/board')).toBe(true);
    expect(actions.openAuxWindow('https://example.com')).toBe(false);
    expect(openWindow).toHaveBeenCalledWith('/popout/board', '_blank', 'noopener,noreferrer');
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
