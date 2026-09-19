import { z } from 'zod';
export const SdpQueueFiltersSchema = z
  .object({
    search: z.string().trim().max(200).optional(),
    status: z.string().max(200).optional(),
    priority: z.string().max(200).optional(),
    technician: z.string().max(200).optional(),
    due: z.enum(['overdue', 'today']).optional(),
  })
  .strict();
export type SdpQueueFilters = z.infer<typeof SdpQueueFiltersSchema>;
export function queueFilterCriteria(
  filters?: SdpQueueFilters,
  now = Date.now(),
): Record<string, unknown>[] {
  if (!filters) return [];
  const criteria: Record<string, unknown>[] = [];
  for (const field of ['status', 'priority', 'technician'] as const)
    if (filters[field])
      criteria.push({
        field: `${field}.name`,
        condition: 'is',
        value: filters[field],
        logical_operator: 'AND',
      });
  if (filters.search) {
    const children: Record<string, unknown>[] = [
      {
        field: 'technician.name',
        condition: 'contains',
        value: filters.search,
        logical_operator: 'OR',
      },
    ];
    if (/^\d{1,30}$/.test(filters.search))
      children.push({
        field: 'display_id',
        condition: 'is',
        value: filters.search,
        logical_operator: 'OR',
      });
    criteria.push({
      field: 'subject',
      condition: 'contains',
      value: filters.search,
      logical_operator: 'AND',
      children,
    });
  }
  if (filters.due === 'overdue')
    criteria.push({
      field: 'due_by_time',
      condition: 'lesser than',
      value: String(now),
      logical_operator: 'AND',
    });
  if (filters.due === 'today')
    criteria.push({
      field: 'due_by_time',
      condition: 'greater or equal',
      value: String(now),
      logical_operator: 'AND',
      children: [
        {
          field: 'due_by_time',
          condition: 'lesser than',
          value: String(now + 86400000),
          logical_operator: 'AND',
        },
      ],
    });
  return criteria;
}
