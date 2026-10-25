import { ALERT_HISTORY_MAX_IMAGES } from '@shared/alertHistoryImages';

/**
 * Saved guide images live in the protected `alert_history.images` file field. The stored
 * `bodyHtml` keeps `<img data-relay-image="N" alt="…">`, where N indexes that field.
 */

const DATA_IMAGE_PATTERN = /^data:(image\/(?:png|jpeg|jpg|gif|webp));base64,([a-z0-9+/=]+)$/i;

const EXTENSION_BY_MIME: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

export class AlertHistoryTooManyImagesError extends Error {
  constructor(count: number) {
    super(`This guide has ${count} images; alert history holds up to ${ALERT_HISTORY_MAX_IMAGES}.`);
    this.name = 'AlertHistoryTooManyImagesError';
  }
}

function parseBody(bodyHtml: string): HTMLElement {
  return new DOMParser().parseFromString(`<body>${bodyHtml}</body>`, 'text/html').body;
}

function bodyImages(body: HTMLElement): HTMLImageElement[] {
  return Array.from(body.querySelectorAll('img'));
}

function dataUrlToFile(match: RegExpExecArray, index: number): File {
  const mime = match[1]!.toLowerCase() === 'image/jpg' ? 'image/jpeg' : match[1]!.toLowerCase();
  const binary = atob(match[2]!);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], `image-${index}.${EXTENSION_BY_MIME[mime]}`, { type: mime });
}

/** Removes an image; a figure left with neither image nor caption text goes with it. */
function removeImage(image: HTMLImageElement): void {
  const figure = image.closest('figure');
  image.remove();
  if (figure && !figure.querySelector('img') && !figure.textContent?.trim()) figure.remove();
}

/**
 * Moves each inline data image into a `File` for the history record's `images` field and leaves
 * a numbered reference in its place. Existing references are dropped: a new record has no files
 * behind them. Refuses before upload when the guide holds more images than the field accepts.
 */
export function extractAlertHistoryImages(bodyHtml: string): { bodyHtml: string; files: File[] } {
  const body = parseBody(bodyHtml);
  const images = bodyImages(body);
  if (images.length === 0) return { bodyHtml, files: [] };

  const matches = images.map((image) => DATA_IMAGE_PATTERN.exec(image.getAttribute('src') ?? ''));
  const count = matches.filter(Boolean).length;
  if (count > ALERT_HISTORY_MAX_IMAGES) throw new AlertHistoryTooManyImagesError(count);

  const files: File[] = [];
  images.forEach((image, position) => {
    const match = matches[position];
    if (!match) {
      removeImage(image);
      return;
    }
    const reference = body.ownerDocument.createElement('img');
    reference.setAttribute('data-relay-image', String(files.length));
    reference.setAttribute('alt', image.getAttribute('alt') ?? '');
    files.push(dataUrlToFile(match, files.length));
    image.replaceWith(reference);
  });
  return { bodyHtml: body.innerHTML, files };
}

/** Removes every image, keeping captions, for a save that cannot carry files. */
export function stripAlertHistoryImages(bodyHtml: string): string {
  const body = parseBody(bodyHtml);
  const images = bodyImages(body);
  if (images.length === 0) return bodyHtml;
  images.forEach(removeImage);
  return body.innerHTML;
}
