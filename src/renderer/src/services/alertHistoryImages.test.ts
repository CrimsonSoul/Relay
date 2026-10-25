import { describe, it, expect } from 'vitest';
import {
  AlertHistoryTooManyImagesError,
  extractAlertHistoryImages,
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
