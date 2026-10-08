import { SdpWorkflowLinkCommandSchema } from './sdpWorkflowLink';
import { SdpChangesCommandSchema, SdpChangesPageSchema, type SdpChangesPage } from './sdpChanges';
import { SdpHistoryCommandSchema, SdpHistorySchema, type SdpHistory } from './sdpHistory';
import { SdpLastReplySchema } from './sdpReplies';
import { SdpTicketRelationsCommandSchema, SdpTicketRelationsSchema } from './sdpTicketRelations';
import { SdpQueueFiltersSchema } from './sdpQueueFilters';
import {
  SdpForwardCommandSchema,
  SdpFormSchema,
  SdpOptionsSchema,
  SdpReplyContextSchema,
  SdpFormCommandSchema,
  SdpOptionsCommandSchema,
  SdpStandardOptionsCommandSchema,
  SdpReplyCommandSchema,
} from './sdpForm';
import { z } from 'zod';
import {
  SdpAttachmentSchema,
  SdpDownloadCommandSchema,
  SdpAttachmentFileSchema,
  SdpInlineImagesCommandSchema,
  SdpInlineImagesSchema,
  type SdpAttachmentFile,
  type SdpInlineImages,
} from './sdpAttachments';
import {
  SdpResourceChoicesCommandSchema,
  SdpResourceChoicesSchema,
  type SdpResourceChoices,
  SdpResourceCommandSchema,
  SdpResourcePageSchema,
  type SdpResourcePage,
} from './sdpResources';
import {
  SdpBulkResultSchema,
  type SdpBulkResult,
  SdpPrepareCommandSchema,
  SdpConfirmCommandSchema,
  SdpCancelCommandSchema,
  SdpReviewSchema,
  SdpChangeResultSchema,
  type SdpReview,
  type SdpChangeResult,
} from './sdpMutation';

export const SDP_TEST_TICKET = '810129';
export const SDP_CALLBACK = 'http://127.0.0.1:8766/callback';
export const SDP_READ_SCOPE = 'SDPOnDemand.requests.READ';
export const SDP_ACCOUNT_SCOPE = `${SDP_READ_SCOPE},SDPOnDemand.requests.CREATE,SDPOnDemand.requests.UPDATE,SDPOnDemand.requests.DELETE,SDPOnDemand.setup.READ,SDPOnDemand.changes.READ,AaaServer.profile.READ`;
/**
 * Clients that accept newer ticket fields name them in this request header. Older servers ignore
 * the header, and a server leaves out every field a client did not name, because older clients
 * reject unknown fields.
 */
export const SDP_FEATURES_HEADER = 'x-relay-sdp-features';
/**
 * A desktop client's random device key. The server remembers that desktop's SDP sign-in under it
 * for 30 days; older servers ignore the header.
 */
export const SDP_DEVICE_HEADER = 'x-relay-sdp-device';
/** A device key: 32 random bytes, base64url-encoded. */
export const SDP_DEVICE_PATTERN = /^[\w-]{43}$/;
/** Ticket rows may carry `vip` (the requester is an SDP VIP user). */
export const SDP_VIP_FEATURE = 'vip';
/** Ticket rows may carry `requesterName` (the requester's display name). */
export const SDP_REQUESTER_FEATURE = 'requester';
/** Every newer ticket field this client accepts, as the SDP_FEATURES_HEADER value. */
export const SDP_ACCEPTED_FEATURES = [SDP_VIP_FEATURE, SDP_REQUESTER_FEATURE].join(', ');
export const SDP_DISCOVERY_COLLECTION = 'relay_sdp_discovery';
export const SDP_DISCOVERY_ID = 'sdpconnection01';

export const SdpClientSchema = z
  .object({
    clientId: z
      .string()
      .trim()
      .regex(/^1000\.[A-Za-z0-9]+$/)
      .max(200),
    clientSecret: z.string().trim().min(1).max(500).regex(/^\S+$/),
  })
  .strict();
export type SdpClient = z.infer<typeof SdpClientSchema>;

/** A fixed, safe message (forwarded over IPC) for a command the connected Relay server predates. */
export const SDP_SERVER_UPDATE_MESSAGE = 'The Relay server needs an update for this action.';
/** The default queues. Older clients and servers accept only these names. */
export const SDP_QUEUES = ['NOC', 'SOX', 'Unassigned'] as const;
/** Whether a ticket status ends the ticket's work (resolved, closed or cancelled). */
export const sdpTicketDone = (status: string): boolean =>
  /^(closed|resolved|cancell?ed)$/i.test(status.trim());
