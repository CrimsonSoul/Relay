import { SDP_LINK_COLLECTION, SdpLinkInputSchema, type SdpLink } from '@shared/sdpLinks';
import { getPb, requireOnline } from './pocketbase';

/** Shared references only. Never store SDP subjects, bodies or people in PocketBase. */
export async function linkSdpProblem(
  input: Omit<SdpLink, 'id'>,
  automatic = false,
): Promise<SdpLink> {
  requireOnline();
  const data = SdpLinkInputSchema.parse(input);
  const pb = getPb();
  await pb.collection('dynatrace_problems').getFirstListItem(
    pb.filter('problemId = {:id} && environmentUrl = {:environment}', {
      id: data.problemId,
      environment: data.environment,
    }),
  );
  try {
    return await pb.collection(SDP_LINK_COLLECTION).create<SdpLink>(data);
  } catch (error) {
    try {
      const existing = await pb
        .collection(SDP_LINK_COLLECTION)
        .getFirstListItem<SdpLink>(
          pb.filter(
            'ticketId = {:ticketId} && problemId = {:problemId} && environment = {:environment}',
            data,
          ),
        );
      if (!automatic && existing.suppressed)
        return await pb
          .collection(SDP_LINK_COLLECTION)
          .update<SdpLink>(existing.id, { suppressed: false });
      return existing;
    } catch {
      throw error;
    }
  }
}
export async function unlinkSdpProblem(id: string): Promise<void> {
  requireOnline();
  await getPb().collection(SDP_LINK_COLLECTION).update(id, { suppressed: true });
}
