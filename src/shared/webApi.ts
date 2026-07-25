import { z } from 'zod';
import type {
  CloudStatusData,
  PbAuthSession,
  PrivilegedApprovalRequestView,
  PrivilegedCredentialSetupView,
  PrivilegedIpcResult,
  PrivilegedPairingCompletionView,
  PrivilegedReauthenticationProof,
  PublicRelayConfig,
} from './ipc';
import type { PrivilegedCommandResult } from './privilegedCommands';
import type { PrivilegedPairingChallengeView, PrivilegedSessionView } from './privilegedAccess';
import { getDynatraceStartUrlError, type DynatraceDashboardState } from './dynatrace';
import {
  MAX_DYNATRACE_ALERTING_PROFILES,
  MAX_DYNATRACE_ALERTING_PROFILE_LENGTH,
  MAX_DYNATRACE_API_TOKEN_LENGTH,
  getDynatraceApiTokenError,
  getDynatraceEnvironmentUrlError,
  type DynatraceProblemsPublicSettings,
} from './dynatraceProblems';
import type { RelayRuntimeDescriptor } from './runtime';
import {
  KNOWLEDGE_MAX_PDF_BYTES,
  KNOWLEDGE_UPLOAD_MAX_FILES,
  type KnowledgePdfRequest,
  type KnowledgeIndexStatus,
} from './knowledge';
import {
  KNOWLEDGE_SEARCH_GLOBAL_LIMIT,
  KNOWLEDGE_SEARCH_MAX_QUERY_CODE_POINTS,
  type KnowledgeSearchRequest,
} from './knowledgeSearch';

export const RELAY_WEB_API_PREFIX = '/relay-api/v1';

export const WebIdentifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/u);

export const WebKnowledgeDocumentRequestSchema: z.ZodType<KnowledgePdfRequest> = z
  .object({
    documentId: z
      .string()
      .min(1)
      .max(200)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u),
    checksum: z.string().regex(/^[0-9a-f]{64}$/u),
  })
  .strict();

export const WebKnowledgeSearchRequestSchema: z.ZodType<KnowledgeSearchRequest> = z
  .object({
    requestId: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u),
    query: z.string().trim().min(1).max(KNOWLEDGE_SEARCH_MAX_QUERY_CODE_POINTS),
    scope: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('all') }).strict(),
      z
        .object({
          kind: z.literal('document'),
          documentId: z.string().min(1).max(200),
        })
        .strict(),
    ]),
    categoryId: z.string().min(1).max(200).nullable(),
    documentType: z.enum(['sop', 'cheatsheet']).nullable(),
    limit: z.number().int().min(1).max(KNOWLEDGE_SEARCH_GLOBAL_LIMIT),
  })
  .strict();

export const WebKnowledgeSearchCancelSchema = z.object({ requestId: WebIdentifierSchema }).strict();

export const WebKnowledgeUploadBeginSchema = z
  .object({
    files: z
      .array(
        z
          .object({
            name: z.string().min(1).max(240),
            size: z.number().int().min(5).max(KNOWLEDGE_MAX_PDF_BYTES),
          })
          .strict(),
      )
      .min(1)
      .max(KNOWLEDGE_UPLOAD_MAX_FILES),
    replacementDocumentId: z
      .string()
      .min(1)
      .max(200)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u)
      .optional(),
  })
  .strict();

export const WebKnowledgeUploadBatchSchema = z.object({ batchId: WebIdentifierSchema }).strict();

export const WebKnowledgeUploadStagingBatchSchema = z
  .object({
    batchId: WebIdentifierSchema,
    files: z
      .array(
        z
          .object({
            id: WebIdentifierSchema,
            name: z.string().min(1).max(240),
            size: z.number().int().min(5).max(KNOWLEDGE_MAX_PDF_BYTES),
          })
          .strict(),
      )
      .min(1)
      .max(KNOWLEDGE_UPLOAD_MAX_FILES),
  })
  .strict();

