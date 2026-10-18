import { SDP_REQUESTS, sdpHeaders, sdpHtml } from './SdpApi';
import { editedRequest, validateFormMutation } from './SdpForms';
import type { SdpForm } from '@shared/sdpForm';
import { attachmentBody } from './SdpAttachments';
import { createHash } from 'node:crypto';
import { relationBaseline } from './SdpTicketRelations';
import {
  SDP_DEFAULT_INCIDENT_TEMPLATE,
  type SdpMutation,
  type SdpChangeResult,
  type SdpRequestFields,
} from '@shared/sdpMutation';
import {
  isObject,
  scalarText,
  SdpProvider,
  SdpProviderError,
  SdpValidationError,
  validationFields,
} from './SdpProvider';

import { resourceBaseline, resourceInput, resourcePath } from './SdpResources';
function requestFields(fields: SdpRequestFields): Record<string, unknown> {
  const request: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (key === 'subject') request.subject = value;
    else if (key === 'description') request.description = sdpHtml(String(value));
    else if (key === 'resolution') request.resolution = { content: sdpHtml(String(value)) };
    else
      request[key === 'requestType' ? 'request_type' : key] =
        value === null ? null : { name: value };
  }
  return request;
}
/** Compare a fresh upstream record immediately before updating; no raw record leaves main. */
export async function mutationBaseline(
  provider: SdpProvider,
  token: string,
  signal: AbortSignal,
  id: string,
  mutation?: SdpMutation,
): Promise<string> {
  const value = await provider.json(`${SDP_REQUESTS}/${id}`, signal, {
    headers: sdpHeaders(token),
  });
  if (!isObject(value) || !isObject(value.request) || String(value.request.id) !== id)
    throw new SdpProviderError('invalid');
  // Stable key ordering prevents JSON property order from producing false conflicts.
  const canonical = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(canonical);
    if (!isObject(item)) return item;
    return Object.fromEntries(
      Object.keys(item)
        .sort((a, b) => a.localeCompare(b))
        .map((key) => [key, canonical(item[key])]),
    );
  };
  const resource = mutation?.kind === 'resource' ? mutation : undefined;
  let snapshot: unknown = value.request;
  if (mutation?.kind === 'relation')
    snapshot = {
      request: value.request,
      target: await relationBaseline(provider, token, signal, mutation),
    };
  else if (resource)
    snapshot = {
      request: value.request,
      resource: await resourceBaseline(provider, token, signal, resource),
    };
  return createHash('sha256')
    .update(JSON.stringify(canonical(snapshot)))
    .digest('hex');
}
function mutationInput(
  mutation: Exclude<SdpMutation, { kind: 'bulk' }>,
  form?: SdpForm,
): Record<string, unknown> {
  if (mutation.kind === 'relation')
    return mutation.operation === 'merge'
      ? { merge_requests: [{ id: mutation.targetId }] }
      : { link_requests: [{ linked_request: { id: mutation.targetId } }] };
  if (mutation.kind === 'edit') return { request: editedRequest(mutation.fields, sdpHtml, form) };
  if (mutation.kind === 'reply' || mutation.kind === 'forward')
    return {
      notification: {
        to: mutation.to,
        cc: mutation.cc,
        bcc: mutation.bcc,
        subject: mutation.subject,
        description: sdpHtml(mutation.body),
        is_public: mutation.isPublic,
        type: mutation.kind === 'forward' ? 'REQFORWARD' : 'REQREPLY',
        in_reply_to: {
          id: mutation.kind === 'forward' ? (mutation.sourceId ?? mutation.id) : mutation.id,
        },
      },
    };
  if (mutation.kind === 'attachment' || mutation.kind === 'pickup') return {};
  if (mutation.kind === 'resource') return resourceInput(mutation);
  if (mutation.kind === 'note')
    return {
      request_note: {
        description: sdpHtml(mutation.body),
        show_to_requester: mutation.showToRequester,
        notify_technician: false,
        mark_first_response: false,
        add_to_linked_requests: false,
      },
    };
  return requestInput(mutation);
}
function requestInput(
  mutation: Extract<SdpMutation, { kind: 'create' | 'update' }>,
): Record<string, unknown> {
  const request = requestFields(mutation.fields);
  if (mutation.kind === 'create') {
    if (mutation.templateId) request.template = { id: mutation.templateId };
    if (mutation.requesterEmail) request.requester = { email_id: mutation.requesterEmail };
    if (mutation.majorIncident) {
      request.template = { id: SDP_DEFAULT_INCIDENT_TEMPLATE.id };
      // This tenant's Major Incident checkbox is a multi-choice custom field.
      request.udf_fields = { txt_major_incident: ['Yes'] };
    }
  }
  return { request };
}

