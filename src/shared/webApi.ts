import { z } from 'zod';
import type { CloudStatusData, PbAuthSession, PublicRelayConfig } from './ipc';
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

export const RELAY_WEB_API_PREFIX = '/relay-api/v1';

export const WebIdentifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/u);

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
