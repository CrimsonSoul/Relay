/**
 * IPC Validation Schemas
 *
 * Runtime validation for IPC messages to provide defense-in-depth.
 * While TypeScript provides compile-time safety, these schemas validate
 * data at the IPC boundary to protect against malformed messages from
 * a potentially compromised renderer process.
 */

import { z } from 'zod';

// ==================== Contact Schemas ====================
export const ContactSchema = z.object({
  name: z.string(),
  email: z.string().email(),
  phone: z.string(),
  title: z.string(),
  _searchString: z.string().optional(),
  raw: z.object({
    id: z.string().optional(),
    createdAt: z.number().optional(),
    updatedAt: z.number().optional(),
  }).optional(),
});

export type ValidatedContact = z.infer<typeof ContactSchema>;

// ==================== Server Schemas ====================
export const ServerSchema = z.object({
  name: z.string().min(1),
  businessArea: z.string(),
  lob: z.string(),
  comment: z.string(),
  owner: z.string(),
  contact: z.string(),
  os: z.string(),
  _searchString: z.string().optional(),
  raw: z.object({
    id: z.string().optional(),
    createdAt: z.number().optional(),
    updatedAt: z.number().optional(),
  }).optional(),
});

export type ValidatedServer = z.infer<typeof ServerSchema>;

// ==================== OnCall Schemas ====================
export const OnCallRowSchema = z.object({
  id: z.string(),
  team: z.string().min(1),
  role: z.string(),
  name: z.string(),
  contact: z.string(),
  timeWindow: z.string().optional(),
});

export const OnCallRowsArraySchema = z.array(OnCallRowSchema);

export type ValidatedOnCallRow = z.infer<typeof OnCallRowSchema>;

// ==================== Group Schemas ====================
export const GroupSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  contacts: z.array(z.string().email()),
  createdAt: z.number().optional(),
  updatedAt: z.number().optional(),
});

export const GroupUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  contacts: z.array(z.string().email()).optional(),
});

export type ValidatedGroup = z.infer<typeof GroupSchema>;
export type ValidatedGroupUpdate = z.infer<typeof GroupUpdateSchema>;

// ==================== Bridge History Schemas ====================
export const BridgeHistoryEntrySchema = z.object({
  id: z.string().optional(),
  timestamp: z.number().optional(),
  note: z.string(),
  groups: z.array(z.string()),
  contacts: z.array(z.string()),
  recipientCount: z.number(),
});

export type ValidatedBridgeHistoryEntry = z.infer<typeof BridgeHistoryEntrySchema>;

// ==================== Data Record Input Schemas ====================

export const ContactRecordInputSchema = z.object({
  name: z.string(),
  email: z.string().email(),
  phone: z.string(),
  title: z.string(),
});

export const ServerRecordInputSchema = z.object({
  name: z.string().min(1),
  businessArea: z.string(),
  lob: z.string(),
  comment: z.string(),
  owner: z.string(),
  contact: z.string(),
  os: z.string(),
});

export const OnCallRecordInputSchema = z.object({
  team: z.string().min(1),
  role: z.string(),
  name: z.string(),
  contact: z.string(),
  timeWindow: z.string().optional(),
});

export const ContactRecordUpdateSchema = ContactRecordInputSchema.partial().strict();
export const ServerRecordUpdateSchema = ServerRecordInputSchema.partial().strict();

export const TeamLayoutSchema = z.record(z.string(), z.object({
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  static: z.boolean().optional(),
})).optional();

export const RadarSnapshotSchema = z.object({
  counters: z.object({
    ok: z.number().optional(),
    pending: z.number().optional(),
    internalError: z.number().optional(),
  }),
  statusText: z.string().optional(),
  statusColor: z.string().optional(),
  statusVariant: z.enum(['success', 'warning', 'danger', 'info']).optional(),
  lastUpdated: z.number(),
});

export const SearchQuerySchema = z.string()
  .min(1)
  .max(200)
  .refine(s => !/[<>{}]/.test(s), 'Invalid characters in search query');

export const ExportOptionsSchema = z.object({
  format: z.enum(['json', 'csv']),
  category: z.enum(['contacts', 'servers', 'oncall', 'groups', 'all']),
  includeMetadata: z.boolean().optional(),
});

export const DataCategorySchema = z.enum(['contacts', 'servers', 'oncall', 'groups', 'all']);

// ==================== Note Schemas ====================
export const NotesTagsSchema = z.array(z.string().max(50)).max(20).optional();

export const NoteSchema = z.object({
  targetType: z.enum(['contact', 'server']),
  targetId: z.string().min(1),
  content: z.string(),
});

export type ValidatedNote = z.infer<typeof NoteSchema>;

// ==================== Location Schemas ====================
export const LatitudeSchema = z.number().min(-90).max(90);
export const LongitudeSchema = z.number().min(-180).max(180);

export const LogEntrySchema = z.object({
  level: z.enum(['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL']),
  module: z.string().max(100),
  message: z.string().max(5000),
  data: z.record(z.unknown()).optional(),
  timestamp: z.string().optional()
});

export const SavedLocationSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  lat: LatitudeSchema,
  lon: LongitudeSchema,
  isDefault: z.boolean().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export const LocationUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  lat: LatitudeSchema.optional(),
  lon: LongitudeSchema.optional(),
});

export type ValidatedSavedLocation = z.infer<typeof SavedLocationSchema>;
export type ValidatedLocationUpdate = z.infer<typeof LocationUpdateSchema>;

// ==================== Utility Functions ====================

/**
 * Validates and returns the parsed data, or throws a descriptive error
 */
export function validateIpcData<T>(schema: z.ZodSchema<T>, data: unknown, context: string): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const errorMessage = `IPC validation failed for ${context}: ${result.error.message}`;
    throw new Error(errorMessage);
  }
  return result.data;
}

/**
 * Validates and returns the parsed data, or returns null with logged error
 */
export function validateIpcDataSafe<T>(schema: z.ZodSchema<T>, data: unknown, context: string): T | null {
  const result = schema.safeParse(data);
  if (!result.success) {
    console.error(`IPC validation failed for ${context}:`, result.error.format());
    return null;
  }
  return result.data;
}
