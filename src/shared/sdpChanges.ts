import { z } from 'zod';

export const SDP_CHANGE_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
export const SDP_CHANGE_GRACE_MS = 2 * 60 * 60 * 1000;
export const SdpChangesCommandSchema = z
  .object({
    action: z.literal('readChanges'),
    problemStart: z.number().int().min(1).max(8640000000000000),
    page: z.number().int().min(0).max(9),
  })
  .strict();
const time = z.number().int().nonnegative().max(8640000000000000).nullable();
export const SdpChangeRecordSchema = z
  .object({
    id: z.string().regex(/^\d{1,30}$/),
    number: z.string().max(100),
    title: z.string().max(500),
    description: z.string().max(20000),
    status: z.string().max(200),
    stage: z.string().max(200),
    site: z.string().max(200),
    scheduledStart: time,
    scheduledEnd: time,
    assets: z.array(z.string().max(500)).max(500),
    services: z.array(z.string().max(500)).max(500),
    configurationItems: z.array(z.string().max(500)).max(500).optional(),
  })
  .strict();
export const SdpChangesPageSchema = z
  .object({
    page: z.number().int().min(0).max(9),
    hasMore: z.boolean(),
    detailsComplete: z.boolean().optional(),
    changes: z.array(SdpChangeRecordSchema).max(50),
  })
  .strict();
export type SdpChangeRecord = z.infer<typeof SdpChangeRecordSchema>;
export type SdpChangesPage = z.infer<typeof SdpChangesPageSchema>;
export type SdpChangesCommand = z.infer<typeof SdpChangesCommandSchema>;
export const sdpChangeUrl = (id: string): string =>
  `https://support.campingworld.com/app/itdesk/ChangeDetails.cc?CHANGEID=${encodeURIComponent(id)}`;
