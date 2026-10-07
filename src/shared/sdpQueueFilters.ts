import { z } from 'zod';
// One selection stays a plain string so servers that predate multi-select keep accepting it.
const SdpFilterChoiceSchema = z.union([
  z.string().max(200),
  z.array(z.string().min(1).max(200)).min(1).max(50),
]);
export const SdpQueueFiltersSchema = z
  .object({
    search: z.string().trim().max(200).optional(),
    status: SdpFilterChoiceSchema.optional(),
    priority: SdpFilterChoiceSchema.optional(),
    technician: SdpFilterChoiceSchema.optional(),
    due: z.enum(['overdue', 'today']).optional(),
  })
  .strict();
export type SdpQueueFilters = z.infer<typeof SdpQueueFiltersSchema>;
export type SdpQueueChoiceFilter = 'status' | 'priority' | 'technician';
export function filterValues(value?: string | readonly string[]): string[] {
  if (value === undefined) return [];
  return (typeof value === 'string' ? [value] : [...value]).filter(Boolean);
}
export function queueFilterCriteria(
  filters?: SdpQueueFilters,
  now = Date.now(),
): Record<string, unknown>[] {
  if (!filters) return [];
  const criteria: Record<string, unknown>[] = [];
  for (const field of ['status', 'priority', 'technician'] as const) {
    // Any selected value matches: the first is the AND criterion, the rest are OR children.
    const [first, ...rest] = filterValues(filters[field]);
    if (first === undefined) continue;
    criteria.push({
      field: `${field}.name`,
      condition: 'is',
      value: first,
      logical_operator: 'AND',
      ...(rest.length
        ? {
            children: rest.map((value) => ({
              field: `${field}.name`,
              condition: 'is',
              value,
              logical_operator: 'OR',
            })),
          }
        : {}),
    });
  }
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
