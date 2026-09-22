import { z } from 'zod';

export const SDP_RESOURCE_NAMES = [
  'tasks',
  'worklogs',
  'approval_levels',
  'approvals',
  'checklists',
  'checklistitems',
  'reminders',
] as const;
export type SdpResourceName = (typeof SDP_RESOURCE_NAMES)[number];
export const SDP_RESOURCE_LABELS: Record<SdpResourceName, string> = {
  tasks: 'Tasks',
  worklogs: 'Worklogs',
  approval_levels: 'Approval levels',
  approvals: 'Approvals',
  checklists: 'Checklists',
  checklistitems: 'Checklist items',
  reminders: 'Reminders',
};
const id = z.string().regex(/^\d{1,30}$/);
export const SdpResourceCommandSchema = z
  .object({
    action: z.literal('readResources'),
    id,
    resource: z.enum(SDP_RESOURCE_NAMES),
    levelId: id.optional(),
    checklistId: id.optional(),
    page: z.number().int().min(0).max(99),
  })
  .strict()
  .refine(
    (value) =>
      (value.resource !== 'approvals' || !!value.levelId) &&
      (value.resource !== 'checklistitems' || !!value.checklistId),
    'Choose the parent approval level or checklist.',
  );
export type SdpResourceCommand = z.infer<typeof SdpResourceCommandSchema>;
export const SDP_RESOURCE_FIELDS = {
  tasks: {
    title: 'Title',
    description: 'Description',
    status: 'Status',
    priority: 'Priority',
    ownerEmail: 'Owner email',
    taskType: 'Task type',
    templateId: 'Task template ID',
    scheduledStart: 'Scheduled start',
    scheduledEnd: 'Scheduled end',
    actualStart: 'Actual start',
    actualEnd: 'Actual end',
    completion: 'Completion (%)',
    effortDays: 'Estimated days',
    effortHours: 'Estimated hours',
    effortMinutes: 'Estimated minutes',
    additionalCost: 'Additional cost',
  },
  worklogs: {
    description: 'Description',
    ownerEmail: 'Technician email',
    startTime: 'Start time',
    endTime: 'End time',
    hours: 'Hours',
    minutes: 'Minutes',
    techCharge: 'Technician charge',
    otherCharge: 'Other charge',
    currencyId: 'Currency ID',
    exchangeRate: 'Exchange rate',
    includeNonoperational: 'Include nonoperational hours',
  },
  approval_levels: { level: 'Level' },
  approvals: { approverEmail: 'Approver email', comments: 'Comments' },
  reminders: {
    summary: 'Summary',
    reminderDate: 'Date and time',
    remindBefore: 'Email me before',
    reminderStatus: 'Status',
  },
  checklists: {
    name: 'Name',
    description: 'Description',
    checklistTemplateId: 'Checklist template (optional)',
  },
  checklistitems: {
    itemId: 'Checklist item',
    order: 'Order',
    completed: 'Completed',
    value: 'Answer',
  },
} as const;
export type SdpResourceOperation = 'create' | 'update' | 'delete' | 'approve' | 'reject';
const short = z.string().trim().min(1).max(250).optional();
const number = z
  .string()
  .regex(/^\d+(\.\d+)?$/)
  .refine((value) => Number(value) <= 100000000);
