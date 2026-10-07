import { z } from 'zod';
export const SDP_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
const id = z.string().regex(/^\d{1,30}$/);
const filename = z
  .string()
  .min(1)
  .max(200)
  .refine((value) =>
    [...value].every(
      (char) =>
        (char.codePointAt(0) ?? 0) >= 32 &&
        char.codePointAt(0) !== 127 &&
        char !== '/' &&
        char !== '\\',
    ),
  );
const contentType = z
  .string()
  .max(150)
  .regex(/^[\w.+-]+\/[\w.+-]+$/);
const base64 = z
  .string()
  .max(Math.ceil(SDP_ATTACHMENT_MAX_BYTES / 3) * 4)
  .regex(/^[A-Za-z0-9+/]*={0,2}$/);
export const SdpAttachmentSchema = z
  .object({ id, name: filename, size: z.number().int().nonnegative(), contentType })
  .strict();
export const SdpAttachmentMutationSchema = z
  .object({ kind: z.literal('attachment'), id, name: filename, contentType, data: base64 })
  .strict();
export const SdpDownloadCommandSchema = z
  .object({ action: z.literal('downloadAttachment'), id, attachmentId: id })
  .strict();
export const SdpAttachmentFileSchema = z
  .object({ name: filename, contentType, data: base64 })
  .strict();
/** SDP drops inline images over 3 MB from incoming email. */
export const SDP_INLINE_IMAGE_MAX_BYTES = 3 * 1024 * 1024;
/** One reply stays well inside the 15 MB Relay gateway response limit. */
export const SDP_INLINE_IMAGE_BATCH_BYTES = 6 * 1024 * 1024;
export const SDP_INLINE_IMAGE_BATCH = 6;
export const SdpInlineImagesCommandSchema = z
  .object({
    action: z.literal('readInlineImages'),
    id,
    paths: z.array(id).min(1).max(SDP_INLINE_IMAGE_BATCH),
  })
  .strict();
export const SdpInlineImagesSchema = z
  .object({
    id,
    images: z
      .array(
        z
          .object({
            path: id,
            contentType: z.enum(['image/png', 'image/jpeg', 'image/gif', 'image/webp']),
            data: z
              .string()
              .max(Math.ceil(SDP_INLINE_IMAGE_MAX_BYTES / 3) * 4)
              .regex(/^[A-Za-z0-9+/]+={0,2}$/),
          })
          .strict(),
      )
      .max(SDP_INLINE_IMAGE_BATCH),
    /** Paths left for a later request so one reply stays within the batch byte budget. */
    deferred: z.array(id).max(SDP_INLINE_IMAGE_BATCH),
  })
  .strict();
const INLINE_IMAGE = /\/app\/itdesk\/servlet\/SDODAuthServlet\?[^"'\s<>]{1,200}/g;
/**
 * The upload IDs of the images SDP stored from email, as SDP writes them into message HTML
 * (`/app/itdesk/servlet/SDODAuthServlet?path=<id>&ACTION=FILE`).
 */
export function sdpInlineImagePaths(html: string): string[] {
  const paths = new Set<string>();
  for (const [link] of html.matchAll(INLINE_IMAGE)) {
    const query = new URLSearchParams(link.slice(link.indexOf('?') + 1).replaceAll('&amp;', '&'));
    const path = query.get('path') ?? '';
    if (query.get('ACTION') === 'FILE' && /^\d{1,30}$/.test(path)) paths.add(path);
  }
  return [...paths];
}
export type SdpInlineImages = z.infer<typeof SdpInlineImagesSchema>;
export type SdpAttachment = z.infer<typeof SdpAttachmentSchema>;
export type SdpAttachmentUpload = z.infer<typeof SdpAttachmentMutationSchema>;
export type SdpAttachmentFile = z.infer<typeof SdpAttachmentFileSchema>;
