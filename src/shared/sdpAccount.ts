import { SdpWorkflowLinkCommandSchema } from './sdpWorkflowLink';
import { SdpChangesCommandSchema, SdpChangesPageSchema, type SdpChangesPage } from './sdpChanges';
import {
  SdpResourceChoicesCommandSchema,
  SdpResourceChoicesSchema,
  type SdpResourceChoices,
} from './sdpResources';
import { SdpForwardCommandSchema } from './sdpForm';
import { SdpHistoryCommandSchema, SdpHistorySchema, type SdpHistory } from './sdpHistory';
import { SdpBulkResultSchema, type SdpBulkResult } from './sdpMutation';
import { SdpLastReplySchema } from './sdpReplies';
import { SdpTicketRelationsCommandSchema, SdpTicketRelationsSchema } from './sdpTicketRelations';
import { SdpQueueFiltersSchema } from './sdpQueueFilters';
import {
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
  type SdpAttachmentFile,
} from './sdpAttachments';
import {
  SdpResourceCommandSchema,
  SdpResourcePageSchema,
  type SdpResourcePage,
} from './sdpResources';
import {
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

export const SDP_QUEUES = ['NOC', 'SOX', 'Unassigned'] as const;
export const SDP_PAGE_SIZE = 50;
export const SdpQueueCommandSchema = z
  .object({
    action: z.literal('readQueue'),
    filters: SdpQueueFiltersSchema.optional(),
    queue: z.enum(SDP_QUEUES),
    page: z.number().int().min(0).max(19),
  })
  .strict();
export const SdpQueuePageSchema = z
  .object({
    filters: SdpQueueFiltersSchema.optional(),
    queue: z.enum(SDP_QUEUES),
    page: z.number().int().min(0).max(19),
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
            group: z.enum(SDP_QUEUES),
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
          })
          .strict(),
      )
      .max(SDP_PAGE_SIZE),
  })
  .strict();
export type SdpQueuePage = z.infer<typeof SdpQueuePageSchema>;
export type SdpQueue = SdpQueuePage['queue'];
export type SdpQueueTicket = SdpQueuePage['tickets'][number];

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
    tickets: z.array(SdpQueuePageSchema.shape.tickets.element).max(3000),
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

/** Public projection only: no credentials, identity claims, authorization URLs, or tokens. */
export type SdpAccountView = {
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
  detailSnapshot?: { source: 'live' | 'outage-cache'; fetchedAt: number; expiresAt: number };
  snapshot?: { source: 'live' | 'outage-cache'; fetchedAt: number; expiresAt: number };
};

const proof = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const SdpBrokerCommandSchema = z.discriminatedUnion('action', [
  SdpTicketRelationsCommandSchema,
  z.object({ action: z.literal('status') }).strict(),
  z.object({ action: z.literal('refreshVisible') }).strict(),
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
  SdpMonitorCommandSchema,
  SdpPrepareCommandSchema,
  SdpConfirmCommandSchema,
  SdpCancelCommandSchema,
  z.object({ action: z.literal('clearCopies') }).strict(),
]);
export type SdpBrokerCommand = z.infer<typeof SdpBrokerCommandSchema>;
export type SdpBrokerReply = { view: SdpAccountView; authorizationUrl?: string };
export interface SdpBackend {
  invoke(command: SdpBrokerCommand): Promise<SdpBrokerReply>;
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