/** The most queue tabs one person keeps, counting the default queues. */
export const SDP_MAX_QUEUES = 10;
/**
 * A queue is an SDP support group name, or Unassigned for tickets without a group. Names outside
 * SDP_QUEUES are sent only by clients that added them, and only to servers that accept them.
 */
export const SdpQueueSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^\S(?:[^\p{Cc}]*\S)?$/u)
  .refine((name) => name === 'Unassigned' || name.toLowerCase() !== 'unassigned');
/** The default page size; it is never sent, so older servers keep answering. */
export const SDP_PAGE_SIZE = 50;
export const SDP_PAGE_SIZES = [25, 50, 100] as const;
export const SDP_MAX_PAGE_SIZE = 100;
export const SdpPageSizeSchema = z.union([z.literal(25), z.literal(50), z.literal(100)]);
/** Queue columns SDP sorts by. Newest first is the default order and is never sent. */
export const SDP_QUEUE_SORT_FIELDS = [
  'number',
  'priority',
  'status',
  'technician',
  'created',
] as const;
export type SdpQueueSortField = (typeof SDP_QUEUE_SORT_FIELDS)[number];
export const SdpQueueSortSchema = z
  .object({ field: z.enum(SDP_QUEUE_SORT_FIELDS), order: z.enum(['asc', 'desc']) })
  .strict()
  .refine((sort) => sort.field !== 'created' || sort.order !== 'desc');
export type SdpQueueSort = z.infer<typeof SdpQueueSortSchema>;
export const SdpQueueCommandSchema = z
  .object({
    action: z.literal('readQueue'),
    filters: SdpQueueFiltersSchema.optional(),
    queue: SdpQueueSchema,
    page: z.number().int().min(0).max(19),
    pageSize: SdpPageSizeSchema.optional(),
    sort: SdpQueueSortSchema.optional(),
  })
  .strict();
export const SdpQueuePageSchema = z
  .object({
    filters: SdpQueueFiltersSchema.optional(),
    queue: SdpQueueSchema,
    page: z.number().int().min(0).max(19),
    /** Present only when a client asked for a size other than SDP_PAGE_SIZE. */
    pageSize: SdpPageSizeSchema.optional(),
    /** Present only when a client asked for an order other than newest first. */
    sort: SdpQueueSortSchema.optional(),
    hasMore: z.boolean(),
    tickets: z
      .array(
        z
          .object({
            id: z.string().regex(/^\d{1,30}$/),
            number: z.string().max(50),
            subject: z.string().max(250),
            status: z.string().max(200),
            priority: z.string().max(200),
            group: SdpQueueSchema,
            technician: z.string().max(200),
            requestType: z.string().max(200).optional(),
            category: z.string().max(200).optional(),
            template: z.string().max(200).optional(),
            createdAt: z.number().nullable(),
            updatedAt: z.number().nullable().optional(),
            dueAt: z.number().nullable(),
            notificationStatus: z.string().max(100).nullable().optional(),
            unrepliedCount: z.number().int().min(0).max(1000000).optional(),
            providerUnread: z.boolean().optional(),
            lastReply: SdpLastReplySchema.nullable().optional(),
            replyState: z.enum(['ready', 'pending', 'unavailable']).optional(),
            replyUnread: z.boolean().optional(),
            replyEventId: z
              .string()
              .regex(/^\d{1,30}$/)
              .optional(),
            replyEventAt: z.number().optional(),
            /** The requester is an SDP VIP user; only sent to clients that name SDP_VIP_FEATURE. */
            vip: z.literal(true).optional(),
            /** Only sent to clients that name SDP_REQUESTER_FEATURE. */
            requesterName: z.string().max(200).optional(),
          })
          .strict(),
      )
      .max(SDP_MAX_PAGE_SIZE),
  })
  .strict();
export type SdpQueuePage = z.infer<typeof SdpQueuePageSchema>;
export type SdpQueue = SdpQueuePage['queue'];
export type SdpQueueTicket = SdpQueuePage['tickets'][number];
/**
 * Which tickets on the visible queue page have notes. A separate read keeps the strict queue row
 * format unchanged for older clients; an older server rejects it and rows show no notes indicator.
 */
