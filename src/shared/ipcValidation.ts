/**
 * IPC Validation Schemas
 *
 * Runtime validation for IPC messages to provide defense-in-depth.
 * While TypeScript provides compile-time safety, these schemas validate
 * data at the IPC boundary to protect against malformed messages from
 * a potentially compromised renderer process.
 */

/* eslint-disable sonarjs/deprecation */
import { z } from 'zod';
import {
  MAX_PRIVILEGED_DEVICE_LABEL_LENGTH,
  MAX_PRIVILEGED_PASSWORD_LENGTH,
  MIN_PRIVILEGED_PASSWORD_LENGTH,
} from './privilegedAccess';
import { TAB_NAMES, type PublicPrivilegedCommandRequest } from './ipc';
import {
  isPublicPrivilegedCommandName,
  normalizePrivilegedCommandPayload,
} from './privilegedCommands';
import { getRoleUsernameError, normalizeRoleUsername } from './roleAccounts';
import {
  boundedSearchLimit,
  isKnowledgeSearchQueryEligible,
  isKnowledgeSearchQueryWithinCodePointLimit,
  normalizeKnowledgeSearchQuery,
  type KnowledgeSearchRequest,
} from './knowledgeSearch';

// ==================== Size Limits ====================
const MAX_NAME = 500;
const MAX_FIELD = 1000;
const MAX_NOTE = 10000;
const MAX_HTML_BODY = 750000;
const MAX_SEARCH = 2000;
const MAX_ID = 200;
const MAX_ARRAY_ITEMS = 500;
const MAX_GROUP_CONTACTS = 200;

export const TabNameSchema = z.enum(TAB_NAMES);

export const KnowledgePdfRequestSchema = z
  .object({
    documentId: z
      .string()
      .min(1)
      .max(MAX_ID)
      .regex(/^[A-Za-z0-9]+$/),
    checksum: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();

export const KnowledgeCoverRequestSchema = KnowledgePdfRequestSchema;

export const KnowledgeUploadControlIdSchema = z
  .string()
  .min(1)
  .max(MAX_ID)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

export const KnowledgeSearchRequestIdSchema = z
  .string()
  .min(1)
  .max(MAX_ID)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

const KnowledgeSearchScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('all') }).strict(),
  z
    .object({
      kind: z.literal('document'),
      documentId: KnowledgeSearchRequestIdSchema,
    })
    .strict(),
]);

const KnowledgeSearchQuerySchema = z
  .string()
  .refine(isKnowledgeSearchQueryWithinCodePointLimit, 'Knowledge search query is too long.')
  .transform(normalizeKnowledgeSearchQuery)
  .refine(isKnowledgeSearchQueryWithinCodePointLimit, 'Knowledge search query is too long.')
  .refine(isKnowledgeSearchQueryEligible, 'Knowledge search query is not eligible.');

export const KnowledgeSearchRequestSchema = z
  .object({
    requestId: KnowledgeSearchRequestIdSchema,
    query: KnowledgeSearchQuerySchema,
    scope: KnowledgeSearchScopeSchema,
    categoryId: KnowledgeSearchRequestIdSchema.nullable(),
    documentType: z.enum(['sop', 'cheatsheet']).nullable(),
    limit: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  })
  .strict()
  .transform(
    (input): KnowledgeSearchRequest => ({
      ...input,
      limit: boundedSearchLimit(input.scope, input.limit),
    }),
  );

const privilegedPasswordSchema = z
  .string()
  .min(MIN_PRIVILEGED_PASSWORD_LENGTH)
  .max(MAX_PRIVILEGED_PASSWORD_LENGTH);

const privilegedUsernameSchema = z.string().transform((value, context) => {
  const error = getRoleUsernameError(value);
  if (error) {
    context.addIssue({ code: 'custom', message: error });
    return z.NEVER;
  }
  return normalizeRoleUsername(value);
});

export const PrivilegedLoginSchema = z
  .object({
    username: privilegedUsernameSchema,
    password: privilegedPasswordSchema,
  })
  .strict();

export const PrivilegedReauthenticationSchema = z
  .object({ password: privilegedPasswordSchema })
  .strict();

export const PrivilegedInitialOwnerSetupSchema = z
  .object({
    username: privilegedUsernameSchema,
    password: privilegedPasswordSchema,
    passwordConfirm: privilegedPasswordSchema,
  })
  .strict()
  .refine((input) => input.password === input.passwordConfirm, {
    message: 'Passwords must match.',
    path: ['passwordConfirm'],
  });