export async function submitMutation(
  provider: SdpProvider,
  token: string,
  signal: AbortSignal,
  mutation: SdpMutation,
): Promise<SdpChangeResult> {
  if (mutation.kind === 'bulk') throw new Error('Bulk changes require individual result handling.');
  const form = await validateFormMutation(provider, token, signal, mutation);
  const { path, method } = mutationRequest(mutation);
  const input = mutationInput(mutation, form);
  let value: unknown;
  try {
    value = await provider.json(path, signal, {
      method,
      headers:
        mutation.kind === 'attachment'
          ? sdpHeaders(token)
          : { ...sdpHeaders(token), 'Content-Type': 'application/x-www-form-urlencoded' },
      ...(method !== 'DELETE' || mutation.kind === 'relation'
        ? {
            body:
              mutation.kind === 'attachment'
                ? attachmentBody(mutation)
                : new URLSearchParams({ input_data: JSON.stringify(input) }).toString(),
          }
        : {}),
    });
  } catch (error) {
    if (error instanceof SdpValidationError) throw error;
    if (error instanceof SdpProviderError && error.kind === 'denied') throw error;
    // A timed-out write may already have succeeded. Never automatically replay it.
    throw new Error(
      'SDP did not confirm the change. Check the ticket in SDP before trying again; Relay will not retry automatically.',
    );
  }
  checkMutationStatus(value);
  const request = isObject(value) && isObject(value.request) ? value.request : undefined;
  const id = mutation.kind === 'create' ? scalarText(request?.id) : mutation.id;
  if (!/^\d{1,30}$/.test(id))
    throw new Error(
      'SDP returned an incomplete confirmation. Check SDP before creating another ticket.',
    );
  return { id, number: scalarText(request?.display_id, id).slice(0, 50), kind: mutation.kind };
}
function checkMutationStatus(value: unknown) {
  const status = isObject(value) ? value.response_status : undefined;
  if (isObject(status) && status.status_code === 3000) {
    const fields = validationFields(value);
    const detail = fields.length ? ' Check required fields: ' + fields.join(', ') + '.' : '';
    throw new Error(
      `SDP applied only part of the change. Refresh the ticket before trying again.${detail}`,
    );
  }
  if (!isObject(status) || status.status_code !== 2000)
    throw new Error(
      'SDP rejected the change. Check your permissions, field names, template and required fields in SDP before preparing a new change.',
    );
}

function mutationRequest(mutation: Exclude<SdpMutation, { kind: 'bulk' }>): {
  path: string;
  method: string;
} {
  if (mutation.kind === 'relation')
    return {
      path: `${SDP_REQUESTS}/${mutation.id}/_${mutation.operation === 'merge' ? 'merge_requests' : 'link_requests'}`,
      method: { link: 'POST', unlink: 'DELETE', merge: 'PUT' }[mutation.operation],
    };
  let path = SDP_REQUESTS;
  if (mutation.kind !== 'create') path += `/${mutation.id}`;
  if (mutation.kind === 'note') path += '/notes';
  if (mutation.kind === 'reply' || mutation.kind === 'forward') path += '/notifications';
  if (mutation.kind === 'attachment') path += '/_uploads';
  if (mutation.kind === 'pickup') path += '/_pickup';
  if (mutation.kind === 'resource') {
    path = resourcePath(mutation);
    if (mutation.operation === 'approve' || mutation.operation === 'reject')
      path += `/_${mutation.operation}`;
  }
  let method = ['update', 'edit', 'pickup'].includes(mutation.kind) ? 'PUT' : 'POST';
  if (mutation.kind === 'resource') {
    method = { create: 'POST', update: 'PUT', delete: 'DELETE', approve: 'PUT', reject: 'PUT' }[
      mutation.operation
    ];
  }
  return { path, method };
}
