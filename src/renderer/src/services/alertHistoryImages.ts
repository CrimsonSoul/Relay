import {
  ALERT_HISTORY_IMAGE_MIME_TYPES,
  ALERT_HISTORY_MAX_IMAGES,
} from '@shared/alertHistoryImages';
import { getConnectionState, getPb } from './pocketbase';

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

const REFERENCE_SELECTOR = 'img[data-relay-image]';

/** Whether a stored body names any image in its record's `images` field. */
export function hasAlertHistoryImageReferences(bodyHtml: string): boolean {
  return (
    bodyHtml.includes('data-relay-image') && !!parseBody(bodyHtml).querySelector(REFERENCE_SELECTOR)
  );
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('The image could not be read.'));
    reader.readAsDataURL(blob);
  });
}

async function fetchImageDataUrl(url: string): Promise<string | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const blob = await response.blob();
    if (!(ALERT_HISTORY_IMAGE_MIME_TYPES as readonly string[]).includes(blob.type)) return null;
    return await blobToDataUrl(blob);
  } catch {
    return null;
  }
}

/**
 * Turns a saved guide's image references back into data URLs, so the editor, preview and export
 * work with self-contained HTML. Entries without references come back untouched with no request.
 * Offline, or when a file can't be read, the reference stays and counts as unresolved.
 */
export async function resolveAlertHistoryImages(entry: {
  id: string;
  bodyHtml: string;
  images?: string[];
}): Promise<{ bodyHtml: string; unresolved: number }> {
  if (!hasAlertHistoryImageReferences(entry.bodyHtml)) {
    return { bodyHtml: entry.bodyHtml, unresolved: 0 };
  }
  const body = parseBody(entry.bodyHtml);
  const references = Array.from(body.querySelectorAll<HTMLImageElement>(REFERENCE_SELECTOR));
  if (getConnectionState() !== 'online') {
    return { bodyHtml: entry.bodyHtml, unresolved: references.length };
  }

  let token: string;
  try {
    token = await getPb().files.getToken();
  } catch {
    return { bodyHtml: entry.bodyHtml, unresolved: references.length };
  }

  const record = { id: entry.id, collectionName: 'alert_history' };
  let unresolved = 0;
  // One at a time: a guide holds at most 30 small images, and the server sees one request at once.
  for (const reference of references) {
    const name = entry.images?.[Number(reference.dataset.relayImage)];
    const dataUrl = name
      ? await fetchImageDataUrl(getPb().files.getURL(record, name, { token }))
      : null;
    if (!dataUrl) {
      unresolved++;
      continue;
    }
    const image = body.ownerDocument.createElement('img');
    image.setAttribute('src', dataUrl);
    image.setAttribute('alt', reference.getAttribute('alt') ?? '');
    image.setAttribute('class', 'alert-body-image');
    reference.replaceWith(image);
  }
  return { bodyHtml: body.innerHTML, unresolved };
}
