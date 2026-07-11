import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DYNATRACE_PROBLEM_NOTES_COLLECTION,
  DYNATRACE_PROBLEM_STATES_COLLECTION,
} from '@shared/dynatraceProblems';
import { setDynatraceProblemAddressed } from './dynatraceProblemsService';

const mocks = vi.hoisted(() => ({
  requireOnline: vi.fn(),
  handleApiError: vi.fn(),
  notesGetFirst: vi.fn(),
  statesGetFirst: vi.fn(),
  statesCreate: vi.fn(),
  statesUpdate: vi.fn(),
}));

vi.mock('./pocketbase', () => ({
  escapeFilter: (value: string) => value,
  requireOnline: mocks.requireOnline,
  handleApiError: mocks.handleApiError,
  getPb: () => ({
    collection: (name: string) => {
      if (name === DYNATRACE_PROBLEM_NOTES_COLLECTION) {
        return { getFirstListItem: mocks.notesGetFirst };
      }
      if (name === DYNATRACE_PROBLEM_STATES_COLLECTION) {
        return {
          getFirstListItem: mocks.statesGetFirst,
          create: mocks.statesCreate,
          update: mocks.statesUpdate,
        };
      }
      throw new Error(`Unexpected collection: ${name}`);
    },
  }),
  getConnectionState: () => 'online',
}));

const notFound = Object.assign(new Error('Not found'), { status: 404 });

describe('setDynatraceProblemAddressed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.statesGetFirst.mockRejectedValue(notFound);
    mocks.statesCreate.mockResolvedValue({ id: 'state-1', problemId: 'problem-1' });
    mocks.statesUpdate.mockResolvedValue({ id: 'state-1', problemId: 'problem-1' });
  });

  it('rejects an addressed state when the problem has no NOC note', async () => {
    mocks.notesGetFirst.mockRejectedValue(notFound);

    await expect(
      setDynatraceProblemAddressed('problem-1', true, 'noc-workstation'),
    ).rejects.toThrow(/add a NOC note/i);
    expect(mocks.statesCreate).not.toHaveBeenCalled();
    expect(mocks.statesUpdate).not.toHaveBeenCalled();
  });

  it('marks a problem addressed after confirming that a note exists', async () => {
    mocks.notesGetFirst.mockResolvedValue({ id: 'note-1', problemId: 'problem-1' });

    await setDynatraceProblemAddressed('problem-1', true, 'noc-workstation');

    expect(mocks.statesCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        problemId: 'problem-1',
        addressed: true,
        addressedBy: 'noc-workstation',
      }),
    );
  });

  it('allows returning a problem to the queue without requiring another note', async () => {
    mocks.statesGetFirst.mockResolvedValue({ id: 'state-1', problemId: 'problem-1' });

    await setDynatraceProblemAddressed('problem-1', false, 'noc-workstation');

    expect(mocks.notesGetFirst).not.toHaveBeenCalled();
    expect(mocks.statesUpdate).toHaveBeenCalledWith(
      'state-1',
      expect.objectContaining({ addressed: false, addressedAt: '', addressedBy: '' }),
    );
  });
});
