import { describe, expect, it } from 'vitest';
import type {
  DynatraceProblemNoteRecord,
  DynatraceProblemRecord,
  DynatraceProblemStateRecord,
} from '@shared/dynatraceProblems';
import { buildDynatraceProblemQueueModel } from '../dynatraceProblemQueueModel';

function problem(
  problemId: string,
  status: DynatraceProblemRecord['status'],
  startTime: number,
): DynatraceProblemRecord {
  return {
    id: `record-${problemId}`,
    problemId,
    displayId: `P-${problemId}`,
    title: problemId,
    status,
    severity: 'ERROR',
    impactLevel: 'SERVICES',
    startTime,
    endTime: status === 'OPEN' ? -1 : startTime + 1_000,
    rootCauseName: '',
    affectedEntities: [],
    impactedEntities: [],
    managementZones: [],
    alertingProfiles: [],
    environmentUrl: 'https://example.live.dynatrace.com',
    syncedAt: '2026-08-23T12:00:00.000Z',
  };
}

describe('buildDynatraceProblemQueueModel', () => {
  it('derives counts and history response ordering in one pure model', () => {
    const unaddressed = problem('unaddressed', 'OPEN', 300);
    const addressed = problem('addressed', 'OPEN', 200);
    const historyWithoutResponse = problem('history-new', 'CLOSED', 500);
    const historyWithResponse = problem('history-response', 'CLOSED', 100);
    const states = new Map<string, DynatraceProblemStateRecord>([
      [
        addressed.problemId,
        {
          id: 'addressed-state',
          problemId: addressed.problemId,
          addressed: true,
          addressedAt: '2026-08-23T12:00:00.000Z',
          addressedBy: 'Ryan',
          created: '2026-08-23T12:00:00.000Z',
          updated: '2026-08-23T12:00:00.000Z',
        },
      ],
    ]);
    const notes = new Map<string, DynatraceProblemNoteRecord[]>([
      [
        historyWithResponse.problemId,
        [
          {
            id: 'response-note',
            problemId: historyWithResponse.problemId,
            note: 'Investigating',
            author: 'Ryan',
            created: '2026-08-23T12:00:00.000Z',
            updated: '2026-08-23T12:00:00.000Z',
          },
        ],
      ],
    ]);

    const model = buildDynatraceProblemQueueModel({
      problems: [unaddressed, addressed, historyWithoutResponse, historyWithResponse],
      stateByProblemId: states,
      notesByProblemId: notes,
      totalHistoryCount: 12,
      filter: 'resolved',
      query: '',
      historySort: 'response-first',
      historyResponseFilter: 'all',
    });

    expect(model.counts).toEqual({
      unaddressed: 1,
      addressed: 1,
      resolved: 12,
      loadedHistory: 2,
    });
    expect(model.unaddressedProblemIds).toEqual(['unaddressed']);
    expect(model.filteredProblems.map(({ problemId }) => problemId)).toEqual([
      'history-response',
      'history-new',
    ]);
    expect(model.responseSummaries.get(historyWithResponse.problemId)).toMatchObject({
      hasLocalResponse: true,
      nocNoteCount: 1,
      responder: 'Ryan',
    });
  });
});
