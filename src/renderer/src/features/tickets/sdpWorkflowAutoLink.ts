import type { DynatraceProblemRecord } from '@shared/dynatraceProblems';
import type { SdpQueueTicket } from '@shared/sdpAccount';
import type { SdpLink } from '@shared/sdpLinks';
import { workflowTicketCandidate } from '@shared/sdpWorkflowLink';

type LinkInput = Omit<SdpLink, 'id'>;
/** Per-session retry state only; shared references (including unlink suppressions) are authoritative. */
export class SdpWorkflowAutoLink {
  private readonly attempts = new Map<string, number>();
  async scan(
    tickets: SdpQueueTicket[],
    problems: DynatraceProblemRecord[],
    links: SdpLink[],
    verify: (input: LinkInput) => Promise<boolean>,
    save: (input: LinkInput) => Promise<unknown>,
    active: () => boolean,
    now = Date.now(),
  ): Promise<number> {
    const candidates = tickets
      .flatMap((ticket) => {
        if (!/^\d{1,30}$/.test(ticket.number)) return [];
        const matches = problems.filter((problem) => workflowTicketCandidate(ticket, problem));
        // Identical subjects/IDs in multiple environments must never be guessed.
        if (matches.length !== 1) return [];
        const problem = matches[0]!;
        const input = {
          ticketId: ticket.id,
          ticketNumber: ticket.number,
          problemId: problem.problemId,
          environment: problem.environmentUrl,
        };
        if (
          links.some(
            (link) =>
              link.ticketId === input.ticketId &&
              link.problemId === input.problemId &&
              link.environment === input.environment,
          )
        )
          return [];
        const key = JSON.stringify([
          input.ticketId,
          input.problemId,
          input.environment,
          ticket.updatedAt,
        ]);
        const last = this.attempts.get(key);
        return last !== undefined && now - last < 300000 ? [] : [{ input, key, last: last ?? 0 }];
      })
      .sort((a, b) => a.last - b.last)
      .slice(0, 5);
    let count = 0;
    for (const { input, key } of candidates) {
      if (!active()) break;
      this.attempts.set(key, now);
      if (this.attempts.size > 5000) this.attempts.delete(this.attempts.keys().next().value!);
      try {
        if ((await verify(input)) && active()) {
          await save(input);
          count++;
        }
      } catch {
        // Keep the monitor healthy; permission/reconnect/busy failures retry on a later scan.
        // Surface the failure to the operator without retaining SDP content.
        if (active())
          throw new Error(
            'Automatic ticket linking will retry; check the SDP and Relay connections.',
          );
      }
    }
    return count;
  }
}
