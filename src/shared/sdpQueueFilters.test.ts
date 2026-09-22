import { expect, it } from 'vitest';
import { queueFilterCriteria, SdpQueueFiltersSchema } from './sdpQueueFilters';
it('combines exact field filters, scoped text search and bounded due dates', () => {
  const criteria = queueFilterCriteria(
    { status: 'Open', priority: 'High', technician: 'Example', search: '123', due: 'today' },
    1000,
  );
  expect(criteria).toContainEqual({
    field: 'status.name',
    condition: 'is',
    value: 'Open',
    logical_operator: 'AND',
  });
  expect(criteria.find((c) => c.field === 'subject')).toMatchObject({
    children: [
      { field: 'technician.name', logical_operator: 'OR' },
      { field: 'display_id', logical_operator: 'OR' },
    ],
  });
  expect(criteria.find((c) => c.field === 'due_by_time')).toMatchObject({
    value: '1000',
    children: [{ value: '86401000' }],
  });
  expect(SdpQueueFiltersSchema.safeParse({ endpoint: '/other' }).success).toBe(false);
});
