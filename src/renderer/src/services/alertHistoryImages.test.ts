import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockGetToken = vi.fn();
const mockGetURL = vi.fn(
  (record: { id: string; collectionName: string }, name: string, query: { token: string }) =>
    `http://pb.test/api/files/${record.collectionName}/${record.id}/${name}?token=${query.token}`,
);
const mockConnectionState = { current: 'online' };
vi.mock('./pocketbase', () => ({
  getPb: () => ({ files: { getToken: mockGetToken, getURL: mockGetURL } }),
  getConnectionState: () => mockConnectionState.current,
}));

import {
  AlertHistoryTooManyImagesError,
  extractAlertHistoryImages,
  hasAlertHistoryImageReferences,
  resolveAlertHistoryImages,
  stripAlertHistoryImages,
} from './alertHistoryImages';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const JPEG = 'data:image/jpeg;base64,/9j/4AAQ';

function figure(src: string, caption = 'c'): string {
  return `<figure class="alert-body-figure"><img src="${src}" alt="x" class="alert-body-image"><figcaption>${caption}</figcaption></figure>`;
}

describe('extractAlertHistoryImages', () => {
  it('extracts data images into files and leaves numbered references', () => {
    const { bodyHtml, files } = extractAlertHistoryImages(`<p>a</p>${figure(PNG)}`);
    expect(files).toHaveLength(1);
    expect(files[0]!.name).toBe('image-0.png');
    expect(files[0]!.type).toBe('image/png');
    expect(files[0]!.size).toBe(8);
    expect(bodyHtml).toContain('<img data-relay-image="0" alt="x">');
    expect(bodyHtml).toContain('<figcaption>c</figcaption>');
    expect(bodyHtml).not.toContain('data:image');
  });

  it('numbers images in document order with a matching extension', () => {
    const { bodyHtml, files } = extractAlertHistoryImages(
      `<p><img src="${JPEG}" alt="first"></p>${figure(PNG)}`,
    );
    expect(files.map((file) => file.name)).toEqual(['image-0.jpg', 'image-1.png']);
    expect(bodyHtml.indexOf('data-relay-image="0"')).toBeLessThan(
      bodyHtml.indexOf('data-relay-image="1"'),
    );
  });

  it('returns the body unchanged and no files when there are no images', () => {
    expect(extractAlertHistoryImages('<p>Text only</p>')).toEqual({
      bodyHtml: '<p>Text only</p>',
      files: [],
    });
  });

  it('drops references a new record cannot carry', () => {
    const { bodyHtml, files } = extractAlertHistoryImages(
      '<p>a</p><figure><img data-relay-image="3" alt="x"><figcaption>kept</figcaption></figure>',
    );
    expect(files).toEqual([]);
    expect(bodyHtml).not.toContain('data-relay-image');
    expect(bodyHtml).toContain('<figcaption>kept</figcaption>');
  });

  it('refuses more than 30 images before upload', () => {
    const body = Array.from({ length: 31 }, () => figure(PNG)).join('');
    expect(() => extractAlertHistoryImages(body)).toThrow(AlertHistoryTooManyImagesError);
    expect(() => extractAlertHistoryImages(body)).toThrow(
      'This guide has 31 images; alert history holds up to 30.',
    );
  });

  it('accepts exactly 30 images', () => {
    const body = Array.from({ length: 30 }, () => figure(PNG)).join('');
    expect(extractAlertHistoryImages(body).files).toHaveLength(30);
  });
});

describe('stripAlertHistoryImages', () => {
  it('removes images and keeps captions', () => {
    const stripped = stripAlertHistoryImages(
      `<p>a</p>${figure(PNG)}<p><img data-relay-image="0" alt="y"></p>`,
    );
    expect(stripped).not.toContain('<img');
    expect(stripped).toContain('<figcaption>c</figcaption>');
    expect(stripped).toContain('<p>a</p>');
  });

  it('removes a figure left with neither image nor caption', () => {
    expect(stripAlertHistoryImages(`<p>a</p>${figure(PNG, '')}`)).toBe('<p>a</p>');
  });

  it('returns a body without images unchanged', () => {
    expect(stripAlertHistoryImages('<p>Text</p>')).toBe('<p>Text</p>');
  });
});

describe('resolveAlertHistoryImages', () => {
  const PNG_BYTES = Uint8Array.from(atob('iVBORw0KGgo='), (char) => char.charCodeAt(0));
  const fetchMock = vi.fn();
  const guide = {
    id: 'rec1',
    bodyHtml:
      '<p>a</p><figure class="alert-body-figure"><img data-relay-image="0" alt="first"><figcaption>c</figcaption></figure><p><img data-relay-image="1" alt="second"></p>',
    images: ['image-0_abc.png', 'image-1_def.png'],
  };

  beforeEach(() => {
    mockConnectionState.current = 'online';
    mockGetToken.mockReset().mockResolvedValue('t');
    mockGetURL.mockClear();
    fetchMock.mockReset().mockImplementation(async () => ({
      ok: true,
      blob: async () => new Blob([PNG_BYTES], { type: 'image/png' }),
    }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('replaces references with fetched data URLs', async () => {
    const result = await resolveAlertHistoryImages(guide);
    expect(result.unresolved).toBe(0);
    expect(result.bodyHtml).toContain(
      '<img src="data:image/png;base64,iVBORw0KGgo=" alt="first" class="alert-body-image">',
    );
    expect(result.bodyHtml).toContain('alt="second"');
    expect(result.bodyHtml).not.toContain('data-relay-image');
    expect(result.bodyHtml).toContain('<figcaption>c</figcaption>');
    expect(mockGetURL).toHaveBeenCalledWith(
      { id: 'rec1', collectionName: 'alert_history' },
      'image-0_abc.png',
      { token: 't' },
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(mockGetToken).toHaveBeenCalledOnce();
  });

  it('leaves pre-change entries untouched without fetching', async () => {
    const bodyHtml = '<p><img src="data:image/png;base64,iVBORw0KGgo=" alt="old"></p>';
    expect(hasAlertHistoryImageReferences(bodyHtml)).toBe(false);
    await expect(resolveAlertHistoryImages({ id: 'old', bodyHtml })).resolves.toEqual({
      bodyHtml,
      unresolved: 0,
    });
    expect(mockGetToken).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('counts unresolved references when offline', async () => {
    mockConnectionState.current = 'offline';
    const result = await resolveAlertHistoryImages(guide);
    expect(result).toEqual({ bodyHtml: guide.bodyHtml, unresolved: 2 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps a reference whose file fails to load and resolves the rest', async () => {
    fetchMock.mockImplementationOnce(async () => ({ ok: false, blob: async () => new Blob() }));
    const result = await resolveAlertHistoryImages(guide);
    expect(result.unresolved).toBe(1);
    expect(result.bodyHtml).toContain('<img data-relay-image="0" alt="first">');
    expect(result.bodyHtml).toContain('alt="second" class="alert-body-image"');
  });

  it('counts a reference with no stored file as unresolved', async () => {
    const result = await resolveAlertHistoryImages({ ...guide, images: ['image-0_abc.png'] });
    expect(result.unresolved).toBe(1);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('counts every reference as unresolved when no file token is issued', async () => {
    mockGetToken.mockRejectedValueOnce(new Error('denied'));
    const result = await resolveAlertHistoryImages(guide);
    expect(result).toEqual({ bodyHtml: guide.bodyHtml, unresolved: 2 });
  });
});
