import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DYNATRACE_PROBLEM_NOTES_COLLECTION,
  DYNATRACE_PROBLEM_STATES_COLLECTION,
} from '@shared/dynatraceProblems';
import {
  DYNATRACE_TICKET_NOTE_PREFIX,
  MAX_DYNATRACE_TICKET_REFERENCE_LENGTH,
  addDynatraceProblemNote,
  changeDynatraceProblemNote,
  parseDynatraceTicketReferenceNote,
  setDynatraceProblemAddressed,
} from './dynatraceProblemsService';

const RYAN = { email: 'ryan@example.com', name: 'Ryan' };

const mocks = vi.hoisted(() => ({
  requireOnline: vi.fn(),
  handleApiError: vi.fn(),
  getConnectionState: vi.fn(),
  notesGetFirst: vi.fn(),
  notesGetOne: vi.fn(),
  notesCreate: vi.fn(),
  notesUpdate: vi.fn(),
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
          update: mocks.notesUpdate,
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

  it('attributes a response note to the selected resolver', async () => {
    await addDynatraceProblemNote('problem-1', '  Investigating the failed checkout.  ', RYAN);

    expect(mocks.notesCreate).toHaveBeenCalledWith({
      problemId: 'problem-1',
      note: 'Investigating the failed checkout.',
      author: 'Ryan',
      analyst: 'ryan@example.com',
      noteId: expect.stringMatching(
        /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/,
      ),
      enteredBy: 'relay:unknown@unknown',
      source: 'relay',
      state: 'active',
      sync: 'pending',
    });
  });

  it('rejects a malformed resolver name', async () => {
    await expect(
      addDynatraceProblemNote('problem-1', 'Investigating the failed checkout.', {
        email: 'ryan@example.com',
        name: 'Two\nLines',
      }),
    ).rejects.toThrow('Select your name from the resolver list.');

    expect(mocks.notesCreate).not.toHaveBeenCalled();
  });

  it('rejects an addressed state without a response note', async () => {
    mocks.notesGetFirst.mockRejectedValue(notFound);

    await expect(
      setDynatraceProblemAddressed('problem-1', true, undefined, undefined, RYAN),
    ).rejects.toThrow('Add a NOC note before marking this problem addressed.');
    expect(mocks.statesCreate).not.toHaveBeenCalled();
    expect(mocks.statesUpdate).not.toHaveBeenCalled();
  });

  it('does not let a historical note satisfy a new address action', async () => {
    mocks.notesGetFirst.mockResolvedValue({ id: 'note-1', problemId: 'problem-1' });

    await expect(
      setDynatraceProblemAddressed('problem-1', true, undefined, undefined, RYAN),
    ).rejects.toThrow('Add a NOC note before marking this problem addressed.');

    expect(mocks.statesCreate).not.toHaveBeenCalled();
  });

  it('marks a problem addressed after validating the attributed response note', async () => {
    mocks.notesGetOne.mockResolvedValue({
      id: 'note-1',
      problemId: 'problem-1',
      author: 'Ryan',
    });

    await setDynatraceProblemAddressed('problem-1', true, undefined, 'note-1', RYAN);

    expect(mocks.notesGetOne).toHaveBeenCalledWith('note-1', { requestKey: null });
    expect(mocks.statesCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        problemId: 'problem-1',
        addressed: true,
        addressedBy: 'Ryan',
        analyst: 'ryan@example.com',
        ackState: 'addressed',
        ackId: expect.any(String),
        sync: 'pending',
      }),
    );
  });

  it('records the ack scope and the response note ID for Infra Health', async () => {
    mocks.notesGetOne.mockResolvedValue({
      id: 'note-1',
      problemId: 'problem-1',
      author: 'Ryan',
      noteId: 'shared-note-id',
    });

    await setDynatraceProblemAddressed('problem-1', true, undefined, 'note-1', RYAN, [
      'HOST-1',
      'CUSTOM_DEVICE-2',
    ]);

    expect(mocks.statesCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        noteId: 'shared-note-id',
        scopeEntities: ['HOST-1', 'CUSTOM_DEVICE-2'],
        source: 'relay',
      }),
    );
  });

  it('requires a selected resolver before marking a problem addressed', async () => {
    await expect(
      setDynatraceProblemAddressed('problem-1', true, undefined, 'note-1'),
    ).rejects.toThrow('Select your name from the resolver list.');

    expect(mocks.notesGetOne).not.toHaveBeenCalled();
    expect(mocks.statesCreate).not.toHaveBeenCalled();
  });

  it('rejects response evidence that belongs to a different problem', async () => {
    mocks.notesGetOne.mockResolvedValue({ id: 'note-1', problemId: 'problem-2', author: 'Ryan' });

    await expect(
      setDynatraceProblemAddressed('problem-1', true, undefined, 'note-1', RYAN),
    ).rejects.toThrow('Add a NOC note before marking this problem addressed.');

    expect(mocks.statesCreate).not.toHaveBeenCalled();
  });

  it('allows returning a problem to the queue without requiring another note', async () => {
    mocks.statesGetFirst.mockResolvedValue({ id: 'state-1', problemId: 'problem-1' });

    await setDynatraceProblemAddressed('problem-1', false);

    expect(mocks.notesGetFirst).not.toHaveBeenCalled();
    expect(mocks.statesUpdate).toHaveBeenCalledWith(
      'state-1',
      expect.objectContaining({
        addressed: false,
        addressedAt: '',
        ackState: 'cleared',
        sync: 'pending',
        scopeEntities: [],
      }),
    );
    expect(mocks.statesUpdate).toHaveBeenCalledWith(
      'state-1',
      expect.objectContaining({ addressedBy: '' }),
    );
  });

  it('queues attributed notes and addressed states while offline', async () => {
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

    await addDynatraceProblemNote('problem-1', 'Queued note', RYAN);
    await setDynatraceProblemAddressed('problem-1', true, undefined, 'dynatrace_probl', RYAN);

    expect(mutateOffline).toHaveBeenNthCalledWith(1, {
      collection: DYNATRACE_PROBLEM_NOTES_COLLECTION,
      action: 'create',
      data: {
        problemId: 'problem-1',
        note: 'Queued note',
        author: 'Ryan',
        analyst: 'ryan@example.com',
        noteId: expect.any(String),
        enteredBy: 'relay:unknown@unknown',
        source: 'relay',
        state: 'active',
        sync: 'pending',
      },
    });
    expect(mutateOffline).toHaveBeenNthCalledWith(2, {
      collection: DYNATRACE_PROBLEM_STATES_COLLECTION,
      action: 'create',
      data: expect.objectContaining({
        problemId: 'problem-1',
        addressed: true,
        addressedBy: 'Ryan',
        enteredBy: 'relay:unknown@unknown',
        sync: 'pending',
      }),
    });
  });

  it('requires newly persisted response evidence while offline', async () => {
    mocks.getConnectionState.mockReturnValue('offline');
    const mutateOffline = vi.fn();
    (globalThis as Record<string, unknown>).api = { mutateOffline };

    await expect(
      setDynatraceProblemAddressed('problem-1', true, undefined, undefined, RYAN),
    ).rejects.toThrow('Add a NOC note before marking this problem addressed.');

    expect(mutateOffline).not.toHaveBeenCalled();
  });
});

