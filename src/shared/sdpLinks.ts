import { z } from 'zod';
export const SDP_LINK_COLLECTION = 'relay_sdp_links';
export const SdpLinkInputSchema = z
  .object({
    suppressed: z.boolean().optional(),
    ticketId: z.string().regex(/^\d{1,30}$/),
    ticketNumber: z.string().regex(/^\d{1,30}$/),
    problemId: z.string().trim().min(1).max(256),
    environment: z.url().max(2048),
  })
  .strict();
export type SdpLink = z.infer<typeof SdpLinkInputSchema> & { id: string };
export type SdpBridgeContext = {
  source: 'sdp';
  ticketId: string;
  ticketNumber: string;
  subject: string;
  meetingUrl: string;
  groupIds: string[];
};
export const sdpTicketUrl = (id: string): string =>
  `https://support.campingworld.com/app/itdesk/ui/requests/${encodeURIComponent(id)}/details`;
