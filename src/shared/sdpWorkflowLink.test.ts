import { expect, it } from 'vitest';
import { hasWorkflowProblemUrl, workflowTicketCandidate } from './sdpWorkflowLink';
import type { DynatraceProblemRecord } from './dynatraceProblems';
import type { SdpQueueTicket } from './sdpAccount';
const environment = 'https://abc.live.dynatrace.com';
it('requires the exact canonical ID and environment in a problem URL', () => {
  for (const url of [
    `${environment}/#problems/problemdetails;pid=-123_456`,
    'https://abc.apps.dynatrace.com/ui/apps/dynatrace.davis.problems/problem/-123_456',
    `${environment}/problems?x=1&amp;problemId=-123_456`,
  ])
    expect(hasWorkflowProblemUrl(`<a href="${url}">Problem</a>`, environment, '-123_456')).toBe(
      true,
    );
  for (const url of [
    'https://other.live.dynatrace.com/#problems/problemdetails;pid=-123_456',
    `${environment}/#problems/problemdetails;pid=-123_4567`,
    `${environment}/hosts?problemId=-123_456`,
    'https://abc.live.dynatrace.com.evil.test/problems?pid=-123_456',
    'https://user@abc.live.dynatrace.com/problems?pid=-123_456',
    '-123_456 db01 outage',
  ])
    expect(hasWorkflowProblemUrl(url, environment, '-123_456')).toBe(false);
  expect(
    hasWorkflowProblemUrl(
      'https://managed.test/e/other/problems?pid=123',
      'https://managed.test/e/tenant',
      '123',
    ),
  ).toBe(false);
});
it('selects workflow subjects or whole display IDs, excludes old tickets and out-of-scope problems', () => {
  const problem = {
    notificationTitle: 'Database unavailable',
    displayId: 'P-123',
    startTime: 1000000,
  } as DynatraceProblemRecord;
  const ticket = { subject: 'Database unavailable', createdAt: 1000000 } as SdpQueueTicket;
  expect(workflowTicketCandidate(ticket, problem)).toBe(true);
  expect(workflowTicketCandidate({ ...ticket, subject: 'NOC P-123 - outage' }, problem)).toBe(true);
  expect(workflowTicketCandidate({ ...ticket, subject: 'NOC P-1234 - outage' }, problem)).toBe(
    false,
  );
  expect(workflowTicketCandidate({ ...ticket, createdAt: 1 }, problem)).toBe(false);
  expect(workflowTicketCandidate(ticket, { ...problem, scopeExcluded: true })).toBe(false);
  expect(workflowTicketCandidate(ticket, { ...problem, notificationTitle: undefined })).toBe(false);
});
