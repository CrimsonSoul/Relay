import { z } from 'zod';

export const NOTIFICATION_SOURCES = ['Tickets', 'Problems', 'Radar', 'Status'] as const;
export type NotificationSource = (typeof NOTIFICATION_SOURCES)[number];
export const NotificationTargetSchema = z.discriminatedUnion('source', [
  z.object({ source: z.literal('Tickets'), ticketId: z.string().regex(/^\d{1,30}$/) }).strict(),
  z.object({ source: z.enum(['Problems', 'Radar', 'Status']) }).strict(),
]);
export type NotificationTarget = z.infer<typeof NotificationTargetSchema>;
const sourcePreferences = z.object({
  enabled: z.boolean(),
  sound: z.boolean(),
  info: z.boolean(),
  warning: z.boolean(),
  error: z.boolean(),
});
export const NotificationPreferencesSchema = z
  .object({
    toast: z.boolean(),
    desktop: z.boolean(),
    sound: z.boolean(),
    quietHoursEnabled: z.boolean().optional(),
    quietStart: z.string().regex(/^$|^([01]\d|2[0-3]):[0-5]\d$/),
    quietEnd: z.string().regex(/^$|^([01]\d|2[0-3]):[0-5]\d$/),
    snoozeUntil: z.number().nonnegative(),
    sources: z.object({
      Tickets: sourcePreferences,
      Problems: sourcePreferences,
      Radar: sourcePreferences,
      Status: sourcePreferences,
    }),
  })
  .transform((preferences) => ({
    ...preferences,
    // Preserve schedules saved before the toggle without enabling empty schedules.
    quietHoursEnabled:
      preferences.quietHoursEnabled ?? (!!preferences.quietStart && !!preferences.quietEnd),
  }));
export type NotificationPreferences = z.infer<typeof NotificationPreferencesSchema>;
export function defaultNotificationPreferences(): NotificationPreferences {
  const source = (sound = false) => ({
    enabled: true,
    sound,
    info: true,
    warning: true,
    error: true,
  });
  return {
    toast: true,
    desktop: false,
    sound: true,
    quietHoursEnabled: false,
    quietStart: '',
    quietEnd: '',
    snoozeUntil: 0,
    sources: { Tickets: source(), Problems: source(true), Radar: source(), Status: source() },
  };
}