export const SdpQueueNotesCommandSchema = z
  .object({
    action: z.literal('readQueueNotes'),
    queue: SdpQueueSchema,
    page: z.number().int().min(0).max(19),
  })
  .strict();
export const SdpQueueNotesSchema = SdpQueueNotesCommandSchema.omit({ action: true })
  .extend({ ids: z.array(z.string().regex(/^\d{1,30}$/)).max(SDP_MAX_PAGE_SIZE) })
  .strict();
export type SdpQueueNotes = z.infer<typeof SdpQueueNotesSchema>;
/** Searches every SDP request the person can see; older servers reject it before answering. */
export const SdpTicketSearchCommandSchema = z
  .object({
    action: z.literal('searchTickets'),
    query: z.string().trim().min(1).max(200),
    page: z.number().int().min(0).max(19),
  })
  .strict();
export const SdpTicketSearchSchema = SdpTicketSearchCommandSchema.omit({ action: true })
  .extend({
    hasMore: z.boolean(),
    tickets: SdpQueuePageSchema.shape.tickets.element.array().max(SDP_PAGE_SIZE),
  })
  .strict();
export type SdpTicketSearch = z.infer<typeof SdpTicketSearchSchema>;

export const SdpDetailCommandSchema = z
  .object({
    action: z.literal('readDetail'),
    includeAutoNotifications: z.boolean().optional(),
    id: z.string().regex(/^\d{1,30}$/),
    page: z.number().int().min(0).max(19),
  })
  .strict();
export const SdpDetailSchema = z
  .object({
    includeAutoNotifications: z.boolean().optional(),
    id: z.string().regex(/^\d{1,30}$/),
    description: z.string().max(100000),
    attachments: z.array(SdpAttachmentSchema).max(200).optional(),
    properties: z
      .array(z.object({ label: z.string().max(200), value: z.string().max(100000) }).strict())
      .max(250)
      .optional(),
    resolution: z.string().max(100000).optional(),
    notesError: z.string().max(300).optional(),
    notesHasMore: z.boolean().optional(),
    notes: z
      .array(
        z
          .object({
            id: z.string().regex(/^\d{1,30}$/),
            body: z.string().max(100000),
            author: z.string().max(200),
            createdAt: z.number().nullable(),
          })
          .strict(),
      )
      .max(10)
      .optional(),
    page: z.number().int().min(0).max(19),
    hasMore: z.boolean(),
    conversationError: z.string().max(300).optional(),
    conversations: z
      .array(
        z
          .object({
            id: z.string().regex(/^\d{1,30}$/),
            subject: z.string().max(250),
            body: z.string().max(100000),
            author: z.string().max(200),
            createdAt: z.number().nullable(),
          })
          .strict(),
      )
      .max(10),
  })
  .strict();
export type SdpDetail = z.infer<typeof SdpDetailSchema>;

export const SdpMonitorCommandSchema = z
  .object({
    action: z.literal('monitorQueues'),
    enabled: z.boolean().optional(),
    after: z.number().optional(),
    /** Added queues to watch beside SDP_QUEUES; older clients never send it. */
    queues: z.array(SdpQueueSchema).max(SDP_MAX_QUEUES).optional(),
  })
  .strict();
export const SdpMonitoringSchema = z
  .object({
    state: z.enum(['starting', 'live', 'backoff', 'off']),
    failure: z.enum(['outage', 'denied', 'invalid', 'throttled', 'timeout', 'unknown']).optional(),
    nextCheckAt: z.number(),
  })
  .strict();
export const SdpMonitorSchema = z
  .object({
    /** Up to 1000 per queue; a client that sent no added queues receives only SDP_QUEUES. */
    tickets: z.array(SdpQueuePageSchema.shape.tickets.element).max(1000 * SDP_MAX_QUEUES),
    generation: z.string().optional(),
    startedAt: z.number().optional(),
    fetchedAt: z.number(),
    truncated: z.boolean(),
  })
  .strict();
