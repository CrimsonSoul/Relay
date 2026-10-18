/**
 * Canonical card identity for an on-call team display name: board order, grouping, dedup and the
 * `teamId` written by backfill and rename all use this one rule.
 */
export const normalizeTeamId = (name: string): string => name.trim().toLowerCase();
