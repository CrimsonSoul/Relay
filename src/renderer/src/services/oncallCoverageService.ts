import { z } from 'zod';
import type { OnCallRow } from '@shared/ipc';
import { getPb, requireOnline, escapeFilter } from './pocketbase';
import { isWebMutationGateReady } from '../stores/webOnlineGate';

export const COVERAGE_COLLECTION = 'oncall_coverage_reviews';
export const COVERAGE_UNAVAILABLE =
  'Coverage confirmation unavailable. Upgrade the Relay server or reconnect and try again.';
export interface CoverageReview {
  id: string;
  teamId: string;
  validThrough: string;
  rowsFingerprint: string;
  created?: string;
  updated?: string;
}
export function calendarDate(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
function isCalendarDate(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
const confirmationSchema = z
  .object({
    teamId: z.string().trim().min(1).max(500),
    validThrough: z
      .string()
      .refine(isCalendarDate, 'Choose a valid calendar date.')
      .refine((value) => value >= calendarDate(), 'Choose today or a later date.'),
  })
  .strict();

/** Canonical ordered content; server bookkeeping and local queue times are excluded. */
export function coverageFingerprint(rows: OnCallRow[]): string {
  return JSON.stringify(
    rows.map((row) => [
      row.id,
      row.teamId,
      row.team,
      row.role,
      row.name,
      row.contact,
      row.timeWindow ?? '',
    ]),
  );
}
export function coverageState(
  review: CoverageReview | undefined,
  rows: OnCallRow[],
): 'confirmed' | 'needs-review' | 'not-confirmed' {
  if (!review) return 'not-confirmed';
  return isCalendarDate(review.validThrough) &&
    review.validThrough >= calendarDate() &&
    review.rowsFingerprint === coverageFingerprint(rows) &&
    !rows.some((row) => row.queuedAt)
    ? 'confirmed'
    : 'needs-review';
}
async function requireConfirmationReady(rows: OnCallRow[]): Promise<void> {
  requireOnline();
  if (globalThis.api?.runtime?.kind === 'web') {
    if (!isWebMutationGateReady())
      throw new Error('Wait for Relay Web to finish refreshing before confirming coverage.');
  } else {
    const status = await globalThis.api?.getPendingSyncStatus?.();
    if (!status)
      throw new Error('Could not verify pending changes. Reconnect before confirming coverage.');
    if (status.pendingCount > 0)
      throw new Error('Sync pending changes before confirming coverage.');
  }
  if (rows.some((row) => row.queuedAt))
    throw new Error('Sync pending changes before confirming coverage.');
  requireOnline();
}
export async function confirmCoverage(
  input: { teamId: string; validThrough: string },
  visibleRows: OnCallRow[],
): Promise<CoverageReview> {
  const parsed = confirmationSchema.safeParse(input);
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Invalid confirmation.');
  const { teamId, validThrough } = parsed.data;
  await requireConfirmationReady(visibleRows);
  const pb = getPb();
  const readRows = () =>
    pb.collection('oncall').getFullList<OnCallRow>({
      filter: `teamId="${escapeFilter(teamId)}"`,
      sort: 'sortOrder,id',
      requestKey: null,
    });
  const authoritativeRows = await readRows();
  const rowsFingerprint = coverageFingerprint(visibleRows);
  if (
    !visibleRows.length ||
    visibleRows.some((row) => row.teamId !== teamId) ||
    coverageFingerprint(authoritativeRows) !== rowsFingerprint
  ) {
    throw new Error('Coverage changed on the server. Refresh the board and review it again.');
  }
  try {
    const reviews = pb.collection(COVERAGE_COLLECTION);
    const existing = await reviews.getFullList<CoverageReview>({
      filter: `teamId="${escapeFilter(teamId)}"`,
      requestKey: null,
    });
    // Recheck after network reads: the workstation may have queued edits meanwhile.
    await requireConfirmationReady(visibleRows);
    const data = { teamId, validThrough, rowsFingerprint };
    const saved = existing[0]
      ? await reviews.update<CoverageReview>(existing[0].id, data)
      : await reviews.create<CoverageReview>(data);
    const readback = await reviews.getOne<CoverageReview>(saved.id, { requestKey: null });
    const currentRows = await readRows();
    await requireConfirmationReady(currentRows);
    if (
      readback.teamId !== teamId ||
      readback.validThrough !== validThrough ||
      readback.rowsFingerprint !== rowsFingerprint ||
      coverageFingerprint(currentRows) !== rowsFingerprint
    ) {
      throw new Error('Coverage changed while confirming. Refresh the board and review it again.');
    }
    return readback;
  } catch (error) {
    if (error && typeof error === 'object' && 'status' in error && error.status === 404)
      throw new Error(COVERAGE_UNAVAILABLE);
    throw error;
  }
}
