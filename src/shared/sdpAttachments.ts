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
        char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127 && char !== '/' && char !== '\\',
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
export type SdpAttachment = z.infer<typeof SdpAttachmentSchema>;
export type SdpAttachmentUpload = z.infer<typeof SdpAttachmentMutationSchema>;
export type SdpAttachmentFile = z.infer<typeof SdpAttachmentFileSchema>;
