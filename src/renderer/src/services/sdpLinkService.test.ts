import { beforeEach, expect, it, vi } from 'vitest';
import { linkSdpProblem, unlinkSdpProblem } from './sdpLinkService';
const mocks = vi.hoisted(() => ({ create: vi.fn(), first: vi.fn(), update: vi.fn() }));
vi.mock('./pocketbase', () => ({
  requireOnline: vi.fn(),
  getPb: () => ({
    filter: (_query: string, data: unknown) => JSON.stringify(data),
    collection: (name: string) =>
      name === 'dynatrace_problems'
        ? { getFirstListItem: vi.fn().mockResolvedValue({}) }
        : { create: mocks.create, getFirstListItem: mocks.first, update: mocks.update },
  }),
}));
const input = {
  ticketId: '1',
  ticketNumber: '100',
  problemId: 'problem',
  environment: 'https://example.test',
};
beforeEach(() => {
  vi.resetAllMocks();
});
it('retains shared suppression after an automatic create races with another client', async () => {
  mocks.create.mockRejectedValue(new Error('duplicate'));
  mocks.first.mockResolvedValue({ ...input, id: 'record', suppressed: true });
  expect(await linkSdpProblem(input, true)).toMatchObject({ suppressed: true });
  expect(mocks.update).not.toHaveBeenCalled();
});
it('explicit manual linking restores a suppressed relationship', async () => {
  mocks.create.mockRejectedValue(new Error('duplicate'));
  mocks.first.mockResolvedValue({ ...input, id: 'record', suppressed: true });
  await linkSdpProblem(input);
  expect(mocks.update).toHaveBeenCalledWith('record', { suppressed: false });
});
it('unlink keeps an identifier-only suppression instead of deleting the record', async () => {
  await unlinkSdpProblem('record');
  expect(mocks.update).toHaveBeenCalledWith('record', { suppressed: true });
});
