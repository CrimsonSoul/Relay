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
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
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
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
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
  timeWindow: z.string(),
});

export const OnCallRowsArraySchema = z.array(OnCallRowSchema);

export type ValidatedOnCallRow = z.infer<typeof OnCallRowSchema>;

// ==================== Group Schemas ====================
export const GroupSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  emails: z.array(z.string().email()),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export const GroupUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  emails: z.array(z.string().email()).optional(),
});

export type ValidatedGroup = z.infer<typeof GroupSchema>;
export type ValidatedGroupUpdate = z.infer<typeof GroupUpdateSchema>;

// ==================== Bridge History Schemas ====================
export const BridgeHistoryEntrySchema = z.object({
  id: z.string().optional(),
  timestamp: z.number(),
  fromName: z.string(),
  fromPhone: z.string(),
  toName: z.string(),
  toPhone: z.string(),
  notes: z.string().optional(),
});

export type ValidatedBridgeHistoryEntry = z.infer<typeof BridgeHistoryEntrySchema>;

// ==================== Note Schemas ====================
export const NoteSchema = z.object({
  targetType: z.enum(['contact', 'server']),
  targetId: z.string().min(1),
  content: z.string(),
});

export type ValidatedNote = z.infer<typeof NoteSchema>;

// ==================== Location Schemas ====================
export const SavedLocationSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  lat: z.number(),
  lon: z.number(),
  isDefault: z.boolean().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export const LocationUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  lat: z.number().optional(),
  lon: z.number().optional(),
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