export const WebKnowledgeUploadControlSchema = z.object({ id: WebIdentifierSchema }).strict();

export const WebKnowledgeIndexStatusSchema: z.ZodType<KnowledgeIndexStatus> = z
  .object({
    state: z.enum(['idle', 'indexing', 'warning', 'error']),
    documentCount: z.number().int().nonnegative(),
    categoryCount: z.number().int().nonnegative(),
    lastIndexedAt: z.iso.datetime().nullable(),
    message: z.string().max(1_000).optional(),
  })
  .strict();

export const WebDynatraceDashboardInputSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    url: z
      .string()
      .trim()
      .max(2048)
      .refine((value) => getDynatraceStartUrlError(value) === null),
  })
  .strict();

export const WebDynatraceDashboardStateSchema: z.ZodType<DynatraceDashboardState> = z
  .object({
    id: z.string().min(1).max(128),
    name: z.string().min(1).max(100),
    url: z.url().max(2048),
    state: z.enum(['live', 'authenticating', 'blocked', 'load-failed', 'closed']),
    lastUrl: z.string().max(2048).optional(),
    error: z.string().max(1000).optional(),
    bounds: z
      .object({
        x: z.number().optional(),
        y: z.number().optional(),
        width: z.number(),
        height: z.number(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const WebDynatraceDashboardIdSchema = z.object({ id: WebIdentifierSchema }).strict();
export const WebDynatraceDashboardUpdateSchema = z
  .object({ id: WebIdentifierSchema, input: WebDynatraceDashboardInputSchema })
  .strict();

export const WebDynatraceProblemsSettingsInputSchema = z
  .object({
    environmentUrl: z
      .string()
      .max(2048)
      .refine((value) => getDynatraceEnvironmentUrlError(value) === null),
    apiToken: z
      .string()
      .max(MAX_DYNATRACE_API_TOKEN_LENGTH)
      .refine((value) => !value.trim() || getDynatraceApiTokenError(value) === null)
      .optional(),
  })
  .strict();

export const WebDynatraceProblemsPublicSettingsSchema: z.ZodType<DynatraceProblemsPublicSettings> =
  z
    .object({
      configured: z.boolean(),
      environmentUrl: z.string().max(2048),
      profileFilterConfigured: z.boolean(),
      selectedAlertingProfiles: z.array(z.string().max(MAX_DYNATRACE_ALERTING_PROFILE_LENGTH)),
    })
    .strict();

export const WebDynatraceProblemProfileFilterSchema = z
  .object({
    alertingProfiles: z
      .array(z.string().trim().min(1).max(MAX_DYNATRACE_ALERTING_PROFILE_LENGTH))
      .min(1)
      .max(MAX_DYNATRACE_ALERTING_PROFILES)
      .transform((profiles) => [...new Set(profiles)]),
  })
  .strict();

export const WebBrandAssetInputSchema = z
  .object({
    dataUrl: z
      .string()
      .max(2_800_000)
      .regex(/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/u),
  })
  .strict();

export const WebBrandAssetResultSchema = z
  .string()
  .max(2_800_000)
  .regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/u)
  .nullable();

export const WebDynatraceProblemsTestResultSchema = z
  .object({ reachable: z.boolean(), problemCount: z.number().int().nonnegative() })
  .strict();

export const WebCountResultSchema = z.object({ count: z.number().int().nonnegative() }).strict();

const PrivilegedCapabilitySchema = z.enum([
  'privileged.status.read',
  'accounts.manage',
  'ownership.transfer',
  'publisher.assign',
  'devices.manage',
  'settings.manage',
  'knowledge.manage',
]);

export const WebPrivilegedSessionSchema: z.ZodType<PrivilegedSessionView> = z
  .object({
    state: z.enum(['signed-out', 'pairing-required', 'active', 'offline']),
    accountId: z.string().max(200).nullable(),
    username: z.string().max(64).nullable(),
    displayName: z.string().max(120).nullable(),
    role: z.enum(['owner', 'admin', 'publisher']).nullable(),
    capabilities: z.array(PrivilegedCapabilitySchema).max(7),
    deviceId: z.string().max(200).nullable(),
    expiresAt: z.iso.datetime().nullable(),
  })
  .strict();

export const WebPrivilegedApprovalRequestSchema: z.ZodType<PrivilegedApprovalRequestView> = z
  .object({
    requestId: z.string().min(1).max(128),
    operation: z.enum(['initial-owner-credential', 'credential-recovery']),
    sourceLabel: z.string().min(1).max(160),
    createdAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
  })
  .strict();

const PrivilegedIpcErrorSchema = z.enum([
  'invalid-input',
  'invalid-credentials',
  'unauthorized',
  'locked',
  'offline',
  'pairing-required',
  'conflict',
  'approval-required',
  'server-error',
]);

export function webPrivilegedIpcResultSchema<T extends z.ZodType>(value: T) {
  return z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), value }).strict(),
    z
      .object({
        ok: z.literal(false),
        error: PrivilegedIpcErrorSchema,
        approvalRequest: WebPrivilegedApprovalRequestSchema.optional(),
      })
      .strict(),
  ]) as z.ZodType<PrivilegedIpcResult<z.infer<T>>>;
}

