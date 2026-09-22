import {
  SDP_ATTACHMENT_MAX_BYTES,
  SdpAttachmentSchema,
  type SdpAttachment,
  type SdpAttachmentUpload,
  type SdpAttachmentFile,
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
    throw new SdpProviderError('denied');
  const metadata = projectAttachments(request).find((file) => file.id === attachmentId);
  const raw = request.attachments.find(
    (file) => isObject(file) && String(file.id ?? file.file_id) === attachmentId,
  );
  if (!metadata || !isObject(raw)) throw new SdpProviderError('denied');
  if (metadata.size > SDP_ATTACHMENT_MAX_BYTES)
    throw new Error('This attachment exceeds the 10 MB download limit.');
  const bytes = await provider.binary(attachmentDownloadUrl(id, raw.content_url), signal, {
    headers: resourceHeaders(token),
  });
  return { name: metadata.name, contentType: metadata.contentType, data: bytes.toString('base64') };
}
