import { z } from 'zod';
import { SdpEditMutationSchema, SdpReplyMutationSchema, SdpForwardMutationSchema } from './sdpForm';
import { SdpAttachmentMutationSchema } from './sdpAttachments';
import { SdpResourceMutationSchema } from './sdpResources';
import { SdpRelationMutationSchema } from './sdpTicketRelations';

// Verified against the IT desk's default incident form and template metadata.
export const SDP_DEFAULT_INCIDENT_TEMPLATE = {
  id: '142866000146669084',
  name: 'CWGS Incident/Request',
} as const;

const id = z.string().regex(/^\d{1,30}$/);
const name = z.string().trim().min(1).max(200);
export const SdpRequestFieldsSchema = z
  .object({
    subject: z.string().trim().min(1).max(250).optional(),
    description: z.string().max(12000).optional(),
    status: name.optional(),
    priority: name.optional(),
    group: name.nullable().optional(),
    technician: name.nullable().optional(),
    requestType: name.optional(),
    category: name.optional(),
    impact: name.optional(),
    urgency: name.optional(),
    resolution: z.string().trim().min(1).max(12000).optional(),
  })
  .strict();
export const SdpBulkMutationSchema = z
  .object({
    kind: z.literal('bulk'),
    ids: z
      .array(id)
      .min(1)
      .max(20)
      .refine((ids) => new Set(ids).size === ids.length, 'Select each ticket once.'),
    fields: SdpRequestFieldsSchema.omit({ subject: true, description: true }).refine(
      (fields) => Object.keys(fields).length > 0,
      'Choose at least one field to change.',
    ),
  })
  .strict();
export type SdpBulkMutation = z.infer<typeof SdpBulkMutationSchema>;
export const SdpBulkResultSchema = z
  .array(
    z
      .object({
        id,
        status: z.enum(['confirmed', 'conflict', 'uncertain', 'not-attempted']),
      })
      .strict(),
  )
  .max(20);
export type SdpBulkResult = z.infer<typeof SdpBulkResultSchema>;
export const SdpMutationSchema = z.discriminatedUnion('kind', [
  SdpBulkMutationSchema,
  SdpRelationMutationSchema,
  SdpResourceMutationSchema,
  SdpEditMutationSchema,
  SdpReplyMutationSchema,
  SdpForwardMutationSchema,
  SdpAttachmentMutationSchema,
  z
    .object({
      kind: z.literal('create'),
      fields: SdpRequestFieldsSchema.extend({
        subject: z.string().trim().min(1).max(250),
      }),
      templateId: id.optional(),
      requesterEmail: z.email().max(250).optional(),
      majorIncident: z.boolean(),
    })
    .strict()
    .refine(
      (value) =>
        !value.majorIncident ||
        !value.templateId ||
        value.templateId === SDP_DEFAULT_INCIDENT_TEMPLATE.id,
      'Major incidents use the default incident template.',
    ),
  z
    .object({
      kind: z.literal('update'),
      id,
      fields: SdpRequestFieldsSchema.refine(
        (value) => Object.keys(value).length > 0,
        'Choose at least one field to change.',
      ),
    })
    .strict(),
  z
    .object({
      kind: z.literal('note'),
      id,
      body: z.string().trim().min(1).max(12000),
      showToRequester: z.boolean(),
    })
    .strict(),
]);
export type SdpMutation = z.infer<typeof SdpMutationSchema>;
export type SdpRequestFields = z.infer<typeof SdpRequestFieldsSchema>;
export const SdpPrepareCommandSchema = z
  .object({ action: z.literal('prepareChange'), mutation: SdpMutationSchema })
  .strict();
export const SdpConfirmCommandSchema = z
  .object({ action: z.literal('confirmChange'), confirmationId: z.uuid() })
  .strict();
export const SdpCancelCommandSchema = z.object({ action: z.literal('cancelChange') }).strict();
export const SdpReviewSchema = z
  .object({ confirmationId: z.uuid(), expiresAt: z.number(), mutation: SdpMutationSchema })
  .strict();
export type SdpReview = z.infer<typeof SdpReviewSchema>;
export const SdpChangeResultSchema = z
  .object({
    id,
    number: z.string().max(50),
    kind: z.enum([
      'create',
      'update',
      'note',
      'resource',
      'attachment',
      'edit',
      'reply',
      'forward',
      'relation',
    ]),
  })
  .strict();
export type SdpChangeResult = z.infer<typeof SdpChangeResultSchema>;
