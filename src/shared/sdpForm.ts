import { z } from 'zod';
const id = z.string().regex(/^\d{1,30}$/);
export const SdpFieldKeySchema = z
  .string()
  .regex(/^(?:[a-z][a-z0-9_]*|udf_fields\.[a-z][a-z0-9_]*|resolution\.content)$/)
  .max(100);
const scalar = z.union([
  z.string().max(100000),
  z.number(),
  z.boolean(),
  z.object({ id, name: z.string().max(250).optional() }).strict(),
]);
export const SdpFieldValueSchema = z.union([scalar, z.array(scalar).max(200), z.null()]);
export type SdpFieldValue = z.infer<typeof SdpFieldValueSchema>;
export const SdpFieldPatchSchema = z
  .record(SdpFieldKeySchema, SdpFieldValueSchema)
  .refine((v) => Object.keys(v).length > 0 && Object.keys(v).length <= 150);
export const SdpChoiceSchema = z.object({ label: z.string().max(250), value: scalar }).strict();
export const SdpFormFieldSchema = z
  .object({
    key: SdpFieldKeySchema,
    label: z.string().max(200),
    section: z.string().max(200),
    kind: z.enum(['text', 'multiline', 'lookup', 'choice', 'boolean', 'number', 'date']),
    required: z.boolean(),
    readOnly: z.boolean(),
    multiple: z.boolean(),
    dateOnly: z.boolean().optional(),
    integer: z.boolean().optional(),
    minLength: z.number().int().min(0).max(100000).optional(),
    maxLength: z.number().int().min(1).max(100000),
    dependencies: z.array(SdpFieldKeySchema).max(10),
    choices: z.array(SdpChoiceSchema).max(1000),
    value: SdpFieldValueSchema,
  })
  .strict();
export const SdpFormSchema = z
  .object({
    id,
    template: z.object({ id, name: z.string().max(250) }).strict(),
    fields: z.array(SdpFormFieldSchema).max(150),
    canEdit: z.boolean(),
    metadataAvailable: z.boolean().optional(),
    unavailableFields: z.array(z.string().max(200)).max(150).optional(),
  })
  .strict();
export type SdpForm = z.infer<typeof SdpFormSchema>;
export type SdpFormField = z.infer<typeof SdpFormFieldSchema>;
export const SdpOptionsSchema = z
  .object({
    field: SdpFieldKeySchema,
    choices: z.array(SdpChoiceSchema).max(100),
    hasMore: z.boolean(),
  })
  .strict();
export const SdpFormCommandSchema = z.object({ action: z.literal('readForm'), id }).strict();
export const SdpOptionsCommandSchema = z
  .object({
    action: z.literal('readOptions'),
    id,
    field: SdpFieldKeySchema,
    search: z.string().max(200),
    page: z.number().int().min(0).max(99),
    dependencies: z
      .record(SdpFieldKeySchema, SdpFieldValueSchema)
      .refine((v) => Object.keys(v).length <= 10),
  })
  .strict();
export const SdpStandardFieldSchema = z.enum([
  'group',
  'technician',
  'status',
  'priority',
  'request_type',
  'category',
  'impact',
  'urgency',
]);
export const SdpStandardOptionsCommandSchema = z
  .object({
    action: z.literal('readStandardOptions'),
    field: SdpStandardFieldSchema,
    search: z.string().max(200),
    page: z.number().int().min(0).max(99),
    groupId: id.optional(),
  })
  .strict()
  .refine((c) => !c.groupId || c.field === 'technician');
export type SdpStandardOptionsCommand = z.infer<typeof SdpStandardOptionsCommandSchema>;
export const SdpReplyContextSchema = z
  .object({
    id,
    subject: z.string().max(250),
    to: z.array(z.email()).max(50),
    cc: z.array(z.email()).max(50),
    canReply: z.boolean(),
    body: z.string().max(12000).optional(),
  })
  .strict();
export const SdpReplyCommandSchema = z
  .object({ action: z.literal('readReplyContext'), id })
  .strict();
export const SdpEditMutationSchema = z
  .object({ kind: z.literal('edit'), id, fields: SdpFieldPatchSchema })
  .strict();
export const SdpReplyMutationSchema = z
  .object({
    kind: z.literal('reply'),
    id,
    to: z.array(z.email().max(250)).min(1).max(50),
    cc: z.array(z.email().max(250)).max(50),
    bcc: z.array(z.email().max(250)).max(50),
    subject: z.string().trim().min(1).max(250),
    body: z.string().trim().min(1).max(12000),
    isPublic: z.boolean(),
  })
  .strict();

export const SdpForwardCommandSchema = z
  .object({ action: z.literal('readForwardContext'), id, sourceId: id.optional() })
  .strict();
export const SdpForwardMutationSchema = SdpReplyMutationSchema.extend({
  kind: z.literal('forward'),
  sourceId: id.optional(),
});
