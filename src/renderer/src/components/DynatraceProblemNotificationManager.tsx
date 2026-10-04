import { useCallback, useEffect, useRef } from 'react';
import {
  DYNATRACE_PROBLEMS_COLLECTION,
  getDynatraceProblemDisplayTitle,
  type DynatraceProblemRecord,
  type DynatraceProblemSeverity,
} from '@shared/dynatraceProblems';
import { useCollection } from '../hooks/useCollection';
import { useOperationalToast } from '../features/notifications/NotificationProvider';

const SEVERITY_ORDER: Record<DynatraceProblemSeverity, number> = {
  AVAILABILITY: 0,
  MONITORING_UNAVAILABLE: 1,
  ERROR: 2,
  PERFORMANCE: 3,
  RESOURCE_CONTENTION: 4,
  CUSTOM_ALERT: 5,
  INFO: 6,
};

const ERROR_SEVERITIES = new Set<DynatraceProblemSeverity>([
  'AVAILABILITY',
  'MONITORING_UNAVAILABLE',
  'ERROR',
]);
const NOTIFICATION_BATCH_DELAY_MS = 250;
// Cover the one-minute enrichment cadence, lifecycle polling and its ten-second read budget.
const WORKFLOW_NAME_WAIT_MS = 90_000;

function problemSort(a: DynatraceProblemRecord, b: DynatraceProblemRecord): number {
  const severity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
  return severity || b.startTime - a.startTime;
}

function notificationMessage(problems: DynatraceProblemRecord[]): string {
  const primary = problems.toSorted(problemSort)[0];
  if (!primary) return '';
  const identifier = primary.displayId || primary.problemId;
  const suffix = problems.length > 1 ? ` (+${problems.length - 1} more)` : '';
  return identifier + ' · ' + getDynatraceProblemDisplayTitle(primary) + suffix;
}

export function DynatraceProblemNotificationManager({
  onOpenProblems,
  onOpenProblemsChange,
}: Readonly<{
  onOpenProblems: () => void;
  /** Shares this subscription's open in-scope problems, e.g. with the ⌘K palette. */
  onOpenProblemsChange?: (problems: readonly DynatraceProblemRecord[]) => void;
}>) {
  const showToast = useOperationalToast('Problems');
  const { data: problems, loading } = useCollection<DynatraceProblemRecord>(
    DYNATRACE_PROBLEMS_COLLECTION,
    { sort: '-startTime', filter: 'scopeExcluded=false && status="OPEN"' },
  );
  useEffect(() => {
    onOpenProblemsChange?.(problems);
  }, [onOpenProblemsChange, problems]);
  const initializedRef = useRef(false);
  const seenProblemIdsRef = useRef(new Set<string>());
  const pendingProblemsRef = useRef(new Map<string, DynatraceProblemRecord>());
  const notificationTimerRef = useRef<number | null>(null);
  const batchStartedAtRef = useRef<number | null>(null);

  const flushNotifications = useCallback(() => {
    notificationTimerRef.current = null;
    batchStartedAtRef.current = null;
    const newOpenProblems = [...pendingProblemsRef.current.values()];
    pendingProblemsRef.current.clear();
    if (newOpenProblems.length === 0) return;

    const primary = newOpenProblems.toSorted(problemSort)[0];
    const toastType = primary && ERROR_SEVERITIES.has(primary.severity) ? 'error' : 'warning';
    showToast(notificationMessage(newOpenProblems), toastType, {
      title: newOpenProblems.length === 1 ? 'New Dynatrace problem' : 'New Dynatrace problems',
      durationMs: 8_000,
      delivery: 'dynatrace-problem',
      action: { label: 'Open Problems', onClick: onOpenProblems },
    });
  }, [onOpenProblems, showToast]);

  useEffect(() => {
    if (loading) return;

    if (!initializedRef.current) {
      for (const problem of problems) seenProblemIdsRef.current.add(problem.problemId);
      initializedRef.current = true;
      return;
    }

    const pending = pendingProblemsRef.current;
    const currentOpenProblems = new Map(
      problems
        .filter((problem) => problem.status === 'OPEN' && !problem.scopeExcluded)
        .map((problem) => [problem.problemId, problem]),
    );
    for (const id of pending.keys()) {
      const current = currentOpenProblems.get(id);
      if (current) pending.set(id, current);
      else pending.delete(id);
    }
    for (const [id, problem] of currentOpenProblems) {
      if (!seenProblemIdsRef.current.has(id)) pending.set(id, problem);
    }
    for (const problem of problems) seenProblemIdsRef.current.add(problem.problemId);

    if (notificationTimerRef.current !== null) {
      window.clearTimeout(notificationTimerRef.current);
      notificationTimerRef.current = null;
    }
    if (pending.size === 0) {
      batchStartedAtRef.current = null;
      return;
    }

    batchStartedAtRef.current ??= Date.now();
    const namesReady = [...pending.values()].every(
      (problem) =>
        problem.notificationStatus === problem.status && problem.notificationTitle?.trim(),
    );
    const delay = namesReady ? NOTIFICATION_BATCH_DELAY_MS : WORKFLOW_NAME_WAIT_MS;
    notificationTimerRef.current = window.setTimeout(
      flushNotifications,
      Math.max(0, batchStartedAtRef.current + delay - Date.now()),
    );
  }, [flushNotifications, loading, problems]);

  useEffect(
    () => () => {
      if (notificationTimerRef.current !== null) {
        window.clearTimeout(notificationTimerRef.current);
      }
    },
    [],
  );

  return null;
}