describe('Dynatrace note edits and deletes', () => {
  const rows = [
    {
      id: 'row-1',
      problemId: 'problem-1',
      noteId: 'note-uuid',
      note: 'old',
      author: 'Kelcee',
      analyst: 'kelcee@example.com',
      source: 'infra',
      grailTs: '2026-10-17T01:00:00.000Z',
    },
    { id: 'row-2', problemId: 'problem-2', noteId: 'note-uuid', note: 'old', source: 'infra' },
  ] as never[];

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getConnectionState.mockReturnValue('online');
    mocks.notesCreate.mockResolvedValue({});
  });

  it('appends a newer row for every problem of an edited note under the same note ID', async () => {
    await changeDynatraceProblemNote(rows, { text: '  UPS vendor dispatched  ' });

    expect(mocks.notesUpdate).not.toHaveBeenCalled();
    expect(mocks.notesCreate).toHaveBeenCalledTimes(2);
    expect(mocks.notesCreate).toHaveBeenCalledWith({
      problemId: 'problem-1',
      note: 'UPS vendor dispatched',
      state: 'active',
      noteId: 'note-uuid',
      author: 'Kelcee',
      analyst: 'kelcee@example.com',
      grailTs: '2026-10-17T01:00:00.000Z',
      enteredBy: 'relay:unknown@unknown',
      source: 'relay',
      sync: 'pending',
    });
    expect(mocks.notesCreate).toHaveBeenCalledWith(
      expect.objectContaining({ problemId: 'problem-2', noteId: 'note-uuid' }),
    );
  });

  it('appends a deleted row so Dynatrace hides the note too', async () => {
    await changeDynatraceProblemNote(rows, { deleted: true });

    expect(mocks.notesCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        problemId: 'problem-1',
        note: 'old',
        state: 'deleted',
        noteId: 'note-uuid',
        sync: 'pending',
      }),
    );
  });

  it('rejects an empty edit instead of sending a blank note', async () => {
    await expect(changeDynatraceProblemNote(rows, { text: '   ' })).rejects.toThrow(
      'delete the note',
    );
    expect(mocks.notesCreate).not.toHaveBeenCalled();
  });
});

describe('Dynatrace ticket reference notation', () => {
  it('parses only valid Relay ticket-reference notes', () => {
    expect(parseDynatraceTicketReferenceNote(`${DYNATRACE_TICKET_NOTE_PREFIX}INC0012345`)).toBe(
      'INC0012345',
    );
    expect(parseDynatraceTicketReferenceNote('Investigating the service.')).toBeNull();
    expect(parseDynatraceTicketReferenceNote(DYNATRACE_TICKET_NOTE_PREFIX)).toBeNull();
    expect(parseDynatraceTicketReferenceNote('Ticket: INC001\nCHG002')).toBeNull();
    expect(
      parseDynatraceTicketReferenceNote(
        `${DYNATRACE_TICKET_NOTE_PREFIX}${'A'.repeat(MAX_DYNATRACE_TICKET_REFERENCE_LENGTH + 1)}`,
      ),
    ).toBeNull();
  });
});
