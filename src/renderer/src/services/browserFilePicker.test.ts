// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pickBrowserFile } from './browserFilePicker';

const MAX_BYTES = 25 * 1024 * 1024;

function fileInput(): HTMLInputElement {
  const input = document.body.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error('Expected browser file picker input');
  return input;
}

function selectedFile(
  input: HTMLInputElement,
  options: {
    name?: string;
    size?: number;
    text?: () => Promise<string>;
    arrayBuffer?: () => Promise<ArrayBuffer>;
  } = {},
) {
  const file = new File(['fixture'], options.name ?? 'servers.json', {
    type: 'application/json',
  });
  const readText = vi.fn(options.text ?? (async () => '[{"name":"server-1"}]'));
  const readBuffer = vi.fn(options.arrayBuffer ?? (async () => new ArrayBuffer(8)));
  Object.defineProperties(file, {
    size: { configurable: true, value: options.size ?? 7 },
    text: { configurable: true, value: readText },
    arrayBuffer: { configurable: true, value: readBuffer },
  });
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  return { file, readText, readBuffer };
}

describe('pickBrowserFile', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.replaceChildren();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it('keeps a delayed selected file when focus returns before change', async () => {
    const selection = pickBrowserFile({ accept: '.json,.csv,.xlsx', maxBytes: MAX_BYTES });
    const input = fileInput();
    const { readText, readBuffer } = selectedFile(input);

    globalThis.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(100);
    input.dispatchEvent(new Event('change'));
    await vi.advanceTimersByTimeAsync(300);

    await expect(selection).resolves.toEqual({
      kind: 'selected',
      name: 'servers.json',
      text: '[{"name":"server-1"}]',
      buffer: expect.any(ArrayBuffer),
    });
    expect(readText).toHaveBeenCalledOnce();
    expect(readBuffer).toHaveBeenCalledOnce();
    expect(document.body.querySelector('input[type="file"]')).toBeNull();
  });

  it('treats the input cancel event as authoritative and cleans up', async () => {
    const selection = pickBrowserFile({ accept: '.json', maxBytes: MAX_BYTES });
    const input = fileInput();

    input.dispatchEvent(new Event('cancel'));

    await expect(selection).resolves.toEqual({ kind: 'cancelled' });
    expect(document.body.querySelector('input[type="file"]')).toBeNull();
  });

  it('falls back to cancellation after focus returns without an input event', async () => {
    const selection = pickBrowserFile({ accept: '.json', maxBytes: MAX_BYTES });

    globalThis.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(299);
    expect(document.body.querySelector('input[type="file"]')).not.toBeNull();
    await vi.advanceTimersByTimeAsync(1);

    await expect(selection).resolves.toEqual({ kind: 'cancelled' });
    expect(document.body.querySelector('input[type="file"]')).toBeNull();
  });

  it('rejects an oversized file before reading it', async () => {
    const selection = pickBrowserFile({ accept: '.json', maxBytes: MAX_BYTES });
    const input = fileInput();
    const { readText, readBuffer } = selectedFile(input, { size: MAX_BYTES + 1 });

    input.dispatchEvent(new Event('change'));

    await expect(selection).rejects.toThrow('Import file is too large. Choose a file under 25 MB.');
    expect(readText).not.toHaveBeenCalled();
    expect(readBuffer).not.toHaveBeenCalled();
    expect(document.body.querySelector('input[type="file"]')).toBeNull();
  });

  it.each([
    [
      'text',
      async () => Promise.reject(new Error('text read failed')),
      async () => new ArrayBuffer(8),
    ],
    ['buffer', async () => '[]', async () => Promise.reject(new Error('buffer read failed'))],
  ] as const)(
    'reports a specific error when the %s read fails',
    async (_label, text, arrayBuffer) => {
      const selection = pickBrowserFile({ accept: '.json', maxBytes: MAX_BYTES });
      const input = fileInput();
      selectedFile(input, { text, arrayBuffer });

      input.dispatchEvent(new Event('change'));

      await expect(selection).rejects.toThrow('Could not read the selected import file.');
      expect(document.body.querySelector('input[type="file"]')).toBeNull();
    },
  );

  it('reads each representation exactly once for a valid file', async () => {
    const selection = pickBrowserFile({ accept: '.csv', maxBytes: MAX_BYTES });
    const input = fileInput();
    const { readText, readBuffer } = selectedFile(input, { name: 'servers.csv' });

    input.dispatchEvent(new Event('change'));

    await expect(selection).resolves.toMatchObject({ kind: 'selected', name: 'servers.csv' });
    expect(readText).toHaveBeenCalledOnce();
    expect(readBuffer).toHaveBeenCalledOnce();
  });
});