export const PrivilegedCredentialSetupSchema = z
  .object({
    accountId: z
      .string()
      .trim()
      .min(1)
      .max(MAX_ID)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
    password: privilegedPasswordSchema,
    passwordConfirm: privilegedPasswordSchema,
  })
  .strict()
  .refine((input) => input.password === input.passwordConfirm, {
    message: 'Passwords must match.',
    path: ['passwordConfirm'],
  });

export const PrivilegedPairingTargetAccountSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_ID)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

export const PrivilegedPairingCompletionSchema = z
  .object({
    challengeId: z
      .string()
      .min(1)
      .max(MAX_ID)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
    code: z.string().regex(/^[A-HJ-NP-Z2-9]{8}$/),
    deviceLabel: z.string().trim().min(1).max(MAX_PRIVILEGED_DEVICE_LABEL_LENGTH),
  })
  .strict();

export const PublicPrivilegedCommandRequestSchema = z
  .object({
    command: z.string(),
    payload: z.unknown(),
    expectedRevision: z.number().int().min(0).nullable(),
  })
  .strict()
  .transform((input, context): PublicPrivilegedCommandRequest => {
    if (!isPublicPrivilegedCommandName(input.command)) {
      context.addIssue({ code: 'custom', message: 'Unsupported privileged command.' });
      return z.NEVER;
    }
    const payload = normalizePrivilegedCommandPayload(input.command, input.payload);
    if (!payload) {
      context.addIssue({ code: 'custom', message: 'Invalid privileged command payload.' });
      return z.NEVER;
    }
    return {
      command: input.command,
      payload,
      expectedRevision: input.expectedRevision,
    } as PublicPrivilegedCommandRequest;
  });

// ==================== Contact Schemas ====================
export const ContactSchema = z.object({
  name: z.string().min(1).max(MAX_NAME),
  email: z.string().email().max(MAX_FIELD),
  phone: z.string().max(MAX_FIELD),
  title: z.string().max(MAX_FIELD),
  _searchString: z.string().max(MAX_SEARCH).optional(),
  raw: z
    .object({
      id: z.string().max(MAX_ID).optional(),
      createdAt: z.number().optional(),
      updatedAt: z.number().optional(),
    })
    .passthrough()
    .optional(),
});

// ==================== Server Schemas ====================
export const ServerSchema = z.object({
  name: z.string().min(1).max(MAX_NAME),
  businessArea: z.string().max(MAX_FIELD),
  lob: z.string().max(MAX_FIELD),
  comment: z.string().max(MAX_NOTE),
  // owner and contact may contain emails or free-text names
  owner: z.string().max(MAX_FIELD),
  contact: z.string().max(MAX_FIELD),
  os: z.string().max(MAX_FIELD),
  _searchString: z.string().max(MAX_SEARCH).optional(),
  raw: z
    .object({
      id: z.string().max(MAX_ID).optional(),
      createdAt: z.number().optional(),
      updatedAt: z.number().optional(),
    })
    .passthrough()
    .optional(),
});

// ==================== OnCall Schemas ====================
export const OnCallRowSchema = z.object({
  id: z.string().max(MAX_ID),
  team: z.string().min(1).max(MAX_NAME),
  teamId: z.string().max(MAX_NAME),
  role: z.string().max(MAX_FIELD),
  name: z.string().max(MAX_NAME),
  contact: z.string().max(MAX_FIELD),
  timeWindow: z.string().max(MAX_FIELD).optional(),
});

export const OnCallRowsArraySchema = z.array(OnCallRowSchema).max(MAX_ARRAY_ITEMS);

// ==================== Group Schemas ====================
export const GroupSchema = z.object({
  id: z.string().max(MAX_ID).optional(),
  name: z.string().min(1).max(MAX_NAME),
  contacts: z.array(z.string().email().max(MAX_FIELD)).max(MAX_GROUP_CONTACTS),
  createdAt: z.number().optional(),
  updatedAt: z.number().optional(),
});

export const GroupUpdateSchema = z.object({
  name: z.string().min(1).max(MAX_NAME).optional(),
  contacts: z.array(z.string().email().max(MAX_FIELD)).max(MAX_GROUP_CONTACTS).optional(),
});

// ==================== Bridge History Schemas ====================
export const BridgeHistoryEntrySchema = z.object({
  id: z.string().max(MAX_ID).optional(),
  timestamp: z.number().optional(),
  note: z.string().max(MAX_NOTE),
  groups: z.array(z.string().max(MAX_NAME)).max(MAX_ARRAY_ITEMS),
  contacts: z.array(z.string().email().max(MAX_FIELD)).max(MAX_ARRAY_ITEMS),
  recipientCount: z.number().int().min(0).max(100000),
});

