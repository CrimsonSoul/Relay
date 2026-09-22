import { SDP_LINK_COLLECTION } from '../../../shared/sdpLinks';
import { SDP_DISCOVERY_COLLECTION } from '../../../shared/sdpAccount';
import type { CollectionDef } from './collectionTypes';
const authenticated = '@request.auth.id != ""';

/** Shared connection discovery and ticket references only; ticket data remains in SDP. */
export const SERVICE_DESK_COLLECTIONS: CollectionDef[] = [
  {
    name: SDP_LINK_COLLECTION,
    type: 'base',
    rules: {
      listRule: authenticated,
      viewRule: authenticated,
      createRule: authenticated,
      updateRule: authenticated,
      deleteRule: authenticated,
    },
    fields: [
      { type: 'bool', name: 'suppressed' },
      { type: 'text', name: 'ticketId', required: true, max: 30, pattern: String.raw`^\d{1,30}$` },
      {
        type: 'text',
        name: 'ticketNumber',
        required: true,
        max: 30,
        pattern: String.raw`^\d{1,30}$`,
      },
      { type: 'text', name: 'problemId', required: true, max: 256 },
      { type: 'text', name: 'environment', required: true, max: 2048 },
    ],
    indexes: [
      'CREATE UNIQUE INDEX idx_sdp_problem_link ON relay_sdp_links (ticketId, problemId, environment)',
    ],
  },
  {
    name: SDP_DISCOVERY_COLLECTION,
    type: 'base',
    rules: {
      listRule: authenticated,
      viewRule: authenticated,
      createRule: null,
      updateRule: null,
      deleteRule: null,
    },
    fields: [
      { type: 'bool', name: 'enabled' },
      { type: 'number', name: 'gatewayPort', required: true, min: 1, max: 65535, onlyInt: true },
      { type: 'text', name: 'revision', max: 64 },
    ],
  },
];
