import {
  SDP_ATTACHMENT_MAX_BYTES,
  SDP_INLINE_IMAGE_MAX_BYTES,
  SdpAttachmentSchema,
  type SdpAttachment,
  type SdpAttachmentUpload,
  type SdpAttachmentFile,
  type SdpInlineImages,
} from '@shared/sdpAttachments';
import { SdpProvider, SdpProviderError, isObject } from './SdpProvider';
import { resourceHeaders } from './SdpResources';
const API = 'https://support.campingworld.com/app/itdesk/api/v3';
export function projectAttachments(request: Record<string, unknown>): SdpAttachment[] {
  if (!Array.isArray(request.attachments)) return [];
  return request.attachments.map((value) => {
    if (!isObject(value)) throw new SdpProviderError('invalid');
    return SdpAttachmentSchema.parse({
      id: String(value.id ?? value.file_id),
      name: value.name,
      size: Number(value.size ?? 0),
      contentType: value.content_type || 'application/octet-stream',
    });
  });
}
export function attachmentBody(upload: SdpAttachmentUpload): FormData {
  const bytes = Buffer.from(upload.data, 'base64');
  if (
    !bytes.length ||
    bytes.length > SDP_ATTACHMENT_MAX_BYTES ||
    bytes.toString('base64') !== upload.data
  )
    throw new Error('Choose a file between 1 byte and 10 MB.');
  const form = new FormData();
  form.append('filename', new Blob([bytes], { type: upload.contentType }), upload.name);
  form.append('addtoattachment', 'true');
  return form;
}
export function attachmentDownloadUrl(requestId: string, value: unknown): string {
  if (typeof value !== 'string') throw new SdpProviderError('invalid');
  const relative = value.startsWith('/requests/') ? API + value : value;
  const url = new URL(relative, 'https://support.campingworld.com');
  const prefix = `/app/itdesk/api/v3/requests/${requestId}/_uploads/`;
  if (
    url.origin !== 'https://support.campingworld.com' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !url.pathname.startsWith(prefix) ||
    !/^\d{1,30}$/.test(url.pathname.slice(prefix.length))
  )
    throw new SdpProviderError('invalid');
  return url.toString();
}
function imageType(bytes: Buffer): SdpInlineImages['images'][number]['contentType'] | undefined {
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (['GIF87a', 'GIF89a'].includes(bytes.toString('latin1', 0, 6))) return 'image/gif';
  if (bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP')
    return 'image/webp';
  return undefined;
}
/** The request, or the email (notification) or note within it, that holds an inline image. */
export type SdpImageOwner = { id: string; item?: { kind: 'notifications' | 'notes'; id: string } };
const digits = /^\d{1,30}$/;
/**
 * SDP's email image servlet accepts only a browser session, but the same upload ID downloads
 * through the upload route of the item that holds it. Only verified raster image bytes return.
 */
export async function readInlineImage(
  provider: SdpProvider,
  token: string,
  signal: AbortSignal,
  owner: SdpImageOwner,
  path: string,
): Promise<SdpInlineImages['images'][number] | undefined> {
  if (![owner.id, owner.item?.id ?? '0', path].every((value) => digits.test(value)))
    throw new SdpProviderError('invalid');
  const item = owner.item ? `/${owner.item.kind}/${owner.item.id}` : '';
  const bytes = await provider.binary(
    `${API}/requests/${owner.id}${item}/_uploads/${path}`,
    signal,
    { headers: resourceHeaders(token) },
    SDP_INLINE_IMAGE_MAX_BYTES,
  );
  const contentType = imageType(bytes);
  return contentType && { path, contentType, data: bytes.toString('base64') };
}
export async function downloadAttachment(
  provider: SdpProvider,
  token: string,
  signal: AbortSignal,
  id: string,
  attachmentId: string,
): Promise<SdpAttachmentFile> {
  const response = await provider.json(`${API}/requests/${id}`, signal, {
    headers: resourceHeaders(token),
  });
  const request = isObject(response) && isObject(response.request) ? response.request : undefined;
  if (!request || String(request.id) !== id || !Array.isArray(request.attachments))
    throw new SdpProviderError('invalid');
  const metadata = projectAttachments(request).find((file) => file.id === attachmentId);
  const raw = request.attachments.find(
    (file) => isObject(file) && String(file.id ?? file.file_id) === attachmentId,
  );
  if (!metadata || !isObject(raw))
    throw new Error('This attachment is no longer available. Refresh the ticket.');
  if (metadata.size > SDP_ATTACHMENT_MAX_BYTES)
    throw new Error('This attachment exceeds the 10 MB download limit.');
  const bytes = await provider.binary(attachmentDownloadUrl(id, raw.content_url), signal, {
    headers: resourceHeaders(token),
  });
  return { name: metadata.name, contentType: metadata.contentType, data: bytes.toString('base64') };
}
