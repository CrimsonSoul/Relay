import { z } from 'zod';
const id = z.string().regex(/^\d{1,30}$/);
export const SdpRelatedTicketSchema = z
  .object({
    id,
    number: z.string().max(50),
    subject: z.string().max(250),
  })
  .strict();
export type SdpRelatedTicket = z.infer<typeof SdpRelatedTicketSchema>;
export const SdpTicketRelationsCommandSchema = z
  .object({
    action: z.literal('readTicketRelations'),
    id,
    number: z
      .string()
      .regex(/^(?:[A-Za-z]+-)?\d{1,30}$/)
      .optional(),
    page: z.number().int().min(0).max(99).default(0),
  })
  .strict();
export const SdpTicketRelationsSchema = z
  .object({
    id,
    linked: z.array(SdpRelatedTicketSchema).max(50),
    candidate: SdpRelatedTicketSchema.nullable(),
    canLink: z.boolean(),
    canUnlink: z.boolean(),
    canMerge: z.boolean(),
    hasMore: z.boolean(),
  })
  .strict();
export type SdpTicketRelations = z.infer<typeof SdpTicketRelationsSchema>;
export const SdpRelationMutationSchema = z
  .object({
    kind: z.literal('relation'),
    id,
    targetId: id,
    operation: z.enum(['link', 'unlink', 'merge']),
  })
  .strict()
  .refine((v) => v.id !== v.targetId, 'Choose a different ticket.');
export type SdpRelationMutation = z.infer<typeof SdpRelationMutationSchema>;