export type SdpMonitor = z.infer<typeof SdpMonitorSchema>;
export const SdpAccountCommandSchema = z.discriminatedUnion('action', [
  SdpTicketRelationsCommandSchema,
  z.object({ action: z.literal('status') }).strict(),
  z.object({ action: z.literal('refreshVisible') }).strict(),
  z.object({ action: z.literal('readAccount') }).strict(),
  z.object({ action: z.literal('connect') }).strict(),
  z.object({ action: z.literal('disconnect') }).strict(),
  z.object({ action: z.literal('readTestTicket') }).strict(),
  SdpQueueCommandSchema,
  SdpDetailCommandSchema,
  SdpResourceCommandSchema,
  SdpHistoryCommandSchema,
  SdpChangesCommandSchema,
  SdpWorkflowLinkCommandSchema,
  SdpResourceChoicesCommandSchema,
  SdpFormCommandSchema,
  SdpOptionsCommandSchema,
  SdpStandardOptionsCommandSchema,
  SdpReplyCommandSchema,
  SdpForwardCommandSchema,
  SdpDownloadCommandSchema,
  SdpInlineImagesCommandSchema,
  SdpQueueNotesCommandSchema,
  SdpTicketSearchCommandSchema,
  SdpMonitorCommandSchema,
  SdpPrepareCommandSchema,
  SdpConfirmCommandSchema,
  SdpCancelCommandSchema,
  z.object({ action: z.literal('clearCopies') }).strict(),
]);
export type SdpAccountCommand = z.infer<typeof SdpAccountCommandSchema>;

export type SdpTestTicket = {
  number: string;
  status: string;
  priority: string;
  group: string;
};

/** The signed-in person's own SDP sign-in name, returned only to that person by `readAccount`. */
export const SdpAccountProfileSchema = z
  .object({ name: z.string().min(1).max(200), email: z.string().max(254).optional() })
  .strict();
export type SdpAccountProfile = z.infer<typeof SdpAccountProfileSchema>;

/** Public projection only: no credentials, provider IDs, authorization URLs, or tokens. */
export type SdpAccountView = {
  /** Only in a `readAccount` reply; older servers and clients never exchange it. */
  account?: SdpAccountProfile;
  /** Set by the local desktop handler only; never by the remote broker. */
  testControls?: boolean;
  bulkResult?: SdpBulkResult;
  history?: SdpHistory;
  changesPage?: SdpChangesPage;
  workflowTicketMatch?: boolean;
  resourceChoices?: SdpResourceChoices;
  configured: boolean;
  status: 'disconnected' | 'connecting' | 'connected' | 'expired';
  expiresAt?: number;
  message?: string;
  ticket?: SdpTestTicket;
  monitor?: SdpMonitor;
  monitoring?: z.infer<typeof SdpMonitoringSchema>;
  review?: SdpReview;
  changeResult?: SdpChangeResult;
  queuePage?: SdpQueuePage;
  detail?: SdpDetail;
  replyActivity?: SdpQueueTicket;
  resources?: SdpResourcePage;
  form?: z.infer<typeof SdpFormSchema>;
  options?: z.infer<typeof SdpOptionsSchema>;
  replyContext?: z.infer<typeof SdpReplyContextSchema>;
  ticketRelations?: z.infer<typeof SdpTicketRelationsSchema>;
  attachmentFile?: SdpAttachmentFile;
  /** Only in a `readInlineImages` reply, which older servers reject before answering. */
  inlineImages?: SdpInlineImages;
  /** Only in a `readQueueNotes` reply, which older servers reject before answering. */
  queueNotes?: SdpQueueNotes;
  /** Only in a `searchTickets` reply, which older servers reject before answering. */
  ticketSearch?: SdpTicketSearch;
  detailSnapshot?: { source: 'live' | 'outage-cache'; fetchedAt: number; expiresAt: number };
  snapshot?: { source: 'live' | 'outage-cache'; fetchedAt: number; expiresAt: number };
};

