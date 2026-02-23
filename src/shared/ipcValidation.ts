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

// ==================== Size Limits ====================
const MAX_NAME = 500;
const MAX_FIELD = 1000;
const MAX_NOTE = 10000;
const MAX_SEARCH = 2000;
const MAX_ID = 200;
const MAX_ARRAY_ITEMS = 500;
const MAX_GROUP_CONTACTS = 200;

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
  // owner and contact are email fields (can be empty when unknown)
  owner: z.union([z.literal(''), z.string().email().max(MAX_FIELD)]),
  contact: z.union([z.literal(''), z.string().email().max(MAX_FIELD)]),
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
  recipientCount: z.number(),
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
  // owner and contact are email fields (can be empty when unknown)
  owner: z.union([z.literal(''), z.string().email().max(MAX_FIELD)]),
  contact: z.union([z.literal(''), z.string().email().max(MAX_FIELD)]),
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

export const TeamLayoutSchema = z
  .record(
    z.string().max(MAX_NAME),
    z.object({
      x: z.number(),
      y: z.number(),
      w: z.number().optional(),
      h: z.number().optional(),
      static: z.boolean().optional(),
    }),
  )
  .refine((obj) => Object.keys(obj).length <= 100, 'Too many teams in layout (max 100)')
  .optional();

export const RadarSnapshotSchema = z.object({
  counters: z.object({
    ok: z.number().optional(),
    pending: z.number().optional(),
    internalError: z.number().optional(),
  }),
  statusText: z.string().max(MAX_FIELD).optional(),
  statusColor: z.string().max(100).optional(),
  statusVariant: z.enum(['success', 'warning', 'danger', 'info']).optional(),
  lastUpdated: z.number(),
});

export const SearchQuerySchema = z
  .string()
  .min(1)
  .max(200)
  .refine((s) => !/[<>{}]/.test(s), 'Invalid characters in search query');

export const ExportOptionsSchema = z.object({
  format: z.enum(['json', 'csv']),
  category: z.enum(['contacts', 'servers', 'oncall', 'groups', 'all']),
  includeMetadata: z.boolean().optional(),
});

export const DataCategorySchema = z.enum(['contacts', 'servers', 'oncall', 'groups', 'all']);

// ==================== Note Schemas ====================
export const NotesTagsSchema = z.array(z.string().max(50)).max(20).optional();

// ==================== Location Schemas ====================
const LatitudeSchema = z.number().min(-90).max(90);
const LongitudeSchema = z.number().min(-180).max(180);

export const LogEntrySchema = z.object({
  level: z.enum(['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL']),
  module: z.string().max(100),
  message: z.string().max(5000),
  data: z.record(z.string(), z.unknown()).optional(),
  timestamp: z.string().optional(),
});

export const SavedLocationSchema = z.object({
  id: z.string().max(MAX_ID).optional(),
  name: z.string().min(1).max(MAX_NAME),
  lat: LatitudeSchema,
  lon: LongitudeSchema,
  isDefault: z.boolean().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export const LocationUpdateSchema = z.object({
  name: z.string().min(1).max(MAX_NAME).optional(),
  lat: LatitudeSchema.optional(),
  lon: LongitudeSchema.optional(),
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