export const WebPrivilegedReauthenticationProofSchema: z.ZodType<PrivilegedReauthenticationProof> =
  z.object({ proofId: z.string().min(1).max(128), expiresAt: z.iso.datetime() }).strict();

export const WebPrivilegedPairingCompletionSchema: z.ZodType<PrivilegedPairingCompletionView> = z
  .object({
    deviceId: z.string().min(1).max(200),
    fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
    pairedAt: z.iso.datetime(),
  })
  .strict();

export const WebPrivilegedPairingChallengeSchema: z.ZodType<PrivilegedPairingChallengeView> = z
  .object({
    challengeId: z.string().min(1).max(200),
    accountId: z.string().min(1).max(200),
    code: z.string().regex(/^[A-HJ-NP-Z2-9]{8}$/),
    expiresAt: z.iso.datetime(),
  })
  .strict();

export const WebPrivilegedCredentialSetupViewSchema: z.ZodType<PrivilegedCredentialSetupView> = z
  .object({
    accountId: z.string().min(1).max(200),
    username: z.string().min(1).max(64),
    displayName: z.string().min(1).max(120),
    storedRole: z.enum(['administrator', 'publisher']),
    role: z.enum(['owner', 'admin', 'publisher']),
    credentialState: z.literal('configured'),
    credentialVersion: z.number().int().nonnegative(),
  })
  .strict();

export const WebPrivilegedCommandResultSchema: z.ZodType<PrivilegedCommandResult> =
  z.discriminatedUnion('ok', [
    z
      .object({
        ok: z.literal(true),
        requestId: z.string().min(1).max(128),
        value: z.unknown(),
      })
      .strict(),
    z
      .object({
        ok: z.literal(false),
        requestId: z.string().min(1).max(128).optional(),
        error: z.enum([
          'unauthorized',
          'locked',
          'offline',
          'pairing-required',
          'invalid-request',
          'insufficient-storage',
          'duplicate-file-name',
          'expired',
          'replayed',
          'conflict',
          'server-error',
        ]),
        message: z.string().max(2_000).optional(),
        currentRevision: z.number().int().nonnegative().optional(),
        refresh: z.literal(true).optional(),
      })
      .strict(),
  ]);

const CloudStatusProviderSchema = z.enum([
  'aws',
  'azure',
  'm365',
  'jira',
  'github',
  'cloudflare',
  'google',
  'anthropic',
  'openai',
  'salesforce',
]);

