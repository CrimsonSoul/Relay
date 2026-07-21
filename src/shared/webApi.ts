import { z } from 'zod';
import type { PbAuthSession, PublicRelayConfig } from './ipc';
import type { RelayRuntimeDescriptor } from './runtime';

export const RELAY_WEB_API_PREFIX = '/relay-api/v1';

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
