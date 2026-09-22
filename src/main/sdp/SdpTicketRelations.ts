import {
  SdpTicketRelationsSchema,
  type SdpRelationMutation,
  type SdpRelatedTicket,
} from '@shared/sdpTicketRelations';
import type { SdpBrokerCommand } from '@shared/sdpAccount';
import { scalarText, SdpProvider, SdpProviderError, isObject } from './SdpProvider';

const BASE = 'https://support.campingworld.com/app/itdesk/api/v3/requests';
const object = (v: unknown): Record<string, unknown> => (isObject(v) ? v : {});
const rows = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
async function get(
  provider: SdpProvider,
  token: string,
  signal: AbortSignal,
  path: string,
  input?: unknown,
) {
  const url = new URL(`${BASE}${path}`);
  if (input) url.searchParams.set('input_data', JSON.stringify(input));
  return object(
    await provider.json(
      url.href,
      signal,
      {
        headers: {
          Authorization: `Zoho-oauthtoken ${token}`,
          Accept: 'application/vnd.manageengine.sdp.v3+json',
        },
      },
      1048576,
    ),
  );
}
function project(raw: unknown): SdpRelatedTicket {
  const r = object(raw);
  if (!/^\d{1,30}$/.test(String(r.id))) throw new SdpProviderError('invalid');
  return {
    id: String(r.id),
    number: String(object(r.display_key).display_value ?? r.display_id ?? r.id).slice(0, 50),
    subject: scalarText(r.subject).slice(0, 250),
  };
}
async function permissions(provider: SdpProvider, token: string, signal: AbortSignal, id: string) {
  const raw = await get(provider, token, signal, `/${id}/_links`);
  return rows(Array.isArray(raw._links) ? raw._links : object(raw._links).links).map(object);
}
export async function readTicketRelations(
  provider: SdpProvider,
  token: string,
  signal: AbortSignal,
  command: Extract<SdpBrokerCommand, { action: 'readTicketRelations' }>,
) {
  const links = await permissions(provider, token, signal, command.id);
  const can = (name: string, method: string) =>
    links.some((l) => l.name === name && l.method === method);
  // This Cloud operation rejects input_data/list_info. Page the bounded response locally.
  const canRead = can('link_requests', 'get');
  const raw = canRead ? await get(provider, token, signal, `/${command.id}/_link_requests`) : {};
  if (canRead && !Array.isArray(raw.link_requests)) throw new SdpProviderError('invalid');
  const linked = rows(raw.link_requests);
  let candidate: SdpRelatedTicket | null = null;
  if (command.number) {
    const result = await get(provider, token, signal, '', {
      list_info: {
        row_count: 2,
        start_index: 1,
        search_criteria: {
          field: 'display_id',
          condition: 'is',
          value: command.number.replace(/^[A-Za-z]+-/, ''),
        },
      },
    });
    if (!Array.isArray(result.requests)) throw new SdpProviderError('invalid');
    const matches = rows(result.requests).filter(
      (r) => String(object(r).display_id) === command.number!.replace(/^[A-Za-z]+-/, ''),
    );
    if (matches.length === 1) candidate = project(matches[0]);
  }
  return SdpTicketRelationsSchema.parse({
    id: command.id,
    linked: linked
      .slice(command.page * 50, (command.page + 1) * 50)
      .map((r) => project(object(r).linked_request)),
    candidate,
    canLink: can('link_requests', 'post'),
    canUnlink: can('link_requests', 'delete'),
    canMerge: can('merge_requests', 'put'),
    hasMore: linked.length > (command.page + 1) * 50,
  });
}
export async function validateRelation(
  provider: SdpProvider,
  token: string,
  signal: AbortSignal,
  mutation: SdpRelationMutation,
) {
  if (mutation.id === mutation.targetId) throw new SdpProviderError('invalid');
  const links = await permissions(provider, token, signal, mutation.id);
  const method = { link: 'post', unlink: 'delete', merge: 'put' }[mutation.operation];
  const name = mutation.operation === 'merge' ? 'merge_requests' : 'link_requests';
  if (!links.some((l) => l.name === name && l.method === method))
    throw new SdpProviderError('denied');
  const target = await get(provider, token, signal, `/${mutation.targetId}`);
  if (
    String(object(target.request).id) !== mutation.targetId ||
    object(target.request).is_trashed === true
  )
    throw new SdpProviderError('invalid');
}
export async function relationBaseline(
  provider: SdpProvider,
  token: string,
  signal: AbortSignal,
  mutation: SdpRelationMutation,
) {
  const target = await get(provider, token, signal, `/${mutation.targetId}`);
  if (String(object(target.request).id) !== mutation.targetId)
    throw new SdpProviderError('invalid');
  return target.request;
}