const CloudStatusItemSchema = z
  .object({
    id: z.string().max(512),
    provider: CloudStatusProviderSchema,
    title: z.string().max(2_000),
    description: z.string().max(20_000),
    pubDate: z.string().max(100),
    link: z.string().max(2_048),
    severity: z.enum(['info', 'warning', 'error', 'resolved']),
  })
  .strict();

export const WebCloudStatusDataSchema: z.ZodType<CloudStatusData> = z
  .object({
    providers: z
      .object({
        aws: z.array(CloudStatusItemSchema),
        azure: z.array(CloudStatusItemSchema),
        m365: z.array(CloudStatusItemSchema),
        jira: z.array(CloudStatusItemSchema),
        github: z.array(CloudStatusItemSchema),
        cloudflare: z.array(CloudStatusItemSchema),
        google: z.array(CloudStatusItemSchema),
        anthropic: z.array(CloudStatusItemSchema),
        openai: z.array(CloudStatusItemSchema),
        salesforce: z.array(CloudStatusItemSchema),
      })
      .strict(),
    lastUpdated: z.number().nonnegative(),
    errors: z
      .array(
        z.object({ provider: CloudStatusProviderSchema, message: z.string().max(2_000) }).strict(),
      )
      .max(100),
  })
  .strict();

export function webIpcResultSchema<T extends z.ZodType>(data: T) {
  return z
    .object({
      success: z.boolean(),
      data: data.optional(),
      error: z.string().max(2_000).optional(),
      rateLimited: z.boolean().optional(),
    })
    .strict();
}

const RuntimeCapabilitiesSchema = z
  .object({
    connectionConfiguration: z.boolean(),
    pocketBaseRecovery: z.boolean(),
    offlineCache: z.boolean(),
    offlineMutations: z.boolean(),
    nativeWindowControls: z.boolean(),
    customReminderSound: z.boolean(),
    imageClipboard: z.boolean(),
    privilegedAccess: z.boolean(),
    knowledgePublishing: z.boolean(),
  })
  .strict();

const WebRuntimeDescriptorSchema: z.ZodType<RelayRuntimeDescriptor> = z
  .object({
    kind: z.literal('web'),
    label: z.literal('Web'),
    capabilities: RuntimeCapabilitiesSchema,
  })
  .strict();

const PbAuthSessionSchema: z.ZodType<PbAuthSession> = z
  .object({
    token: z.string().min(1),
    record: z.record(z.string(), z.unknown()).nullable(),
  })
  .strict();

const PublicServerConfigSchema: z.ZodType<Extract<PublicRelayConfig, { mode: 'server' }>> = z
  .object({
    mode: z.literal('server'),
    port: z.number().int().min(1024).max(65535),
    bindHost: z.enum(['127.0.0.1', '0.0.0.0']).optional(),
    lanIp: z.string().min(1).max(255).optional(),
    web: z
      .object({
        enabled: z.boolean(),
        port: z.number().int().min(1024).max(65535),
      })
      .strict()
      .optional(),
  })
  .strict();

export const WebSessionLoginInputSchema = z
  .object({
    passphrase: z.string().min(8).max(256),
  })
  .strict();

export type WebSessionLoginInput = z.infer<typeof WebSessionLoginInputSchema>;

export const WebSessionBootstrapSchema = z
  .object({
    csrfToken: z.string().min(32).max(512),
    pbUrl: z.url(),
    auth: PbAuthSessionSchema,
    publicConfig: PublicServerConfigSchema,
    runtime: WebRuntimeDescriptorSchema,
    presenceLabel: z.string().min(1).max(160).optional(),
  })
  .strict();

export type WebSessionBootstrap = z.infer<typeof WebSessionBootstrapSchema>;

export const WebSessionBootstrapResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), session: WebSessionBootstrapSchema }).strict(),
  z
    .object({
      ok: z.literal(false),
      error: z.enum(['unauthenticated', 'unavailable']),
    })
    .strict(),
]);

export type WebSessionBootstrapResult = z.infer<typeof WebSessionBootstrapResultSchema>;
