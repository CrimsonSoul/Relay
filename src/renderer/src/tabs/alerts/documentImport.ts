import { docxToHtml, type DocxImport } from './docxToHtml';

/*
 * Documents dropped on the alert body or chosen from Insert: Word (.docx), PDF and saved web pages.
 * Each reader returns HTML with pictures already prepared; the editor sanitizes it and runs smart
 * paste. The PDF reader loads pdf.js only when a PDF is imported.
 */

export type DocumentKind = 'docx' | 'pdf' | 'html';
export type DocumentImport = DocxImport;

export const WORD_DOCUMENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const DOCUMENT_ACCEPT = `.docx,${WORD_DOCUMENT_TYPE},.pdf,application/pdf,.html,.htm,text/html`;
export const MAX_HTML_BYTES = 50 * 1024 * 1024;

const HTML_PICTURE = /^data:(image\/(?:png|jpeg|jpg|gif|webp));base64,([a-z0-9+/=\s]+)$/i;

/** Which reader a file needs, `legacy-word` for a .doc, or null for anything else. */
export function documentKindOf(file: File): DocumentKind | 'legacy-word' | null {
  const name = file.name.toLowerCase();
  if (file.type === WORD_DOCUMENT_TYPE || name.endsWith('.docx')) return 'docx';
  if (file.type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (file.type === 'text/html' || /\.html?$/.test(name)) return 'html';
  if (file.type === 'application/msword' || name.endsWith('.doc')) return 'legacy-word';
  return null;
}

/** Decodes a saved page in the charset its <meta> names (Word saves pages as windows-1252). */
function decodeHtml(bytes: Uint8Array): string {
  // A byte order mark wins over <meta>; Word's "Unicode" pages are UTF-16 with one.
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 4096));
  const label = /<meta[^>]{0,200}charset\s*=\s*["']?([\w-]{1,40})/i.exec(head)?.[1];
  try {
    return new TextDecoder(label ?? 'utf-8').decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

function pictureBlob(src: string): Blob | null {
  const [, type, data] = HTML_PICTURE.exec(src.trim()) ?? [];
  if (!type || !data) return null;
  try {
    const binary = atob(data.replaceAll(/\s/g, ''));
    return new Blob([Uint8Array.from(binary, (char) => char.codePointAt(0)!)], { type });
  } catch {
    return null;
  }
}

/**
 * A saved web page's body. Pictures embedded in the page are prepared like any body picture;
 * pictures in a separate folder or on the web cannot be read from the one file and are counted.
 */
export async function htmlFileToHtml(
  file: Blob,
  prepareImage: (file: Blob) => Promise<string>,
): Promise<DocumentImport> {
  if (file.size > MAX_HTML_BYTES) throw new Error('This page is larger than 50 MB.');
  const page = new DOMParser().parseFromString(
    decodeHtml(new Uint8Array(await file.arrayBuffer())),
    'text/html',
  );
  let skippedImages = 0;
  for (const img of Array.from(page.body.querySelectorAll('img'))) {
    const blob = pictureBlob(img.getAttribute('src') ?? '');
    const src = blob ? await prepareImage(blob).catch(() => null) : null;
    if (src) {
      img.setAttribute('src', src);
    } else {
      skippedImages += 1;
      img.remove();
    }
  }
  return { html: page.body.innerHTML, skippedImages };
}

export async function documentToHtml(
  kind: DocumentKind,
  file: File,
  prepareImage: (file: Blob) => Promise<string>,
): Promise<DocumentImport> {
  if (kind === 'docx') return docxToHtml(file, prepareImage);
  if (kind === 'html') return htmlFileToHtml(file, prepareImage);
  const { pdfToHtml } = await import('./pdfToHtml');
  return pdfToHtml(file, prepareImage);
}
