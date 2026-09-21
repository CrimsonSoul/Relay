import { z } from 'zod';
import type { DynatraceProblemRecord } from './dynatraceProblems';
import type { SdpQueueTicket } from './sdpAccount';

export const SdpWorkflowLinkCommandSchema = z
  .object({
    action: z.literal('verifyWorkflowTicket'),
    id: z.string().regex(/^\d{1,30}$/),
    problemId: z.string().min(1).max(256),
    environment: z.url().max(2048),
  })
  .strict();

/** Subjects select candidates only; an exact environment-qualified problem URL proves the link. */
export function workflowTicketCandidate(
  ticket: SdpQueueTicket,
  problem: DynatraceProblemRecord,
): boolean {
  if (
    problem.scopeExcluded ||
    !problem.notificationTitle ||
    !ticket.createdAt ||
    ticket.createdAt < problem.startTime - 300000
  )
    return false;
  const subject = ticket.subject.trim();
  return (
    subject === problem.notificationTitle.trim() ||
    (problem.displayId.length >= 3 && subject.split(/[^\w-]+/).includes(problem.displayId))
  );
}
function environmentKey(url: URL): string {
  // Classic and Platform links for the same SaaS environment have different host suffixes.
  const host = url.hostname.replace(/\.(?:apps|live)\.dynatrace\.com$/, '.dynatrace.com');
  return `${host}:${url.port}${/^\/e\/[^/]+/.exec(url.pathname)?.[0] ?? ''}`;
}
export function hasWorkflowProblemUrl(
  description: string,
  environment: string,
  problemId: string,
): boolean {
  let expected: URL;
  try {
    expected = new URL(environment);
  } catch {
    return false;
  }
  if (expected.protocol !== 'https:' || expected.username || expected.password) return false;
  const content = description
    .replaceAll('&amp;', '&')
    .replaceAll('&#39;', "'")
    .replaceAll('&quot;', '"');
  const urls = content.match(/https:\/\/[^\s<>"']+/g) ?? [];
  return urls.slice(0, 500).some((text) => {
    try {
      const url = new URL(text);
      if (url.username || url.password || environmentKey(url) !== environmentKey(expected))
        return false;
      const route = decodeURIComponent(url.pathname + url.search + url.hash);
      if (!/problems?(?:[/;?#]|$)/i.test(route) && !/problemdetails/i.test(route)) return false;
      const ids = [...route.matchAll(/(?:[?&;]|#)(?:pid|problemId)=([^&;#\s]+)/g)].map(
        (match) => match[1],
      );
      const pathId = /\/problem(?:s)?\/([^/?#;]+)/.exec(route)?.[1];
      return ids.includes(problemId) || pathId === problemId;
    } catch {
      return false;
    }
  });
}