// ==================== Alert History Schemas ====================
export const AlertHistoryEntrySchema = z.object({
  id: z.string().max(MAX_ID).optional(),
  timestamp: z.number().optional(),
  severity: z.enum(['ISSUE', 'MAINTENANCE', 'INFO', 'RESOLVED']),
  subject: z.string().max(MAX_NOTE),
  bodyHtml: z.string().max(MAX_HTML_BODY),
  sender: z.string().max(MAX_NOTE),
  recipient: z.string().max(MAX_NOTE),
  pinned: z.boolean().optional(),
  label: z.string().max(MAX_NOTE).optional(),
});

// ==================== Data Record Input Schemas ====================

export const ContactRecordInputSchema = z.object({
  name: z.string().min(1).max(MAX_NAME),
  email: z.string().email().max(MAX_FIELD),
  phone: z.string().max(MAX_FIELD),
  title: z.string().max(MAX_FIELD),
});

export const ServerRecordInputSchema = z.object({
  name: z.string().min(1).max(MAX_NAME),
  businessArea: z.string().max(MAX_FIELD),
  lob: z.string().max(MAX_FIELD),
  comment: z.string().max(MAX_NOTE),
  // owner and contact may contain emails or free-text names
  owner: z.string().max(MAX_FIELD),
  contact: z.string().max(MAX_FIELD),
  os: z.string().max(MAX_FIELD),
});

export const OnCallRecordInputSchema = z.object({
  team: z.string().min(1).max(MAX_NAME),
  role: z.string().max(MAX_FIELD),
  name: z.string().max(MAX_NAME),
  contact: z.string().max(MAX_FIELD),
  timeWindow: z.string().max(MAX_FIELD).optional(),
});

export const ContactRecordUpdateSchema = ContactRecordInputSchema.partial().strict();
export const ServerRecordUpdateSchema = ServerRecordInputSchema.partial().strict();
export const OnCallRecordUpdateSchema = OnCallRecordInputSchema.partial().strict();

// ==================== Persistence-Layer Record Schemas ====================
// Lenient schemas for validating records read from disk. These only check that
// required fields exist with the correct type — no strict constraints like
// email format or min-length, since historical data may not conform.

export const ContactRecordSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  phone: z.string(),
  title: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export const ServerRecordSchema = z.object({
  id: z.string(),
  name: z.string(),
  businessArea: z.string(),
  lob: z.string(),
  comment: z.string(),
  owner: z.string(),
  contact: z.string(),
  os: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export const OnCallRecordSchema = z.object({
  id: z.string(),
  team: z.string(),
  role: z.string(),
  name: z.string(),
  contact: z.string(),
  timeWindow: z.string().optional().default(''),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export const SearchQuerySchema = z
  .string()
  .min(1)
  .max(200)
  .refine((s) => !/[<>{}`;|$\\]/.test(s), 'Invalid characters in search query');

export const ExportOptionsSchema = z.object({
  format: z.enum(['json', 'csv', 'excel']),
  category: z.enum([
    'contacts',
    'servers',
    'oncall',
    'groups',
    'bridge_history',
    'alert_history',
    'notes',
    'all',
  ]),
  includeMetadata: z.boolean().optional(),
});

export const DataCategorySchema = z.enum([
  'contacts',
  'servers',
  'oncall',
  'groups',
  'bridge_history',
  'alert_history',
  'notes',
  'all',
]);

// ==================== Note Schemas ====================
export const NotesTagsSchema = z.array(z.string().max(50)).max(20).optional();

export const LogEntrySchema = z.object({
  level: z.enum(['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL']),
  module: z.string().max(100),
  message: z.string().max(5000),
  data: z.unknown().optional(),
  timestamp: z.string().optional(),
});

// ==================== Utility Functions ====================

/**
 * Validates and returns the parsed data, or returns null with logged error
 */
export function validateIpcDataSafe<T>(
  schema: z.ZodType<T>,
  data: unknown,
  context: string,
  logger?: (msg: string, data?: Record<string, unknown>) => void,
): T | null {
  const result = schema.safeParse(data);
  if (!result.success) {
    const errorData = { message: result.error.message, issues: result.error.issues };
    if (logger) {
      logger(`IPC validation failed for ${context}`, { error: errorData });
    } else {
      // Fallback for callers that don't provide a logger (all current callers do)
      console.error(`IPC validation failed for ${context}:`, errorData);
    }
    return null;
  }
  return result.data;
}