const date = z.iso.datetime({ offset: true }).optional();
const fieldSchemas = {
  reminders: z
    .object({
      summary: short,
      reminderDate: date,
      remindBefore: z
        .string()
        .regex(/^\d{1,5}$/)
        .refine((v) => [0, 15, 30, 45, 60, 120, 360, 720, 1440, 2880, 10080].includes(Number(v)))
        .optional(),
      reminderStatus: z.enum(['Open', 'Completed']).optional(),
    })
    .strict(),
  checklists: z
    .object({
      name: short,
      description: z.string().max(12000).optional(),
      checklistTemplateId: id.optional(),
    })
    .strict(),
  checklistitems: z
    .object({
      itemId: id.optional(),
      order: z
        .string()
        .regex(/^\d{1,3}$/)
        .optional(),
      completed: z.enum(['true', 'false']).optional(),
      value: z.string().max(12000).optional(),
    })
    .strict(),
  tasks: z
    .object({
      title: short,
      description: z.string().max(12000).optional(),
      status: short,
      priority: short,
      ownerEmail: z.email().optional(),
      taskType: short,
      templateId: id.optional(),
      scheduledStart: date,
      scheduledEnd: date,
      actualStart: date,
      actualEnd: date,
      completion: number.refine((value) => Number(value) <= 100).optional(),
      effortDays: number.optional(),
      effortHours: number.optional(),
      effortMinutes: number.refine((value) => Number(value) <= 59).optional(),
      additionalCost: number.optional(),
    })
    .strict(),
  worklogs: z
    .object({
      description: z.string().max(12000).optional(),
      ownerEmail: z.email().optional(),
      startTime: date,
      endTime: date,
      hours: number.optional(),
      minutes: number.refine((value) => Number(value) <= 59).optional(),
      techCharge: number.optional(),
      otherCharge: number.optional(),
      currencyId: id.optional(),
      exchangeRate: number.optional(),
      includeNonoperational: z.enum(['true', 'false']).optional(),
    })
    .strict(),
  approval_levels: z.object({ level: z.string().regex(/^\d{1,3}$/) }).strict(),
  approvals: z
    .object({ approverEmail: z.email().optional(), comments: z.string().max(12000).optional() })
    .strict(),
};
const commentsSchema = z.object({ comments: z.string().max(12000).optional() }).strict();
const required: Record<SdpResourceName, string[]> = {
  reminders: ['summary', 'reminderDate'],
  checklists: ['name'],
  checklistitems: ['itemId'],
  tasks: ['title'],
  worklogs: ['ownerEmail', 'hours', 'minutes'],
  approval_levels: ['level'],
  approvals: ['approverEmail'],
};
function validateFields(
  resource: SdpResourceName,
  operation: SdpResourceOperation,
  fields: Record<string, string>,
): string[] {
  const errors: string[] = [];
  if (
    resource === 'worklogs' &&
    ['hours', 'minutes'].filter((key) => fields[key] !== undefined).length === 1
  )
    errors.push('Specify both hours and minutes when changing time spent.');
  let schema: z.ZodType = fieldSchemas[resource];
  if (['approve', 'reject'].includes(operation)) schema = commentsSchema;
  if (operation === 'delete') schema = z.object({}).strict();
  if (!schema.safeParse(fields).success)
    errors.push('Check the field values, email addresses, dates and numeric ranges.');
  if (operation === 'create' && required[resource].some((key) => !fields[key]?.trim()))
    errors.push('Complete the required fields.');
  return errors;
}
function validateChecklistOperation(
  value: {
    resource: SdpResourceName;
    operation: SdpResourceOperation;
    fields: Record<string, string>;
    checklistId?: string;
  },
  fail: (message: string) => void,
) {
  if (value.resource === 'checklistitems' && !value.checklistId) fail('Choose a checklist.');
  if (value.resource === 'checklistitems' && value.operation === 'delete')
    fail('Checklist items cannot be deleted individually.');
  if (
    value.resource === 'checklists' &&
    value.operation === 'update' &&
    value.fields.checklistTemplateId
  )
    fail('Templates can only be selected when adding a checklist.');
  if (
    value.resource === 'checklistitems' &&
    value.operation === 'create' &&
    ('completed' in value.fields || 'value' in value.fields)
  )
    fail('Complete the item after adding it.');
}
export const SdpResourceMutationSchema = z
  .object({
    kind: z.literal('resource'),
    id,
    resource: z.enum(SDP_RESOURCE_NAMES),
    levelId: id.optional(),
    checklistId: id.optional(),
    recordId: id.optional(),
    operation: z.enum(['create', 'update', 'delete', 'approve', 'reject']),
    fields: z.record(z.string().max(60), z.string().max(12000)),
  })
  .strict()
  .superRefine((value, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
    validateChecklistOperation(value, fail);
    if (value.resource === 'approvals' && !value.levelId) fail('Choose an approval level.');
    if (value.operation !== 'create' && !value.recordId) fail('Choose an existing record.');
    if (value.operation === 'update' && !Object.keys(value.fields).length)
      fail('Change at least one field.');
    const decision = ['approve', 'reject'].includes(value.operation);
    if (decision && value.resource !== 'approvals') fail('Only approvals support this action.');
    if (value.operation === 'update' && ['approvals', 'approval_levels'].includes(value.resource))
      fail('This resource cannot be edited.');
    validateFields(value.resource, value.operation, value.fields).forEach(fail);
  });
export type SdpResourceMutation = z.infer<typeof SdpResourceMutationSchema>;
export const SdpResourcePageSchema = z
  .object({
    id,
    resource: z.enum(SDP_RESOURCE_NAMES),
    levelId: id.optional(),
    checklistId: id.optional(),
    page: z.number(),
    hasMore: z.boolean(),
    rows: z
      .array(
        z
          .object({
            id,
            title: z.string().max(500),
            status: z.string().max(200),
            fields: z.record(z.string().max(60), z.string().max(12000)),
          })
          .strict(),
      )
      .max(50),
  })
  .strict();
export type SdpResourcePage = z.infer<typeof SdpResourcePageSchema>;

export const SdpResourceChoicesCommandSchema = z
  .object({
    action: z.literal('readResourceChoices'),
    id,
    catalog: z.enum(['checklist_templates', 'item_details']),
    search: z.string().trim().max(200),
    page: z.number().int().min(0).max(99),
  })
  .strict();
export type SdpResourceChoicesCommand = z.infer<typeof SdpResourceChoicesCommandSchema>;
export const SdpResourceChoicesSchema = z
  .object({
    catalog: z.enum(['checklist_templates', 'item_details']),
    page: z.number().int(),
    hasMore: z.boolean(),
    choices: z.array(z.object({ id, name: z.string().max(250) }).strict()).max(50),
  })
  .strict();
export type SdpResourceChoices = z.infer<typeof SdpResourceChoicesSchema>;