const proof = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const SdpBrokerCommandSchema = z.discriminatedUnion('action', [
  SdpTicketRelationsCommandSchema,
  z.object({ action: z.literal('status') }).strict(),
  z.object({ action: z.literal('refreshVisible') }).strict(),
  z.object({ action: z.literal('readAccount') }).strict(),
  z.object({ action: z.literal('begin'), state: proof, challenge: proof }).strict(),
  z
    .object({
      action: z.literal('complete'),
      state: proof,
      verifier: proof,
      code: z.string().min(1).max(2048).regex(/^\S+$/),
    })
    .strict(),
  z.object({ action: z.literal('disconnect') }).strict(),
  z.object({ action: z.literal('readTestTicket') }).strict(),
  SdpQueueCommandSchema,
  SdpDetailCommandSchema,
  SdpResourceCommandSchema,
  SdpHistoryCommandSchema,
  SdpChangesCommandSchema,
  SdpWorkflowLinkCommandSchema,
  SdpResourceChoicesCommandSchema,
  SdpFormCommandSchema,
  SdpOptionsCommandSchema,
  SdpStandardOptionsCommandSchema,
  SdpReplyCommandSchema,
  SdpForwardCommandSchema,
  SdpDownloadCommandSchema,
  SdpInlineImagesCommandSchema,
  SdpQueueNotesCommandSchema,
  SdpTicketSearchCommandSchema,
  SdpMonitorCommandSchema,
  SdpPrepareCommandSchema,
  SdpConfirmCommandSchema,
  SdpCancelCommandSchema,
  z.object({ action: z.literal('clearCopies') }).strict(),
]);
export type SdpBrokerCommand = z.infer<typeof SdpBrokerCommandSchema>;
export type SdpBrokerReply = { view: SdpAccountView; authorizationUrl?: string };
export interface SdpBackend {
  /**
   * `keepSignIn` ends the session without naming the desktop, so a disconnect keeps the desktop's
   * remembered sign-in (Relay is quitting, not signing out).
   */
  invoke(command: SdpBrokerCommand, options?: { keepSignIn?: boolean }): Promise<SdpBrokerReply>;
}

export const SdpServerCommandSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('status') }).strict(),
  z
    .object({
      action: z.literal('save'),
      expectedRevision: z.string().max(64),
      client: SdpClientSchema,
      cacheMinutes: z.number().int().min(5).max(240),
    })
    .strict(),
  z.object({ action: z.literal('clear'), expectedRevision: z.string().max(64) }).strict(),
]);
export type SdpServerCommand = z.infer<typeof SdpServerCommandSchema>;
export type SdpServerView = {
  configured: boolean;
  revision: string;
  cacheMinutes: number;
  gatewayEnabled: boolean;
  gatewayPort: number;
};

export const SdpBrokerReplySchema = z
  .object({
    view: z
      .object({
        configured: z.boolean(),
        account: SdpAccountProfileSchema.optional(),
        resources: SdpResourcePageSchema.optional(),
        history: SdpHistorySchema.optional(),
        changesPage: SdpChangesPageSchema.optional(),
        workflowTicketMatch: z.boolean().optional(),
        resourceChoices: SdpResourceChoicesSchema.optional(),
        form: SdpFormSchema.optional(),
        options: SdpOptionsSchema.optional(),
        replyContext: SdpReplyContextSchema.optional(),
        ticketRelations: SdpTicketRelationsSchema.optional(),
        attachmentFile: SdpAttachmentFileSchema.optional(),
        inlineImages: SdpInlineImagesSchema.optional(),
        queueNotes: SdpQueueNotesSchema.optional(),
        ticketSearch: SdpTicketSearchSchema.optional(),
        status: z.enum(['disconnected', 'connecting', 'connected', 'expired']),
        expiresAt: z.number().optional(),
        message: z.string().max(500).optional(),
        ticket: z
          .object({
            number: z.literal(SDP_TEST_TICKET),
            status: z.string().max(200),
            priority: z.string().max(200),
            group: z.string().max(200),
          })
          .strict()
          .optional(),
        monitor: SdpMonitorSchema.optional(),
        monitoring: SdpMonitoringSchema.optional(),
        review: SdpReviewSchema.optional(),
        changeResult: SdpChangeResultSchema.optional(),
        bulkResult: SdpBulkResultSchema.optional(),
        queuePage: SdpQueuePageSchema.optional(),
        detail: SdpDetailSchema.optional(),
        replyActivity: SdpQueuePageSchema.shape.tickets.element.optional(),
        detailSnapshot: z
          .object({
            source: z.enum(['live', 'outage-cache']),
            fetchedAt: z.number(),
            expiresAt: z.number(),
          })
          .strict()
          .optional(),
        snapshot: z
          .object({
            source: z.enum(['live', 'outage-cache']),
            fetchedAt: z.number(),
            expiresAt: z.number(),
          })
          .strict()
          .optional(),
      })
      .strict(),
    authorizationUrl: z.string().max(4096).optional(),
  })
  .strict();
