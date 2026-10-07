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
it('matches any selected value and keeps one selection in the single-value wire form', () => {
  const criteria = queueFilterCriteria({
    status: ['Open', 'On Hold', 'Resolved'],
    priority: 'High',
  });
  expect(criteria).toContainEqual({
    field: 'status.name',
    condition: 'is',
    value: 'Open',
    logical_operator: 'AND',
    children: [
      { field: 'status.name', condition: 'is', value: 'On Hold', logical_operator: 'OR' },
      { field: 'status.name', condition: 'is', value: 'Resolved', logical_operator: 'OR' },
    ],
  });
  expect(criteria.find((c) => c.field === 'priority.name')).not.toHaveProperty('children');
  expect(SdpQueueFiltersSchema.safeParse({ status: [] }).success).toBe(false);
  expect(SdpQueueFiltersSchema.safeParse({ status: [''] }).success).toBe(false);
  expect(SdpQueueFiltersSchema.safeParse({ status: Array(51).fill('Open') }).success).toBe(false);
});
