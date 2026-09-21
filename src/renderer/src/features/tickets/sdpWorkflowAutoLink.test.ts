import { expect, it, vi } from 'vitest';
import { SdpWorkflowAutoLink } from './sdpWorkflowAutoLink';
import type { DynatraceProblemRecord } from '@shared/dynatraceProblems';
import type { SdpQueueTicket } from '@shared/sdpAccount';
const problem = {
  problemId: 'canonical',
  displayId: 'P-1',
  notificationTitle: 'NOC outage',
  startTime: 1000,
  environmentUrl: 'https://a.live.dynatrace.com',
} as DynatraceProblemRecord;
const ticket = { id: '1', number: '100', subject: 'NOC outage', createdAt: 2000 } as SdpQueueTicket;
const input = {
  ticketId: '1',
  ticketNumber: '100',
  problemId: 'canonical',
  environment: problem.environmentUrl,
};
it('automatically links verified candidates, avoids duplicates and preserves unlink suppressions', async () => {
  const scan = new SdpWorkflowAutoLink();
  const verify = vi.fn().mockResolvedValue(true),
    save = vi.fn();
  expect(await scan.scan([ticket], [problem], [], verify, save, () => true, 1000)).toBe(1);
  expect(save).toHaveBeenCalledWith(input);
  await scan.scan([ticket], [problem], [], verify, save, () => true, 2000);
  expect(verify).toHaveBeenCalledTimes(1);
  await new SdpWorkflowAutoLink().scan(
    [ticket],
    [problem],
    [{ ...input, id: 'record', suppressed: true }],
    verify,
    save,
    () => true,
    400000,
  );
  expect(verify).toHaveBeenCalledTimes(1);
});
it('rejects ambiguous subjects, unverified bodies and cancelled sessions', async () => {
  const verify = vi.fn().mockResolvedValue(false),
    save = vi.fn();
  const scan = new SdpWorkflowAutoLink();
  await scan.scan(
    [ticket],
    [problem, { ...problem, environmentUrl: 'https://b.live.dynatrace.com' }],
    [],
    verify,
    save,
    () => true,
  );
  expect(verify).not.toHaveBeenCalled();
  await scan.scan([ticket], [problem], [], verify, save, () => true);
  expect(save).not.toHaveBeenCalled();
  let active = true;
  verify.mockImplementation(async () => {
    active = false;
    return true;
  });
  await new SdpWorkflowAutoLink().scan([ticket], [problem], [], verify, save, () => active);
  expect(save).not.toHaveBeenCalled();
});
it('bounds reads and rotates retries so a busy queue makes progress', async () => {
  const scan = new SdpWorkflowAutoLink();
  const tickets = Array.from({ length: 12 }, (_, i) => ({ ...ticket, id: String(i + 1) }));
  const verify = vi.fn().mockResolvedValue(false),
    save = vi.fn();
  await scan.scan(tickets, [problem], [], verify, save, () => true, 1000);
  expect(verify).toHaveBeenCalledTimes(5);
  await scan.scan(tickets, [problem], [], verify, save, () => true, 2000);
  expect(verify).toHaveBeenCalledTimes(10);
  await scan.scan(tickets, [problem], [], verify, save, () => true, 3000);
  expect(verify).toHaveBeenCalledTimes(12);
  await scan.scan(tickets, [problem], [], verify, save, () => true, 301000);
  expect(verify).toHaveBeenCalledTimes(17);
});
