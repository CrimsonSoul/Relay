import { z } from 'zod';
export const SdpLastReplySchema = z
  .object({
    id: z.string().regex(/^\d{1,30}$/),
    author: z.string().max(200),
    senderRole: z.enum(['requester', 'technician', 'unknown']),
    at: z.number().int().min(0).max(8640000000000000),
  })
  .strict();
export type SdpLastReply = z.infer<typeof SdpLastReplySchema>;
