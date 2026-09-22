import { z } from 'zod';
const id = z.string().regex(/^\d{1,30}$/);
export const SdpHistoryCommandSchema = z
  .object({ action: z.literal('readHistory'), id, page: z.number().int().min(0).max(999) })
  .strict();
export type SdpHistoryCommand = z.infer<typeof SdpHistoryCommandSchema>;
export const SdpHistorySchema = z
  .object({
    id,
    page: z.number().int().min(0).max(999),
    hasMore: z.boolean(),
    entries: z
      .array(
        z
          .object({
            id,
            author: z.string().max(250),
            at: z.number().min(0).max(8640000000000000).nullable(),
            operation: z.string().max(200),
            description: z.string().max(12000),
            changes: z
              .array(
                z
                  .object({
                    field: z.string().max(250),
                    before: z.string().max(12000),
                    after: z.string().max(12000),
                  })
                  .strict(),
              )
              .max(250),
          })
          .strict(),
      )
      .max(50),
  })
  .strict();
export type SdpHistory = z.infer<typeof SdpHistorySchema>;
