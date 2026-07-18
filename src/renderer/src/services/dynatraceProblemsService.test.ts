import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DYNATRACE_PROBLEM_NOTES_COLLECTION,
  DYNATRACE_PROBLEM_STATES_COLLECTION,
} from '@shared/dynatraceProblems';
import {
  DYNATRACE_TICKET_NOTE_PREFIX,
  MAX_DYNATRACE_TICKET_REFERENCE_LENGTH,
  addDynatraceProblemNote,
  formatDynatraceTicketReferenceNote,
  parseDynatraceTicketReferenceNote,
  setDynatraceProblemAddressed,
} from './dynatraceProblemsService';

const mocks = vi.hoisted(() => ({
  requireOnline: vi.fn(),
  handleApiError: vi.fn(),
  getConnectionState: vi.fn(),
  notesGetFirst: vi.fn(),
  notesGetOne: vi.fn(),
  notesCreate: vi.fn(),
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
        return {
          getFirstListItem: mocks.notesGetFirst,
          getOne: mocks.notesGetOne,
          create: mocks.notesCreate,
        };
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
  getConnectionState: mocks.getConnectionState,
}));

vi.mock('../stores/collectionStoreRegistry', () => ({
  applyOfflineMutationToStores: vi.fn(),
}));

const notFound = Object.assign(new Error('Not found'), { status: 404 });
describe('Dynatrace problem mutations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getConnectionState.mockReturnValue('online');
    mocks.notesCreate.mockResolvedValue({ id: 'note-1', problemId: 'problem-1' });
    mocks.notesGetOne.mockResolvedValue({ id: 'note-1', problemId: 'problem-1' });
    mocks.statesGetFirst.mockRejectedValue(notFound);
    mocks.statesCreate.mockResolvedValue({ id: 'state-1', problemId: 'problem-1' });
    mocks.statesUpdate.mockResolvedValue({ id: 'state-1', problemId: 'problem-1' });
    (globalThis as Record<string, unknown>).api = undefined;
  });

  it('adds a response note without an operator identity', async () => {
    await addDynatraceProblemNote('problem-1', '  Investigating the failed checkout.  ');

    expect(mocks.notesCreate).toHaveBeenCalledWith({
      problemId: 'problem-1',
      note: 'Investigating the failed checkout.',
    });
    expect(mocks.notesCreate.mock.calls[0]![0]).not.toEqual(
      expect.objectContaining({ operatorId: expect.anything(), author: expect.anything() }),
    );
  });

  it('rejects an addressed state when the problem has no ticket reference or NOC note', async () => {
    mocks.notesGetFirst.mockRejectedValue(notFound);

    await expect(setDynatraceProblemAddressed('problem-1', true)).rejects.toThrow(
      'Add a Service Desk ticket number or NOC note before marking this problem addressed locally.',
    );
    expect(mocks.statesCreate).not.toHaveBeenCalled();
    expect(mocks.statesUpdate).not.toHaveBeenCalled();
  });

  it('does not let a historical note satisfy a new address action', async () => {
    mocks.notesGetFirst.mockResolvedValue({ id: 'note-1', problemId: 'problem-1' });

    await expect(setDynatraceProblemAddressed('problem-1', true)).rejects.toThrow(
      'Add a Service Desk ticket number or NOC note before marking this problem addressed locally.',
    );

    expect(mocks.statesCreate).not.toHaveBeenCalled();
  });

  it('marks a problem addressed after validating the newly persisted response note', async () => {
    await setDynatraceProblemAddressed('problem-1', true, undefined, 'note-1');

    expect(mocks.notesGetOne).toHaveBeenCalledWith('note-1', { requestKey: null });
    expect(mocks.statesCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        problemId: 'problem-1',
        addressed: true,
      }),
    );
    expect(mocks.statesCreate.mock.calls[0]![0]).not.toEqual(
      expect.objectContaining({ operatorId: expect.anything(), addressedBy: expect.anything() }),
    );
  });

  it('rejects response evidence that belongs to a different problem', async () => {
    mocks.notesGetOne.mockResolvedValue({ id: 'note-1', problemId: 'problem-2' });

    await expect(
      setDynatraceProblemAddressed('problem-1', true, undefined, 'note-1'),
    ).rejects.toThrow(
      'Add a Service Desk ticket number or NOC note before marking this problem addressed locally.',
    );

    expect(mocks.statesCreate).not.toHaveBeenCalled();
  });

  it('allows returning a problem to the queue without requiring another note', async () => {
    mocks.statesGetFirst.mockResolvedValue({ id: 'state-1', problemId: 'problem-1' });

    await setDynatraceProblemAddressed('problem-1', false);

    expect(mocks.notesGetFirst).not.toHaveBeenCalled();
    expect(mocks.statesUpdate).toHaveBeenCalledWith(
      'state-1',
      expect.objectContaining({ addressed: false, addressedAt: '' }),
    );
    expect(mocks.statesUpdate.mock.calls[0]![1]).not.toEqual(
      expect.objectContaining({ operatorId: expect.anything(), addressedBy: expect.anything() }),
    );
  });

  it('queues unattributed notes and addressed states while offline', async () => {
    mocks.getConnectionState.mockReturnValue('offline');
    const mutateOffline = vi.fn(
      async (input: { collection: string; action: string; data: object }) => ({
        ok: true as const,
        mutationId: `${input.collection}-mutation`,
        collection: input.collection,
        action: input.action,
        record: { id: `${input.collection}-local`, ...input.data },
        pendingCount: 1,
      }),
    );
    (globalThis as Record<string, unknown>).api = { mutateOffline };

    await addDynatraceProblemNote('problem-1', 'Queued note');
    await setDynatraceProblemAddressed('problem-1', true, undefined, 'dynatrace_probl');

    expect(mutateOffline).toHaveBeenNthCalledWith(1, {
      collection: DYNATRACE_PROBLEM_NOTES_COLLECTION,
      action: 'create',
      data: {
        problemId: 'problem-1',
        note: 'Queued note',
      },
    });
    expect(mutateOffline).toHaveBeenNthCalledWith(2, {
      collection: DYNATRACE_PROBLEM_STATES_COLLECTION,
      action: 'create',
      data: expect.objectContaining({ problemId: 'problem-1', addressed: true }),
    });
    expect(mutateOffline.mock.calls[1]![0].data).not.toEqual(
      expect.objectContaining({ operatorId: expect.anything(), addressedBy: expect.anything() }),
    );
  });

  it('requires newly persisted response evidence while offline', async () => {
    mocks.getConnectionState.mockReturnValue('offline');
    const mutateOffline = vi.fn();
    (globalThis as Record<string, unknown>).api = { mutateOffline };

    await expect(setDynatraceProblemAddressed('problem-1', true)).rejects.toThrow(
      'Add a Service Desk ticket number or NOC note before marking this problem addressed locally.',
    );

    expect(mutateOffline).not.toHaveBeenCalled();
  });
});

