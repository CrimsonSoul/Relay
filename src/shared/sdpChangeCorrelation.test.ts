import { expect, it } from 'vitest';
import { correlateSdpChanges } from './sdpChangeCorrelation';
import type { DynatraceProblemRecord } from './dynatraceProblems';
import { SdpChangesCommandSchema, type SdpChangeRecord } from './sdpChanges';
const at = Date.UTC(2026, 8, 20, 12);
const problem = {
  startTime: at,
  affectedEntities: [{ id: 'HOST-1', type: 'HOST', name: 'db01.prod.test' }],
  impactedEntities: [],
  managementZones: [{ id: '1', name: 'Production' }],
} as unknown as DynatraceProblemRecord;
const change: SdpChangeRecord = {
  id: '1',
  number: 'CH 1',
  title: 'Patching',
  description: '',
  status: 'In progress',
  stage: 'Implementation',
  site: '',
  scheduledStart: at - 3600000,
  scheduledEnd: at + 3600000,
  assets: ['DB01.PROD.TEST.'],
  services: [],
};
it('automatically associates exact qualified hosts with timing evidence', () => {
  expect(correlateSdpChanges(problem, [change])[0]).toMatchObject({
    confidence: 'automatic',
    reasons: expect.arrayContaining([
      'Exact fully qualified hostname',
      'Problem started during the scheduled change window',
    ]),
  });
});
it('requires context for short names, never merges different domains, and handles ambiguous entities', () => {
  expect(correlateSdpChanges(problem, [{ ...change, assets: ['db01.dev.test'] }])).toEqual([]);
  expect(correlateSdpChanges(problem, [{ ...change, assets: ['db01'] }])[0]!.confidence).toBe(
    'suggested',
  );
  const short = { ...problem, affectedEntities: [{ id: 'H1', type: 'HOST', name: 'DB01' }] };
  expect(
    correlateSdpChanges(short, [{ ...change, assets: ['db01'], site: 'Production' }])[0]!
      .confidence,
  ).toBe('automatic');
  const ambiguous = {
    ...problem,
    impactedEntities: [{ id: 'H2', type: 'HOST', name: 'db01.prod.test' }],
  };
  expect(correlateSdpChanges(ambiguous, [change])[0]!.confidence).toBe('suggested');
});
it('honors the two-hour grace, seven-day lookback, missing end, and cancelled status', () => {
  expect(
    correlateSdpChanges(problem, [
      { ...change, scheduledStart: at - 10800000, scheduledEnd: at - 7200000 },
    ]),
  ).toHaveLength(1);
  for (const fields of [
    { scheduledStart: at + 1 },
    { scheduledEnd: at - 7200001 },
    { scheduledEnd: change.scheduledStart! - 1 },
    { scheduledStart: at - 7 * 86400000 - 1 },
    { status: 'Cancelled' },
    { scheduledStart: null },
  ])
    expect(correlateSdpChanges(problem, [{ ...change, ...fields }])).toEqual([]);
  expect(correlateSdpChanges(problem, [{ ...change, scheduledEnd: null }])[0]!.confidence).toBe(
    'suggested',
  );
});
it('suggests exact service and text mentions, but never substring matches or service-only automatic matches', () => {
  const service = {
    ...problem,
    impactedEntities: [{ id: 'S1', type: 'SERVICE', name: 'Payments' }],
  };
  expect(
    correlateSdpChanges(service, [{ ...change, assets: [], services: ['payments'] }])[0]!
      .confidence,
  ).toBe('suggested');
  expect(
    correlateSdpChanges(problem, [
      { ...change, assets: [], description: '<p>Restart db01.prod.test</p>' },
    ])[0]!.confidence,
  ).toBe('suggested');
  expect(
    correlateSdpChanges(problem, [
      { ...change, assets: [], description: 'db01.prod.test2 db01.prod.test.other' },
    ]),
  ).toEqual([]);
});
it('bounds the read contract and rejects injected fields', () => {
  expect(
    SdpChangesCommandSchema.safeParse({ action: 'readChanges', problemStart: at, page: 10 })
      .success,
  ).toBe(false);
  expect(
    SdpChangesCommandSchema.safeParse({
      action: 'readChanges',
      problemStart: at,
      page: 0,
      url: 'https://other.test',
    }).success,
  ).toBe(false);
});

it('matches host and service type variants emitted by Classic and Grail', () => {
  for (const type of ['host', 'dt.entity.host', 'HOST']) {
    const variant = { ...problem, affectedEntities: [{ id: 'H1', type, name: 'db01.prod.test' }] };
    expect(correlateSdpChanges(variant, [change])[0]?.confidence).toBe('automatic');
  }
  for (const type of ['service', 'dt.entity.service', 'SERVICE']) {
    const variant = { ...problem, affectedEntities: [{ id: 'S1', type, name: 'Payments' }] };
    expect(
      correlateSdpChanges(variant, [{ ...change, assets: [], services: ['Payments'] }])[0]
        ?.confidence,
    ).toBe('suggested');
  }
});

it('matches affected configuration items when assets are empty', () => {
  expect(
    correlateSdpChanges(problem, [
      { ...change, assets: [], configurationItems: ['db01.prod.test'] },
    ])[0]?.confidence,
  ).toBe('automatic');
});
