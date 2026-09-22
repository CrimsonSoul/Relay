import { z } from 'zod';
import { NotificationTargetSchema } from './notifications';
const text = (max: number) => z.string().trim().max(max);
export const TicketNotificationPayloadSchema = z
  .object({
    title: z.string().min(1).max(100),
    body: z.string().min(1).max(300),
    target: NotificationTargetSchema.optional(),
  })
  .strict();
export const TICKET_EVENTS = [
  'created',
  'queue',
  'assignment',
  'priority',
  'status',
  'reply',
  'sla-soon',
  'sla-breached',
] as const;
export type TicketEventType = (typeof TICKET_EVENTS)[number];
export type TicketEvent = { key: string; ticketId: string; type: TicketEventType; at: number };
export const RULE_FIELDS = [
  'group',
  'priority',
  'status',
  'assignee',
  'requestType',
  'category',
  'template',
  'majorIncident',
  'linkedProblem',
  'id',
] as const;
export const TicketRuleSchema = z.object({
  id: text(64).min(1),
  name: text(120).min(1),
  enabled: z.boolean(),
  events: z.array(z.enum(TICKET_EVENTS)).min(1),
  match: z.enum(['all', 'any']),
  conditions: z
    .array(
      z.object({
        field: z.enum(RULE_FIELDS),
        operator: z.enum(['is', 'is not', 'contains']),
        value: text(250),
      }),
    )
    .max(20),
  inbox: z.boolean(),
  toast: z.boolean(),
  desktop: z.boolean(),
  sound: z.boolean(),
  cooldownMinutes: z.number().int().min(0).max(1440),
});
export type TicketRule = z.infer<typeof TicketRuleSchema>;
export type TicketNotice = {
  id: string;
  ticketId: string;
  label: string;
  subject: string;
  type: TicketEventType;
  ruleName: string;
  at: number;
  acknowledged: boolean;
};
export const TicketPreferencesSchema = z.object({
  rules: z.array(TicketRuleSchema).max(30),
  warningMinutes: z.number().int().min(1).max(1440),
  quietStart: z.string().regex(/^$|^([01]\d|2[0-3]):[0-5]\d$/),
  quietEnd: z.string().regex(/^$|^([01]\d|2[0-3]):[0-5]\d$/),
  snoozeUntil: z.number().nonnegative(),
});
export type TicketPreferences = z.infer<typeof TicketPreferencesSchema>;
export function defaultTicketPreferences(): TicketPreferences {
  return {
    rules: [
      {
        id: 'all-new',
        name: 'New tickets',
        enabled: true,
        events: ['created'],
        match: 'all',
        conditions: [],
        inbox: true,
        toast: true,
        desktop: false,
        sound: false,
        cooldownMinutes: 0,
      },
      {
        id: 'sla',
        name: 'SLA needs attention',
        enabled: true,
        events: ['sla-soon', 'sla-breached'],
        match: 'all',
        conditions: [],
        inbox: true,
        toast: true,
        desktop: false,
        sound: false,
        cooldownMinutes: 0,
      },
    ],
    warningMinutes: 30,
    quietStart: '',
    quietEnd: '',
    snoozeUntil: 0,
  };
}
export function quietNow(preferences: TicketPreferences, now: number): boolean {
  if (preferences.snoozeUntil > now) return true;
  const { quietStart, quietEnd } = preferences;
  if (!quietStart || !quietEnd || quietStart === quietEnd) return false;
  const date = new Date(now);
  const current = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  return quietStart < quietEnd
    ? current >= quietStart && current < quietEnd
    : current >= quietStart || current < quietEnd;
}