describe('Dynatrace ticket reference notation', () => {
  it('formats a trimmed Service Desk reference as an append-only note', () => {
    expect(formatDynatraceTicketReferenceNote('  INC0012345  ')).toBe('Ticket: INC0012345');
  });

  it.each(['', '   '])('rejects an empty ticket reference %#', (value) => {
    expect(() => formatDynatraceTicketReferenceNote(value)).toThrow(
      'Enter a Service Desk ticket number.',
    );
  });

  it('rejects multiline ticket references', () => {
    expect(() => formatDynatraceTicketReferenceNote('INC001\nCHG002')).toThrow(
      'Ticket numbers must fit on one line.',
    );
  });

  it('rejects ticket references longer than the UI contract', () => {
    expect(() =>
      formatDynatraceTicketReferenceNote('A'.repeat(MAX_DYNATRACE_TICKET_REFERENCE_LENGTH + 1)),
    ).toThrow('Ticket numbers can be up to 120 characters.');
  });

  it('parses only valid Relay ticket-reference notes', () => {
    expect(parseDynatraceTicketReferenceNote(`${DYNATRACE_TICKET_NOTE_PREFIX}INC0012345`)).toBe(
      'INC0012345',
    );
    expect(parseDynatraceTicketReferenceNote('Investigating the service.')).toBeNull();
    expect(parseDynatraceTicketReferenceNote(DYNATRACE_TICKET_NOTE_PREFIX)).toBeNull();
    expect(parseDynatraceTicketReferenceNote('Ticket: INC001\nCHG002')).toBeNull();
  });
});
