import { useCallback, useEffect, useRef } from 'react';
import {
  DYNATRACE_PROBLEMS_COLLECTION,
  type DynatraceProblemRecord,
  type DynatraceProblemSeverity,
} from '@shared/dynatraceProblems';
import { useCollection } from '../hooks/useCollection';
import { useToast } from './Toast';

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

function problemSort(a: DynatraceProblemRecord, b: DynatraceProblemRecord): number {
  const severity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
  return severity || b.startTime - a.startTime;
}

function notificationMessage(problems: DynatraceProblemRecord[]): string {
  const primary = problems.toSorted(problemSort)[0];
  if (!primary) return '';
  const identifier = primary.displayId || primary.problemId;
  const suffix = problems.length > 1 ? ` (+${problems.length - 1} more)` : '';
  return `${identifier} · ${primary.title}${suffix}`;
}

export function DynatraceProblemNotificationManager({
  onOpenProblems,
}: Readonly<{ onOpenProblems: () => void }>) {
  const { showToast } = useToast();
  const { data: problems, loading } = useCollection<DynatraceProblemRecord>(
    DYNATRACE_PROBLEMS_COLLECTION,
    { sort: '-startTime', filter: 'scopeExcluded=false && status="OPEN"' },
  );
  const initializedRef = useRef(false);
  const seenProblemIdsRef = useRef(new Set<string>());
  const pendingProblemsRef = useRef(new Map<string, DynatraceProblemRecord>());
  const notificationTimerRef = useRef<number | null>(null);

  const flushNotifications = useCallback(() => {
    notificationTimerRef.current = null;
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
    void globalThis.api?.playAlertSound?.().catch(() => undefined);
  }, [onOpenProblems, showToast]);

  useEffect(() => {
    if (loading) return;

    if (!initializedRef.current) {
      for (const problem of problems) seenProblemIdsRef.current.add(problem.problemId);
      initializedRef.current = true;
      return;
    }

    const newOpenProblems = problems.filter(
      (problem) => problem.status === 'OPEN' && !seenProblemIdsRef.current.has(problem.problemId),
    );
    for (const problem of problems) seenProblemIdsRef.current.add(problem.problemId);
    if (newOpenProblems.length === 0) return;

    for (const problem of newOpenProblems) {
      pendingProblemsRef.current.set(problem.problemId, problem);
    }
    notificationTimerRef.current ??= window.setTimeout(
      flushNotifications,
      NOTIFICATION_BATCH_DELAY_MS,
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
